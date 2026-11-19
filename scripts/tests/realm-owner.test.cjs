// The merchant realm owner's rules. Separate: wants from four owners at once, which no live run
// sets up. Failure modes: two wants rank out of the order party switch, user hold, job, home; the
// blacklist allows an automatic want, runs an order with no confirmation, refuses home, takes a PVP
// realm or changes an answer while empty; a job ending asks for home by itself, or the merchant
// stays off home with no other want; a reconnect goes to another realm, adds a want or holds
// realm-hold; R1 to R3 disagree with the code they replaced.
const test = require('node:test'), assert = require('node:assert/strict');
const { createMerchantRealmOwner } = require('../../runtime/merchant-realm/coordinator/owner.ts');
const { wantRank, realmRefusal, validRealmBlacklist, ARRIVAL_WINDOW_MS } = require('../../runtime/merchant-realm/rules.ts');

// The hop and notice rows register fixture hooks on the process-wide registry. Each row gets a
// registry of its own, so a fixture hook never answers in a later row.
let hooksBefore;
test.beforeEach(() => { hooksBefore = Object.getOwnPropertyDescriptor(globalThis, '__partyHooks'); delete globalThis.__partyHooks; });
test.afterEach(() => { if (hooksBefore) Object.defineProperty(globalThis, '__partyHooks', hooksBefore); else delete globalThis.__partyHooks; });

function fixture(extra = {}, merchantRealm = 'SR_USII', more = {}) {
  let now = 100000;
  const blocks = { M: { realm: merchantRealm, connected: true }, F: { realm: 'SR_USII', connected: true } };
  const state = { merchantCharacter: 'M', activeRealm: 'SR_USII', merchantRealmRequests: {}, merchantRealmBlacklist: [],
    statuses: { M: { server: 'USII', seenAt: now, runtime: 'headless', hp: 10 }, F: { server: 'USII', seenAt: now, runtime: 'headless' } },
    headlessSlots: ['M', 'F'], commands: {}, merchantCurrent: null, nextCommandId: 1, ...extra };
  const restarts = [], fails = [];
  const ladder = { fail: (code) => { fails.push(code); return { rung: 'regroup' }; }, progress() {}, rung: () => 'regroup' };
  const owner = createMerchantRealmOwner(state, { now: () => now, block: name => blocks[name], realmLabel: realm => realm, log() {},
    persist() {}, restart: block => restarts.push(block), ladder, resolve: () => true, ...more });
  return { state, blocks, owner, restarts, fails, at: () => now, setNow: value => { now = value; } };
}

test('wants rank party switch, then your hold, then the current job, then home', () => {
  assert.deepEqual(['party-switch:1', 'party-switch:1:home', 'user:force-stand', 'job:a', 'items:stay', 'home'].map(wantRank), [5, 5, 4, 3, 2, 1]);
  const f = fixture({ merchantCurrent: { id: 'a', reason: 'ALData marketplace purchases' } });
  assert.equal(f.owner.want('job:a', 'SR_EUI'), 'moving');
  assert.equal(f.state.merchantRealmRequests.M.realm, 'SR_EUI');
  // A higher want takes the move; the job's want waits and is asked again on the release.
  assert.equal(f.owner.want('user:force-stand', 'SR_USII', { manual: true }), 'moving');
  assert.equal(f.state.merchantRealmRequests.M.owner, 'user:force-stand');
  assert.equal(f.owner.want('job:a', 'SR_EUI'), 'moving');
  assert.equal(f.state.merchantRealmRequests.M.owner, 'user:force-stand');
  assert.equal(f.owner.want('party-switch:9', 'SR_ASIAI', { manual: true }), 'moving');
  assert.equal(f.state.merchantRealmRequests.M.realm, 'SR_ASIAI');
  f.owner.release('party-switch:9');
  f.owner.release('user:force-stand');
  f.blocks.M.connected = false;
  assert.equal(f.owner.want('job:a', 'SR_EUI'), 'moving');
  assert.equal(f.state.merchantRealmRequests.M.owner, 'job:a');
  // A headless move asked with no reply to wait for stops its worker at the write.
  assert.ok(f.restarts.length > 0 && f.restarts.every(block => block === f.blocks.M));
});

test('the blacklist refuses automatic wants, asks confirmation for your orders and never refuses home', () => {
  const list = ['SR_EUI'];
  assert.equal(realmRefusal('job:a', 'SR_EUI', list, {}), 'refused:blacklisted');
  assert.equal(realmRefusal('job:a', 'SR_EUI', list, { manual: true }), 'confirm:blacklisted');
  assert.equal(realmRefusal('job:a', 'SR_EUI', list, { manual: true, confirm: true }), null);
  assert.equal(realmRefusal('home', 'SR_EUI', list, {}), null);
  assert.equal(realmRefusal('job:a', 'SR_USPVP', [], { manual: true, confirm: true }), 'refused:pvp');
  assert.equal(validRealmBlacklist(['SR_USPVP']), false);
  assert.equal(validRealmBlacklist(['SR_EUI', 'SR_EUI']), false);
  assert.equal(validRealmBlacklist(['SR_EUI']), true);
  // With an empty list every answer is today's.
  for (const realm of ['SR_EUI', 'SR_USII', 'SR_ASIAI']) assert.equal(realmRefusal('job:a', realm, [], {}), null);
  const f = fixture({ merchantRealmBlacklist: list, merchantCurrent: { id: 'a' } });
  assert.equal(f.owner.want('job:a', 'SR_EUI'), 'refused:blacklisted');
  assert.equal(f.state.merchantRealmRequests.M, undefined);
  assert.equal(f.owner.want('job:a', 'SR_EUI', { manual: true }), 'confirm:blacklisted');
  assert.equal(f.owner.want('job:a', 'SR_EUI', { manual: true, confirm: true }), 'moving');
  assert.equal(f.owner.refuses('job', 'SR_EUI'), true);
});

test('a job ending asks nothing for home, and the home want brings the merchant back with no other want', () => {
  const f = fixture({ merchantCurrent: { id: 'a' } });
  f.owner.want('job:a', 'SR_EUI');
  f.blocks.M.realm = 'SR_EUI';
  f.state.statuses.M.server = 'EUI';
  // While the job is current its want outranks home: the listing trip is not cut short.
  assert.equal(f.owner.ensureHome('upgrade'), false);
  assert.equal(f.state.merchantRealmRequests.M.owner, 'job:a');
  // R3 rule 7: the job's hop holds realm-hold only inside the arrival window.
  assert.equal(f.owner.moving(), true);
  f.setNow(f.at() + ARRIVAL_WINDOW_MS);
  assert.equal(f.owner.moving(), false);
  // A coordinator restart keeps the current job's want from its saved request.
  const restarted = fixture({ merchantCurrent: { id: 'a' }, merchantRealmRequests: { M: { ...f.state.merchantRealmRequests.M } } }, 'SR_EUI');
  restarted.state.statuses.M.server = 'EUI';
  assert.equal(restarted.owner.ensureHome('upgrade'), false);
  assert.equal(restarted.state.merchantRealmRequests.M.owner, 'job:a');
  // The job ended: nothing asked for home, and the home want takes the merchant back.
  f.state.merchantCurrent = null;
  assert.equal(f.owner.ensureHome('upgrade'), false);
  assert.equal(f.state.merchantRealmRequests.M.owner, 'home');
  assert.equal(f.blocks.M.realm, 'SR_USII');
});

test('R3: a job listing hop holds realm-hold only inside the 60 s window, with no fresh report', () => {
  const f = fixture({ merchantCurrent: { id: 'a', reason: 'ALData marketplace purchases' } });
  assert.equal(f.owner.want('job:a', 'SR_EUI'), 'moving');
  assert.equal(f.owner.moving(), true);
  f.setNow(100000 + ARRIVAL_WINDOW_MS - 1);
  assert.equal(f.owner.moving(), true);
  f.setNow(100000 + ARRIVAL_WINDOW_MS);
  assert.equal(f.owner.moving(), false);
});

// The live run read the merchant group idle for one sample between the job's destination write
// and the next status report's task tick.
test('a move ticks the tasks owner once its destination is written, so realm-hold holds from the write', () => {
  const ticks = [];
  const f = fixture({ merchantCurrent: { id: 'a', reason: 'party collection' } }, 'SR_USII',
    { taskTick: () => ticks.push([f.state.merchantRealmRequests.M?.realm, f.owner.moving(), f.restarts.length]) });
  assert.equal(f.owner.want('job:a', 'SR_EUI'), 'moving');
  // The tick sees the move in flight before the worker restarts for the login.
  assert.deepEqual(ticks, [['SR_EUI', true, 0]]);
  // A want already in flight writes nothing and asks no tick.
  f.owner.want('job:a', 'SR_EUI');
  assert.equal(ticks.length, 1);
});

test('R3: a missed 60 s window is one realm-hold ladder failure, and a fresh report on home ends the move', () => {
  const f = fixture();
  f.blocks.M.realm = 'SR_EUI';
  f.state.statuses.M.server = 'EUI';
  assert.equal(f.owner.ensureHome('upgrade'), false);
  const first = f.state.merchantRealmRequests.M;
  assert.deepEqual([first.owner, first.attempts], ['home', 1]);
  assert.equal(f.owner.moving(), true);
  f.setNow(100000 + ARRIVAL_WINDOW_MS);
  f.state.statuses.M.seenAt = 100000 + ARRIVAL_WINDOW_MS;
  f.owner.ensureHome('upgrade');
  assert.deepEqual(f.fails, ['realm-return']);
  assert.equal(f.state.merchantRealmRequests.M.attempts, 2);
  f.state.statuses.M = { server: 'USII', seenAt: 100000 + ARRIVAL_WINDOW_MS + 1, runtime: 'headless', hp: 10 };
  f.setNow(100000 + ARRIVAL_WINDOW_MS + 1);
  assert.equal(f.owner.ensureHome('upgrade'), true);
  assert.equal(f.state.merchantRealmRequests.M, undefined);
  assert.equal(f.owner.moving(), false);
});

test('MJ91: a reconnect logs in once on the realm the character reports and adds no want', () => {
  const f = fixture();
  f.state.statuses.F.server = 'EUI';
  assert.equal(f.owner.reconnect('F'), 'sent');
  assert.equal(f.blocks.F.realm, 'SR_EUI');
  assert.equal(f.restarts.length, 1);
  assert.equal(f.owner.moving(), false);
  assert.equal(f.state.merchantRealmRequests.F, undefined);
  const steam = fixture();
  steam.state.statuses.M.runtime = 'native';
  assert.equal(steam.owner.reconnect('M'), 'sent');
  assert.deepEqual([steam.state.commands.M.type, steam.state.commands.M.realm], ['native-realm-switch', 'SR_USII']);
  const moving = fixture({ merchantCurrent: { id: 'a' } });
  moving.blocks.M.connected = false;
  moving.owner.want('job:a', 'SR_EUI');
  assert.equal(moving.owner.reconnect('M'), 'not-now');
});

// The one hop executor on the character. An answer with `alreadyThere`
// continues with no hold and no page change; any other answer ends the job's code at the hop, holds
// `realm` and, on Steam, changes the page once the job band sends. The job band the hop asks: the
// first question waits one window, every later one sends. It records each asked method.
const band = [];
function hopBand() {
  const { partyHooks } = require('../../runtime/hooks/index.ts');
  if (!partyHooks().map().registrations.some(r => r.name === 'core:hop-band-fixture'))
    partyHooks().register({ name: 'core:hop-band-fixture', folder: 'core', author: 'test', summary: 'test',
      hooks: { 'calls.band': question => { band.push(question.method); return band.length === 1 ? 'not-now' : 'send'; }, 'calls.window': () => 4000 } });
  return band;
}
test('a hop answered already there continues, and one that waits for a restart yields under the realm holder', async () => {
  const { createMerchantHop } = require('../../runtime/merchant-realm/character/hop.ts');
  hopBand();
  function hopFixture(answer, headless) {
    const held = [], slept = [], parent = { server_region: 'US', server_identifier: 'I', caracAL: headless, window: { location: { search: '?no_html=1&x=2', href: '' } } };
    const hop = createMerchantHop({ parent: () => parent, character: () => ({ name: 'M' }),
      request: async () => answer, sleep: async ms => { slept.push(ms); }, log() {}, holdRealm: realm => held.push(realm) });
    return { hop, held, slept, parent };
  }
  const here = hopFixture({ ok: true, alreadyThere: true }, false);
  assert.equal(await here.hop.jobHop({ jobId: 'j' }, 'SR_EUI'), 'here');
  assert.deepEqual(here.held, []); assert.equal(here.parent.window.location.href, '');
  const headless = hopFixture({ ok: true, realm: 'SR_EUI' }, true);
  assert.equal(await headless.hop.jobHop({ jobId: 'j' }, 'SR_EUI'), 'yielded');
  assert.deepEqual(headless.held, ['SR_EUI']); assert.equal(headless.parent.window.location.href, '');
  const steam = hopFixture({ ok: true, realm: 'SR_EUI' }, false);
  assert.equal(await steam.hop.jobHop({ jobId: 'j' }, 'SR_EUI'), 'yielded');
  assert.deepEqual(steam.held, ['SR_EUI']); assert.deepEqual(band, ['change_server', 'change_server']); assert.deepEqual(steam.slept, [4000]);
  assert.equal(steam.parent.window.location.href, '/character/M/in/EU/I/?no_html=1');
  assert.equal(here.hop.liveRealm(), 'SR_USI');
});

// A4: every realm decision sends its notice once, `by` the want's owner, and the two reads
// an add-on may ask answer from the owner. Separate: a move needs the two-realm pool, which the
// merchant hooks table does not set up.
test("A4: the realm owner's notices: a move starts, fails one window, is retried and arrives; a refused and a granted want", () => {
  const { partyHooks } = require('../../runtime/hooks/index.ts');
  const { merchantRealmSource } = require('../../runtime/merchant-realm/coordinator/registrations.ts');
  const heard = [];
  const notices = ['realm.move.started', 'realm.move.arrived', 'realm.move.failed', 'realm.want.refused', 'realm.want.granted'];
  if (!partyHooks().map().registrations.some(r => r.name === 'core:realm-notices-fixture'))
    partyHooks().register({ name: 'core:realm-notices-fixture', folder: 'core', author: 'test', summary: 'Hears the realm notices.',
      hooks: Object.fromEntries(notices.map(n => [n, payload => heard.push([n, payload.owner, payload.code, payload.by])])) });
  const f = fixture({ merchantCurrent: { id: 'a' } });
  const reads = merchantRealmSource(() => f.owner, () => undefined).hooks;
  assert.equal(f.owner.want('job:a', 'USPVP'), 'refused:pvp');
  f.blocks.M.connected = false;
  assert.equal(f.owner.want('job:a', 'SR_EUI'), 'moving');
  assert.deepEqual([reads['realm.target'](), reads['realm.moving']()], ['SR_EUI', true]);
  f.blocks.M = { realm: 'SR_EUI', connected: true };
  assert.equal(f.owner.want('job:a', 'SR_EUI'), 'here');
  assert.equal(f.owner.want('job:a', 'SR_EUI'), 'here');
  f.owner.release('job:a');
  f.state.merchantCurrent = null;
  f.state.statuses.M.server = 'EUI';
  f.owner.ensureHome('upgrade');
  f.setNow(100000 + ARRIVAL_WINDOW_MS);
  f.state.statuses.M.seenAt = 100000 + ARRIVAL_WINDOW_MS;
  f.owner.ensureHome('upgrade');
  f.owner.retry();
  f.owner.ensureHome('upgrade');
  f.state.statuses.M = { server: 'USII', seenAt: 100000 + ARRIVAL_WINDOW_MS + 1, runtime: 'headless', hp: 10 };
  f.blocks.M = { realm: 'SR_USII', connected: true };
  f.setNow(100000 + ARRIVAL_WINDOW_MS + 1);
  f.owner.ensureHome('upgrade');
  f.owner.ensureHome('upgrade');
  assert.deepEqual(heard, [['realm.want.refused', 'job:a', 'refused:pvp', 'job:a'], ['realm.want.granted', 'job:a', 'SR_EUI', 'job:a'],
    ['realm.move.started', 'job:a', 'SR_EUI', 'job:a'], ['realm.move.arrived', 'job:a', 'SR_EUI', 'job:a'],
    ['realm.move.started', 'home', 'SR_USII', 'home'], ['realm.move.failed', 'home', 'regroup', 'home'], ['realm.move.started', 'home', 'SR_USII', 'home'],
    ['realm.move.started', 'home', 'SR_USII', 'home'], ['realm.move.arrived', 'home', 'SR_USII', 'home']]);
});

// And (3.10 rule 6): set home asks the job band and answers the coordinator with the game's result, respawning first when
// dead; the native switch refuses a headless runtime and changes the page once; each realm error is logged once until its
// text changes.
test('set home reports its result, the native switch changes the page once, and a realm error logs once', async () => {
  const { createMerchantHop, logRealmErrors } = require('../../runtime/merchant-realm/character/hop.ts');
  const posts = [], respawns = [], parent = { server_region: 'US', server_identifier: 'II', caracAL: false, window: { location: { search: '', href: '' } } };
  let rip = true, answer = { success: true };
  const hop = createMerchantHop({ parent: () => parent, character: () => ({ name: 'M', rip }),
    request: async (route, options) => { posts.push([route, options.body.success, options.body.error]); return null; },
    sleep: async () => {}, log() {}, holdRealm() {}, afterCombat: work => work(), respawn: async by => { respawns.push(by); rip = false; },
    setHome: async () => answer });
  const asked = hopBand().length;
  await hop.setHome({ realm: 'SR_EUI', operationId: 'op' });
  // set_home is a socket send, so it asks the job band before it goes.
  assert.deepEqual(band.slice(asked), ['set_home']);
  answer = { failed: true, reason: 'cant_set_home' };
  await assert.rejects(hop.setHome({ realm: 'SR_EUI', operationId: 'op' }), /cant_set_home/);
  assert.deepEqual(respawns, ['realm-set-home']);
  assert.deepEqual(posts, [['/realm/home-complete', true, undefined], ['/realm/home-complete', false, 'cant_set_home']]);
  await hop.nativeSwitch({ realm: 'SR_EUI' });
  assert.equal(parent.window.location.href, '/character/M/in/EU/I/');
  parent.caracAL = true;
  await assert.rejects(hop.nativeSwitch({ realm: 'SR_EUI' }), /requires the Steam game client/);
  const logged = [];
  for (const message of ['wrong realm', 'wrong realm', 'other realm']) logRealmErrors([{ id: 'j', message }], (text, color) => logged.push([text, color]));
  assert.deepEqual(logged, [['wrong realm', 'red'], ['other realm', 'red']]);
});

// Realm half (party-visit.ts, owner.ts `visit`): a visit switch that fails requeues its job with the
// retry (the merchant job owner's realmRetry, the completion's realm ending's own), no count
// that drops it, the visit's travel is the current job's want, and the merchant's reply carries each
// queued visit's realm error.
test('a failed visit switch requeues the job, the visit asks the job want, and the reply names realm errors', async () => {
  const { createPartyRealmCheck, merchantRealmErrors } = require('../../runtime/merchant-realm/coordinator/party-visit.ts');
  const f = fixture({ merchantCurrent: { id: 'party' } }), now = f.at(), state = { queue: [], current: null }, logs = [];
  const statuses = { M: { seenAt: now, server: 'USII' }, P: { seenAt: now, server: 'USIV' } };
  const check = createPartyRealmCheck(state, { now: f.at, merchant: () => 'M', status: name => statuses[name], headless: () => true,
    travel: async () => { throw Error('worker down'); }, persist() {}, log: (...args) => logs.push(args) });
  const job = { id: 'party', reason: 'inventory cleanout', target: 'P' };
  assert.equal(check.begin(job, statuses.P), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.current, null); assert.deepEqual(state.queue, [job]);
  const { realmRetry } = require('../../runtime/merchant-jobs/rules.ts');
  assert.deepEqual([job.realmAttempts, job.ladderDue, job.retryAt, job.phase],
    [1, 'realm-switch', realmRetry(0, now).retryAt, undefined]);
  assert.deepEqual(realmRetry(0, now), { realmAttempts: 1, ladderDue: 'realm-switch', retryAt: now + 10_000 });
  assert.deepEqual(logs.at(-1).slice(0, 2), ['Merchant realm switch failed: Error: worker down', 'error']);
  f.blocks.M.connected = false;
  await f.owner.visit('SR_USIV');
  assert.deepEqual([f.state.merchantRealmRequests.M.owner, f.state.merchantRealmRequests.M.realm], ['job:party', 'SR_USIV']);
  const unknown = fixture({ merchantCurrent: null });
  await assert.rejects(unknown.owner.visit('SR_USIV'), /Unknown merchant destination realm/);
  const queued = { merchantCharacter: 'M', merchantQueue: [{ id: 'a' }, { id: 'b', realmError: 'merchant job failed: wrong realm (target was on US IV)' }] };
  assert.deepEqual(merchantRealmErrors(queued, 'M'), { merchantRealmErrors: [{ id: 'b', message: 'merchant job failed: wrong realm (target was on US IV)' }] });
  assert.deepEqual(merchantRealmErrors(queued, 'P'), {});
});

// One browser-safe realm module builds, strips and labels a realm id for every owner, and the calls owner's
// normalizedRealm is that module's.
test('the realm id rule lives in runtime/protocol/realm.ts, which the call budget reads', () => {
  const realm = require('../../runtime/protocol/realm.ts');
  assert.equal(require('../../runtime/merchant-realm/rules.ts').normalizedRealm, realm.normalizedRealm);
  assert.deepEqual([realm.gameRealm('US', 'II'), realm.normalizedRealm('EUI'), realm.normalizedRealm('SR_EUI'), realm.normalizedRealm(null)],
    ['SR_USII', 'SR_EUI', 'SR_EUI', null]);
  assert.deepEqual([realm.bareRealm('SR_ASIAI'), realm.realmLabel('SR_USPVP'), realm.realmLabel(null, 'unknown')], ['ASIAI', 'US PVP', 'unknown']);
});

// A Steam merchant has no worker connection on its block, so its fresh report on the realm with its
// connection up is where it stands. Separate: the live force stand right after a coordinator
// restart, where a page change on the same realm replaced the merchant's CODE.
test('a Steam merchant reporting from the wanted realm is here and gets no page change', () => {
  const f = fixture({ steamMembers: ['M'], headlessSlots: ['F'] });
  f.blocks.M.connected = false;
  Object.assign(f.state.statuses.M, { runtime: 'native', travelSample: { connected: true } });
  assert.equal(f.owner.want('user:force-stand', 'SR_USII', { manual: true }), 'here');
  assert.equal(JSON.stringify(f.state.commands).includes('native-realm-switch'), false);
  assert.equal(f.state.merchantRealmRequests.M, undefined);
  // On another realm the same want moves the page once.
  f.owner.release('user:force-stand');
  assert.equal(f.owner.want('user:force-stand', 'SR_EUI', { manual: true }), 'moving');
  assert.equal(JSON.stringify(f.state.commands).includes('native-realm-switch'), true);
  // A report gone stale, or a connection down, is not a reading of where it stands.
  const stale = fixture({ steamMembers: ['M'], headlessSlots: ['F'] });
  stale.blocks.M.connected = false;
  Object.assign(stale.state.statuses.M, { runtime: 'native', travelSample: { connected: false } });
  assert.equal(stale.owner.want('user:force-stand', 'SR_USII', { manual: true }), 'moving');
});

// A Steam merchant's block takes its native home as its realm whenever no move names one
// (workers.ts ensure), so the block says nothing about where a Steam merchant stands. Separate:
// the live bank-work row, where the merchant's native home is US II and the party stands on US I;
// each return arrived, dropped its request, and the next stand check sent the page home again.
test('a Steam merchant reporting from home is home whatever realm its block names', () => {
  const f = fixture({ activeRealm: 'SR_USI', steamMembers: ['M'], headlessSlots: ['F'] });
  f.blocks.M.connected = false;
  Object.assign(f.state.statuses.M, { server: 'USI', runtime: 'native', travelSample: { connected: true } });
  assert.equal(f.owner.homeWant('stand or anniversary attendance'), true);
  assert.equal(JSON.stringify(f.state.commands).includes('native-realm-switch'), false);
  assert.equal(f.state.merchantRealmRequests.M, undefined);
  // A Steam merchant reporting from another realm still goes home once.
  const away = fixture({ activeRealm: 'SR_USI', steamMembers: ['M'], headlessSlots: ['F'] });
  away.blocks.M.connected = false;
  Object.assign(away.state.statuses.M, { server: 'USII', runtime: 'native', travelSample: { connected: true } });
  assert.equal(away.owner.homeWant('stand or anniversary attendance'), false);
  assert.equal(JSON.stringify(away.state.commands).includes('native-realm-switch'), true);
});

// Separate: the live realm departure row, where the party switch's Steam group restore met the
// merchant's own party switch move as a busy refusal, failed, and rolled the switch back.
test('a party switch move holds no roster action, and a job move still does', () => {
  const f = fixture({ activeRealm: 'SR_USI', steamMembers: ['M'], headlessSlots: ['F'] });
  f.blocks.M.connected = false;
  Object.assign(f.state.statuses.M, { server: 'USI', runtime: 'native', travelSample: { connected: true } });
  assert.equal(f.owner.want('party-switch:1', 'SR_USII', { manual: true }), 'moving');
  assert.equal(f.owner.moving(), true);
  assert.equal(f.owner.movingFor('M'), false);
  f.owner.release('party-switch:1');
  f.state.merchantCurrent = { id: 'a', reason: 'ALData marketplace purchases' };
  assert.equal(f.owner.want('job:a', 'SR_EUI'), 'moving');
  assert.equal(f.owner.movingFor('M'), true);
});

// A home return an earlier version saved as exhausted has no cap left to hold it: the next home
// want climbs the realm hold's ladder and moves again, and Retry clears it. Separate: the live
// row, where the merchant spawns on home after Retry and so never needs this return.
test('a saved exhausted home return climbs again, and Retry clears it', () => {
  const f = fixture();
  f.blocks.M.realm = 'SR_EUI';
  Object.assign(f.state.statuses.M, { server: 'EUI' });
  f.state.merchantRealmRequests.M = { realm: 'SR_USII', owner: 'home', requestedAt: f.at() - ARRIVAL_WINDOW_MS - 1, attempts: 3, exhausted: true };
  assert.equal(f.owner.ensureHome('upgrade'), false);
  assert.equal(f.state.merchantRealmRequests.M.exhausted, undefined);
  assert.equal(f.state.merchantRealmRequests.M.attempts, 4);
  assert.deepEqual(f.fails, ['realm-return']);
  assert.ok(f.restarts.includes(f.blocks.M));
  f.owner.retry();
  assert.equal(f.state.merchantRealmRequests.M, undefined);
});
