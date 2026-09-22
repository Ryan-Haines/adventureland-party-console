const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorEventReturns } = require('../../runtime/coordinator/events/return-composition.ts');
function fixture() {
  const state = { eventReturn: null, eventReturnLast: null, deferredEventReturns: {}, nextCommandId: 10,
    merchantCharacter: 'M', statuses: { A: { map: 'cave' }, B: { map: 'cave' } }, commands: {},
    abtestingStrategy: { mode: 'uniform' }, activeConvoy: null, townCycle: null,
    anniversary: { eventCycle: null }, eventSessions: {} };
  const checkpoint = { map: 'main', x: 5, y: 6 }, calls = [];
  const ports = { now: () => 100, activeNames: () => ['A','B','M'], enabled: name => name !== 'M',
    checkpoint: () => checkpoint, cancelConvoy: () => { state.activeConvoy = null; },
    startConvoy: (...args) => { calls.push(['convoy', ...args]); state.activeConvoy = { id: 'exit', phase: 'assemble', participants: args[2] }; return true; },
    anniversaryParticipants: () => [], persist: () => calls.push('persist'),
    navigation: { capture: () => ({}), dispatch: (...args) => { calls.push(['dispatch', ...args]); return true; },
      reconcile: () => true, finish: (...args) => calls.push(['finish', ...args]) } };
  return { state, checkpoint, calls, service: createCoordinatorEventReturns(state, ports) };
}
test('A/B recovery writes through, clears strategy and allocates cycle/Town IDs in order', () => {
  const f = fixture(), recovery = f.service.begin('abtesting');
  assert.equal(f.state.eventReturn, recovery); assert.equal(f.state.abtestingStrategy, null);
  assert.equal(recovery.cycleId, 'event-return-100-10');
  assert.deepEqual(f.state.commands.A, { id: 11, type: 'event-return-town', cycleId: recovery.cycleId, event: 'abtesting', checkpoint: f.checkpoint });
  assert.equal(f.state.commands.B.id, 12); assert.equal(f.state.nextCommandId, 13);
  assert.equal(f.state.commands.A.checkpoint, f.checkpoint);
  recovery.pending = []; f.service.finishIfReady();
  const dispatch = f.calls.find(call => Array.isArray(call) && call[0] === 'dispatch');
  assert.equal(dispatch[1], recovery); assert.equal(dispatch[2], 'event-return'); assert.deepEqual(dispatch[3], ['A','B']);
});
test('Franky recovery starts the exact Mainland exit convoy and suppresses initial Town for its passengers', () => {
  const f = fixture(), recovery = f.service.begin('franky');
  assert.deepEqual(f.calls[0], ['convoy', { map: 'main', x: 0, y: 0 }, 'Mainland exit', ['A','B'], 'franky-exit']);
  assert.equal(recovery.exitConvoyId, 'exit'); assert.deepEqual(f.state.commands, {});
});
