const test = require('node:test'), assert = require('node:assert/strict');
const { createCoordinatorAnniversaryReturns } = require('../../runtime/coordinator/anniversary/return-composition.ts');
test('anniversary composition waits for current travel owners and dispatches/reconciles through shared navigation', () => {
  const cycle = { id: 'round', target: 'Other', startsAt: 0, endsAt: 100, participants: ['A'], returnRoutes: {} };
  const state = { anniversary: { eventCycle: cycle, abortedRounds: {}, partyHold: null, },
    merchantCharacter: 'M', deferredEventReturns: {}, activeConvoy: {}, townCycle: null };
  const calls = [];
  const service = createCoordinatorAnniversaryReturns(state, { now: () => 100, participants: () => ['A'], activeNames: () => ['A'],
    log() {}, persist: () => calls.push('persist'), schedule() {}, navigation: {
      intent: () => ({ revision: 1 }), location: () => null, capture: () => ({}),
      dispatch: (...args) => { calls.push(['dispatch', ...args]); cycle.returnDispatchedAt = 100; return true; },
      reconcile: (...args) => calls.push(['reconcile', ...args]),
    } });
  assert.equal(service.dispatch(true), false);
  state.activeConvoy = null; state.townCycle = {}; assert.equal(service.dispatch(true), false);
  state.townCycle = null; assert.equal(service.dispatch(true), true);
  assert.equal(calls[0][1], cycle); assert.deepEqual(calls[0].slice(2), ['anniversary-return', ['A']]);
  service.reconcile('A', {});
  assert.deepEqual(calls.at(-1), ['reconcile', cycle, 'anniversary-return']);
});
