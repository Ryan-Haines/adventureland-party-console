const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reservedForSteam } = require('../../runtime/lifecycle/roster/handoff.ts');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { handoffFixture: fixture, groupFixture, merchantMove } = require('./fixtures/steam-roster-scenario.cjs');

test('Steam switch reciprocally transfers the target slot only after confirmed native release', async () => {
  const f = fixture();
  const op = await f.service.begin('Mage');
  assert.equal(op.phase, 'release');
  assert.deepEqual(f.stopped, ['Mage']);
  await f.service.released(op.id, 'Priest');
  assert.deepEqual(f.started, []);
  assert.equal(f.state.native, 'Priest', 'stale heartbeat cannot relinquish ownership');
  f.online.delete('Priest');
  await Promise.all([f.service.released(op.id, 'Priest'), f.service.released(op.id, 'Priest')]);
  assert.deepEqual(f.started, [['Priest', 0]]);
  assert.equal(op.phase, 'navigate');
  f.service.arrived(op.id, 'Mage');
  assert.equal(f.state.native, 'Mage');
  assert.deepEqual(f.state.slots, ['Priest', 'Warrior', 'Merchant', null]);
});

test('de-load supports four headless characters without selecting another Steam character', async () => {
  const f = fixture();
  const op = await f.service.begin(null);
  f.online.delete('Priest');
  await f.service.released(op.id, 'Priest');
  assert.equal(op.phase, 'complete');
  assert.equal(f.state.native, null);
  assert.deepEqual(f.started, [['Priest', 3]]);
});

test('native logout leaves an offline character and does not start headless work', async () => {
  const f = fixture();
  const op = await f.service.begin(null, false);
  f.online.delete('Priest');
  await f.service.released(op.id, 'Priest');
  assert.deepEqual(f.started, []);
  assert.equal(f.state.native, null);
});

test('failed navigation can recover after the former Steam character returned to headless', async () => {
  const f = fixture();
  const op = await f.service.begin('Mage');
  f.online.delete('Priest');
  await f.service.released(op.id, 'Priest');
  assert.ok(f.online.has('Priest'));
  f.service.fail(op.id, 'navigation failed');
  await f.service.cancel();
  assert.deepEqual(f.stopped, ['Mage', 'Priest']);
  assert.equal(f.state.handoff, null);
  assert.deepEqual(f.state.slots, [null, 'Warrior', 'Merchant', null]);
});

test('a late native arrival completes a confirmed handoff without starting another worker', async () => {
  const f = fixture();
  const op = await f.service.begin('Mage');
  assert.equal(reservedForSteam(f.state, 'Priest'), true);
  assert.equal(f.service.reconcileArrival('Mage'), false, 'never infer release from an arrival');
  f.online.delete('Priest');
  await f.service.released(op.id, 'Priest');
  assert.equal(reservedForSteam(f.state, 'Priest'), false);
  assert.equal(reservedForSteam(f.state, 'Mage'), true);
  f.ports.now = () => 200000;
  f.service.expire();
  assert.equal(op.phase, 'failed');
  assert.equal(f.service.reconcileArrival('Warrior'), false);
  assert.equal(f.service.reconcileArrival('Mage'), true);
  assert.equal(f.state.native, 'Mage');
  assert.equal(op.phase, 'complete');
  assert.deepEqual(f.started, [['Priest', 0]]);
});

test('concurrent operations, stale acknowledgements and externally online targets are rejected', async () => {
  const f = fixture();
  f.online.add('Ranger');
  const op = await f.service.begin('Ranger', false);
  assert.equal(op.phase, 'failed');
  await assert.rejects(f.service.begin('Mage'), /pending/);
  await assert.rejects(f.service.released('stale', 'Priest'), /Stale/);
  assert.throws(() => f.service.arrived(op.id, 'Mage'), /Stale/);
  await assert.rejects(f.service.cancel(), /still online/);
  assert.deepEqual(f.started, []);
});

test('timeout never starts a duplicate; recovery requires authoritative offline confirmation', async () => {
  const f = fixture();
  const op = await f.service.begin('Mage');
  f.ports.now = () => 100000;
  f.service.expire();
  assert.equal(op.phase, 'failed');
  assert.equal(f.state.native, 'Priest');
  await assert.rejects(f.service.cancel(), /still online/);
  f.online.delete('Priest');
  await f.service.cancel();
  assert.equal(f.state.handoff, null);
  assert.deepEqual(f.state.slots, [null, 'Warrior', 'Merchant', null]);
  assert.deepEqual(f.started, []);
});

// MJ46: a Steam move that names or holds the merchant waits while
// the realm owner's move for it is in flight, so the Steam client never navigates the merchant away
// from `realm.target()`; once the move arrives, the Steam move goes.
scenarioTable('MJ46: a Steam move holding the merchant waits while its realm move is in flight', () => undefined, [
  ['a single handoff naming the merchant', async () => {
    const f = fixture(), move = merchantMove({ merchant: 'Merchant', steam: ['Priest'], slots: [] });
    f.ports.validateParticipants = move.validateParticipants;
    assert.equal(move.realm.want('job:a', 'SR_EUI'), 'moving');
    await assert.rejects(f.service.begin('Merchant'), /active inventory operation/);
    assert.deepEqual(f.stopped, []);
    move.arrive();
    assert.equal((await f.service.begin('Merchant')).phase, 'release');
  }],
  ['a group action whose participants hold the merchant', async () => {
    const f = groupFixture(), move = merchantMove({ merchant: 'M', steam: ['P'], slots: ['M', 'W', 'Trader', null] });
    f.ports.validateParticipants = move.validateParticipants;
    assert.equal(move.realm.want('job:a', 'SR_EUI'), 'moving');
    await assert.rejects(f.service.begin('headless', 'P'), /active inventory operation/);
    assert.deepEqual(f.stopped, []);
    move.arrive();
    await f.service.begin('headless', 'P'); assert.ok(f.state.handoff);
  }],
]);
