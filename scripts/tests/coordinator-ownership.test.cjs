const test = require('node:test');
const assert = require('node:assert/strict');
const { coordinatorOwnership, createCoordinatorOwnershipPorts, createRosterCommit } = require('../../runtime/lifecycle/roster/ownership.ts');
const { createMerchantRealmOwner } = require('../../runtime/merchant-realm/coordinator/owner.ts');
const { ARRIVAL_WINDOW_MS } = require('../../runtime/merchant-realm/rules.ts');
const { lifecycleSavedFields } = require('../../runtime/lifecycle/fields.ts');

function fixture(overrides = {}) {
  const state = { steamMembers: ['A'], headlessSlots: [null], nativeOwner: 'A', steamSwitch: null,
    statuses: {}, bankbois: {}, bankboiTransaction: null, merchantCharacter: 'M', merchantCurrent: null,
    leader: 'A', lifecycle: {} };
  const calls = [];
  const workers = { A: { enabled: true } };
  const realm = createMerchantRealmOwner(state, { now: () => 10000, block: () => ({}), realmLabel: value => value, log() {}, persist() {}, restart() {} });
  const notify = (hook, payload) => calls.push([hook, payload]);
  const ports = { now: () => 10000, id: () => 'id', commit: createRosterCommit(state, { save() {}, notify }), notify, owned: () => ({ online: false }),
    updateAccount: async () => calls.push('query'), sleep: async ms => calls.push(ms),
    stop: async () => calls.push([workers.A.enabled, state.lifecycle.A]),
    assignSlot: (slot, name) => calls.push([slot, name]), roster: () => [], configuredRealm: 'USII',
    // The calls owner's answer whether the merchant's realm move is in flight, as application.ts asks it.
    realmMoving: name => realm.movingFor(name), ...overrides };
  return { state, workers, calls, service: createCoordinatorOwnershipPorts(state, workers, ports) };
}

test('offline confirmation waits for two account observations and retries a bounced login', async () => {
  const observations = [false, true, false, false]; let online, index = 0, nexts = 0;
  const observe = async () => { online = observations[index++]; };
  const f = fixture({ updateAccount: observe, nextAccount: () => { nexts++; return observe(); }, owned: () => ({ online }) });
  assert.equal(await f.service.confirmOffline('A'), true);
  // The first answer is asked once; each later one is the account's next update.
  assert.equal(index, 4); assert.equal(nexts, 3);
});

test('offline polling remains bounded and missing account members reject immediately', async () => {
  const bound = lifecycleSavedFields.settings.steamHandoffExpiryMs.default;
  // Four account answers span the bound.
  const answerGap = bound / 4; let now = 0, nexts = 0;
  const f = fixture({ now: () => now, owned: () => ({ online: true }),
    nextAccount: async () => { nexts++; now += answerGap; } });
  assert.equal(await f.service.confirmOffline('A'), false);
  assert.equal(nexts, 4); assert.equal(now, bound);
  // An account list that stops answering settles on the wait for the time left to the bound.
  const silent = fixture({ nextAccount: () => new Promise(() => {}), owned: () => ({ online: false }) });
  assert.equal(await silent.service.confirmOffline('A'), false);
  assert.deepEqual(silent.calls.filter(call => typeof call === 'number').slice(-1), [bound]);
  const missing = fixture({ owned: () => undefined });
  await assert.rejects(missing.service.confirmOffline('A'), /no longer in the account roster/);
  assert.deepEqual(missing.calls.filter(call => call === 'query'), ['query']);
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
  f.state.statuses.A.stocking = true; assert.equal(f.service.busy(['A']), 'Wait for A: a restock to finish');
  f.state.statuses.A.stocking = false;
  f.state.bankboiTransaction = {}; assert.equal(f.service.busy(['absent']), 'Wait for the bankboi transaction to finish');
  assert.throws(() => f.service.validateParticipants(['A']), /bankboi transaction/);
  assert.throws(() => f.service.validateParticipants(['A', 'A']), /maximum characters/);
  assert.throws(() => f.service.validateParticipants(['A', 'B', 'C', 'D', 'E']), /maximum characters/);
  f.state.bankboiTransaction=null;f.state.merchantCurrent={id:'stale-ordinary-job',phase:'assigned'};
  f.state.statuses.M={seenAt:0,runtime:'native'};
  assert.equal(f.service.busy(['M']),null,'Stale ordinary jobs must not block login recovery');
  // The job's realm move is the calls owner's saved request for the merchant, asked a second before now.
  f.state.merchantCurrent={id:'realm-owned-job',phase:'switching party realm'};
  f.state.merchantRealmRequests={M:{realm:'EUI',owner:'job:realm-owned-job',requestedAt:9000,attempts:1}};
  f.state.statuses.M={seenAt:0,runtime:'native'};
  assert.match(f.service.busy(['M']),/^Wait for M/,'A stale realm-transition heartbeat cannot release merchant job ownership');
  assert.throws(()=>f.service.validateParticipants(['M']),/active inventory operation/);
  // As v1.5.0 refused: a bank trip, a restock or an upgrade holds a roster
  // action. Any other job, which holds the drain (busy), lets it go through.
  const merchantStatus=f.state.statuses.M;
  f.state.statuses.M={...merchantStatus,seenAt:f.service.now(),banking:true};
  assert.throws(()=>f.service.validateParticipants(['M']),/Wait for M: a bank trip to finish/);
  f.state.statuses.M={...merchantStatus,seenAt:f.service.now(),upgrading:true};
  assert.match(f.service.busy(['M']),/Wait for M: an upgrade to finish/);
  f.state.statuses.M=merchantStatus;
  f.state.merchantRealmRequests.M.requestedAt=f.service.now()-ARRIVAL_WINDOW_MS;
  assert.equal(f.service.busy(['M']),null,'The realm reconnect fence expires at its recovery deadline');
  f.state.merchantCurrent=null;assert.equal(f.service.busy(['M']),null);
});

// The live Steam restore rows: a merchant job that holds the drain but no bank trip, restock or
// upgrade lets a Steam restore or action through.
test('a Steam roster action goes through during a merchant job that holds no bank trip, restock or upgrade', () => {
  const f = fixture();
  f.state.bankboiTransaction=null;f.state.merchantCurrent={id:'exchange-job',phase:'assigned'};
  f.state.statuses.M={seenAt:f.service.now(),runtime:'native',busy:true,busyReason:'the merchant is running a job (core:merchant-jobs)'};
  assert.equal(f.service.busy(['M']),null);
  assert.doesNotThrow(()=>f.service.validateParticipants(['M']));
});

test('roster groups use leader membership and lexical secondary selection, excluding bankbois', () => {
  const names = ['A', 'B', 'C', 'D', 'Vault'];
  const f = fixture({ roster: () => names.map(name => ({ name, ctype: 'mage', online: true })) });
  f.state.statuses = { A: { actualParty: 'z' }, B: { actualParty: 'a' }, C: { actualParty: 'b' } };
  f.state.bankbois.Vault = {};
  assert.deepEqual(f.service.members().map(({ name, group }) => [name, group]),
    [['A', 'primary'], ['B', 'secondary'], ['C', 'other'], ['D', 'ungrouped']]);
});

// The lifecycle owner's two roster reads for the items owner's BankBoi swap, through its registration as the hook registry
// asks them: `roster.offline` settles true on the second account answer in a row that shows the old
// character offline, and `roster.assign` starts the new character in the named headless slot.
test('roster.offline, roster.assign: the BankBoi swap sees the old character offline, then starts the new one in its slot', async () => {
  const { lifecycleRegistration } = require('../../runtime/lifecycle/coordinator/start.ts');
  const answers = [true, false, false]; let online, index = 0;
  const f = fixture({ updateAccount: async () => { online = answers[index++]; }, nextAccount: async () => { online = answers[index++]; },
    owned: () => ({ online }) });
  const ports = { now: () => 10000, id: () => 'id', commit() {}, owned: () => ({ online }), updateAccount: async () => { online = answers[index++]; },
    nextAccount: async () => { online = answers[index++]; }, sleep: () => new Promise(() => {}), stop: async () => {}, assignSlot: (slot, name, by) => f.calls.push([slot, name, by]),
    roster: () => [], configuredRealm: 'USII' };
  const control = { state: () => ({ paused: false }), drain: () => null, allows: () => true };
  const hooks = lifecycleRegistration(ports, control, { holds: () => [] }).hooks;
  assert.equal(await hooks['roster.offline']('OldBoi'), true, 'two offline answers in a row');
  assert.equal(index, 3, 'the online answer resets the count');
  hooks['roster.assign'](2, 'NewBoi');
  assert.deepEqual(f.calls, [[2, 'NewBoi', 'storage']]);
});

// A roster commit that changed the Steam members or the headless slots sends
// `roster.changed` once with both lists and who committed it; the live stack has no Steam window,
// so this unit row is the hook's fixture. Most slot changes write one index in place.
test('roster.changed: a Steam group change sends roster.changed with the members and the slots', () => {
  const f = fixture(), ownership = coordinatorOwnership(f.state);
  ownership.slots[0] = 'C';
  f.service.save('user');
  ownership.steam = ['A', 'B'];
  f.service.save('steam-handoff');
  ownership.native = 'B';
  f.service.save('steam');
  assert.deepEqual(f.calls, [
    ['roster.changed', { steam: ['A'], slots: ['C'], by: 'user' }],
    ['roster.changed', { steam: ['A', 'B'], slots: ['C'], by: 'steam-handoff' }],
  ], 'an in-place slot write sends it; a commit that changed neither list sends nothing');
});
