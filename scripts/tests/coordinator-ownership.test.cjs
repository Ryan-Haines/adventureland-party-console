const test = require('node:test');
const assert = require('node:assert/strict');
const { coordinatorOwnership, createCoordinatorOwnershipPorts } = require('../../runtime/coordinator/characters/ownership.ts');

function fixture(overrides = {}) {
  const state = { steamMembers: ['A'], headlessSlots: [null], nativeOwner: 'A', steamSwitch: null,
    statuses: {}, bankbois: {}, bankboiTransaction: null, merchantCharacter: 'M', merchantCurrent: null,
    leader: 'A', lifecycle: {} };
  const calls = [];
  const workers = { A: { enabled: true } };
  const ports = { now: () => 10000, id: () => 'id', save() {}, owned: () => ({ online: false }),
    updateAccount: async () => calls.push('query'), sleep: async ms => calls.push(ms),
    stop: async () => calls.push([workers.A.enabled, state.lifecycle.A]),
    assignSlot: (slot, name) => calls.push([slot, name]), roster: () => [], configuredRealm: 'USII', ...overrides };
  return { state, workers, calls, service: createCoordinatorOwnershipPorts(state, workers, ports) };
}

test('offline confirmation waits for two account observations and retries a bounced login', async () => {
  const observations = [false, true, false, false]; let online, index = 0;
  const f = fixture({ updateAccount: async () => { online = observations[index++]; }, owned: () => ({ online }) });
  assert.equal(await f.service.confirmOffline('A'), true);
  assert.equal(index, 4);
  assert.deepEqual(f.calls, [500, 1000, 500]);
});

test('offline polling remains bounded and missing account members reject immediately', async () => {
  const f = fixture({ owned: () => ({ online: true }) });
  assert.equal(await f.service.confirmOffline('A'), false);
  assert.deepEqual(f.calls, Array.from({ length: 8 }, () => ['query', 1000]).flat());
  const missing = fixture({ owned: () => undefined });
  await assert.rejects(missing.service.confirmOffline('A'), /no longer in the account roster/);
  assert.deepEqual(missing.calls, ['query']);
});

test('ownership writes through, and shutdown marks offline only after the worker stops', async () => {
  const f = fixture(), ownership = coordinatorOwnership(f.state);
  ownership.native = 'B'; ownership.steam = ['B']; ownership.slots = ['A'];
  assert.equal(f.state.nativeOwner, 'B'); assert.deepEqual(f.state.steamMembers, ['B']);
  assert.deepEqual(f.state.headlessSlots, ['A']);
  await f.service.stopHeadless('A');
  assert.deepEqual(f.calls, [[false, 'stopping']]); assert.equal(f.state.lifecycle.A, 'offline');
  await f.service.stopHeadless('missing');
  f.service.startHeadless('B', 2); assert.deepEqual(f.calls.at(-1), [3, 'B']);
  const failed = fixture({ stop: async () => { throw Error('stop failed'); } });
  await assert.rejects(failed.service.stopHeadless('A'), /stop failed/);
  assert.equal(failed.state.lifecycle.A, 'stopping'); assert.equal(failed.workers.A.enabled, false);
});

test('readiness, active inventory work and bank transactions gate handoffs', () => {
  const f = fixture();
  f.state.statuses.A = { runtime: 'native', seenAt: 5000 };
  assert.equal(f.service.codeRunning('A'), false);
  f.state.statuses.A.seenAt++;
  assert.equal(f.service.codeRunning('A'), true); assert.equal(f.service.headlessReady('A'), false);
  f.state.statuses.A.banking = true; assert.equal(f.service.nativeBusy(), true);
  f.state.bankboiTransaction = {}; assert.equal(f.service.characterBusy('absent'), true);
  assert.throws(() => f.service.validateParticipants(['A']), /bankboi transaction/);
  assert.throws(() => f.service.validateParticipants(['A', 'A']), /maximum characters/);
  assert.throws(() => f.service.validateParticipants(['A', 'B', 'C', 'D', 'E']), /maximum characters/);
});

test('roster groups use leader membership and lexical secondary selection, excluding bankbois', () => {
  const names = ['A', 'B', 'C', 'D', 'Vault'];
  const f = fixture({ roster: () => names.map(name => ({ name, ctype: 'mage', online: true })) });
  f.state.statuses = { A: { actualParty: 'z' }, B: { actualParty: 'a' }, C: { actualParty: 'b' } };
  f.state.bankbois.Vault = {};
  assert.deepEqual(f.service.members().map(({ name, group }) => [name, group]),
    [['A', 'primary'], ['B', 'secondary'], ['C', 'other'], ['D', 'ungrouped']]);
});
