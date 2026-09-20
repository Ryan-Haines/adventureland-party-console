const test = require('node:test'), assert = require('node:assert/strict');
const {initializeCoordinatorEnvironment: initialize} = require('../../runtime/coordinator/environment.ts');

function fixture() {
  const calls = [], storage = new Map(), account = {}, version = {id: 123};
  const configuration = {cull_versions: true, session: 'config-session', characters: {
    missing: null, invalid: {realm: 10}, first: {realm: 'SR_EUI'}, second: {realm: 'SR_USII'}}};
  const ports = {createStorage: () => {calls.push('storage'); return storage;},
    migration: {read: path => {calls.push(['read', path]); return '{"saved":4}';},
      remove: path => calls.push(['remove', path]), info: details => calls.push(['log', details.type])},
    ensureLatest: async () => {assert.equal(storage.get('saved'), 4); assert.equal(storage.get('caracAL'), 'Yeah'); calls.push('latest'); return version;},
    configuration: () => {calls.push('config'); return configuration;},
    cullVersions: async versions => {calls.push('cull'); assert.equal(versions[0], version);},
    environmentSession: () => {calls.push('session'); return 'environment-session';},
    account: async token => {calls.push(['account', token]); return account;}};
  return {calls, storage, account, version, configuration, ports};
}

test('environment initialization preserves storage, version, configuration and login sequencing', async () => {
  const t = fixture(), result = await initialize(t.ports);
  assert.deepEqual(t.calls, ['storage', ['read', './localStorage/storage.json'], ['log', 'ls_migration'],
    ['remove', './localStorage/storage.json'], ['log', 'ls_migration_done'], 'latest', 'config', 'cull', 'session', ['account', 'environment-session']]);
  assert.equal(result.localStorage, t.storage); assert.equal(result.sessionStorage.get('caracAL'), 'Yup');
  assert.equal(result.version, t.version); assert.equal(result.configuration, t.configuration);
  assert.equal(result.account, t.account); assert.equal(result.workers, t.configuration.characters);
  assert.equal(result.configuredRealm, 'SR_EUI'); assert.equal(result.session, 'environment-session');
});

test('environment defaults retain empty-session fallback and read all configured realms before selection', async () => {
  const t = fixture(), reads = []; t.configuration.cull_versions = false;
  t.ports.environmentSession = () => ''; t.configuration.characters = {
    A: {get realm() {reads.push('A'); return 'SR_ASIAI';}}, B: {get realm() {reads.push('B'); return 'SR_USII';}},
  };
  const result = await initialize(t.ports);
  assert.deepEqual(reads, ['A', 'B']); assert.equal(result.configuredRealm, 'SR_ASIAI');
  assert.equal(result.session, 'config-session'); assert.equal(t.calls.includes('cull'), false);
  t.configuration.characters = {A: {realm: 'USII'}};
  assert.equal((await initialize(t.ports)).configuredRealm, 'SR_USII');
});

test('environment failures stop later startup I/O and preserve the original exception', async () => {
  for (const failing of ['ensureLatest', 'cullVersions', 'account']) {
    const t = fixture(), failure = Error(failing); t.ports[failing] = async () => {throw failure;};
    await assert.rejects(initialize(t.ports), error => error === failure);
    if (failing === 'ensureLatest') assert.equal(t.calls.includes('config'), false);
    if (failing !== 'account') assert.equal(t.calls.some(call => Array.isArray(call) && call[0] === 'account'), false);
  }
});
