// The coordinator travel clock (a shared setup lives in the harness).
const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorTravelClock, authorizeCoordinatorFarmingRoute} = require('../../../runtime/movement/coordinator/runtime.ts');
const {coordinatorEventCheckpoint} = require('../../../runtime/events/coordinator/returns.ts');
const {createAnniversaryReturns} = require('../../../runtime/events/coordinator/anniversary.ts');



function clockFixture() {
  const state = {activeConvoy: null}, calls = [], intervals = [];
  const ports = {convoyStep: () => {calls.push('convoy'); return true;}, persist: () => calls.push('persist'),
    every: (callback, ms) => intervals.push({callback, ms})};
  // The events owner's anniversary dispatch left the clock; the row reads it beside the clock, with a
  // visit whose every participant is ready, so each dispatch it makes is one walk.
  const anniversary = {eventCycle: {id: 'r1', startsAt: 0, endsAt: 10, participants: ['A'], target: 'B'}, returnReady: {A: {at: 1}}};
  const returns = createAnniversaryReturns(anniversary, {now: () => 5, merchant: () => null, participants: () => ['A'], activeNames: () => ['A'],
    townBusy: () => false, convoyBusy: () => !!state.activeConvoy, log() {}, persist() {},
    dispatch: (cycle, names) => {calls.push(['dispatch', names]); cycle.returnDispatchedAt = 5; return true;}});
  const clock = {...createCoordinatorTravelClock(ports), anniversary: returns};
  return {state, calls, intervals, ports, clock};
}

module.exports = { clockFixture };
