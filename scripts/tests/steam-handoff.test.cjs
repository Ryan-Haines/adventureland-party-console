const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SteamHandoff, reservedForSteam } = require('../../runtime/roster/handoff.ts');

function fixture(slots = ['Mage', 'Warrior', 'Merchant', null]) {
  const state = { native: 'Priest', slots, handoff: null };
  const online = new Set(['Priest', ...slots.filter(Boolean)]), started = [], stopped = [];
  const ports = {
    now: () => 100, id: () => 'transaction-1', save() {}, bridgeReady: () => true,
    owned: name => ['Priest', 'Mage', 'Warrior', 'Merchant', 'Ranger'].includes(name),
    validateParticipants(names) { if (new Set(names).size > 4) throw new Error('session limit'); },
    async stopHeadless(name) { stopped.push(name); online.delete(name); },
    startHeadless(name, slot) { assert.ok(!online.has(name), 'never double login'); online.add(name); started.push([name, slot]); },
    async confirmOffline(name) { return !online.has(name); },
  };
  return { state, online, started, stopped, ports, service: new SteamHandoff(state, ports) };
}

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
