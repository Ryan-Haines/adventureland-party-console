const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorTravelClock, authorizeCoordinatorFarmingRoute, coordinatorEventCheckpoint} = require('../../runtime/coordinator/navigation/runtime.ts');

function clockFixture() {
  const state = {activeConvoy: null}, calls = [], intervals = [], timeouts = [];
  const ports = {convoyStep: () => {calls.push('convoy'); return true;}, persist: () => calls.push('persist'),
    escapeStep: () => calls.push('escape'), disengagementTick: () => calls.push('disengage'), rareTick: () => calls.push('rare'),
    eventReturn: () => calls.push('event'), anniversaryTick: () => calls.push('anniversary'),
    dispatchAnniversary: force => calls.push(['dispatch', force]),
    every: (callback, ms) => intervals.push({callback, ms}),
    later: (callback, ms) => {timeouts.push({callback, ms}); return timeouts.length;}, cancel: id => calls.push(['cancel', id])};
  const clock = createCoordinatorTravelClock(state, ports);
  return {state, calls, intervals, timeouts, ports, clock};
}

test('travel clocks retain tick order, cadence and failure propagation', () => {
  const t = clockFixture(); assert.deepEqual(t.intervals, []);
  t.clock.startTravel(); t.clock.startReturns(); assert.deepEqual(t.intervals.map(timer => timer.ms), [250, 1000]);
  t.intervals[0].callback(); t.intervals[1].callback();
  assert.deepEqual(t.calls, ['convoy', 'persist', 'escape', 'disengage', 'rare', 'event', 'anniversary']);
  t.calls.length = 0; t.ports.convoyStep = () => false; t.intervals[0].callback();
  assert.deepEqual(t.calls, ['escape', 'disengage', 'rare']);
  const failure = Error('return failure'); t.ports.eventReturn = () => {throw failure;};
  t.calls.length = 0; assert.throws(t.intervals[1].callback, error => error === failure); assert.deepEqual(t.calls, []);
});

test('anniversary delay replaces pending timers and retries against current convoy ownership', () => {
  const t = clockFixture(); t.clock.scheduleAnniversary(); t.clock.scheduleAnniversary();
  assert.deepEqual(t.calls, [['cancel', null], ['cancel', 1]]);
  t.state.activeConvoy = {id: 'travel'}; t.timeouts[1].callback();
  assert.deepEqual(t.calls.at(-1), ['cancel', null]); assert.equal(t.timeouts.length, 3);
  assert.ok(t.timeouts.every(timer => timer.ms === 2500));
  t.state.activeConvoy = null; t.timeouts[2].callback(); assert.deepEqual(t.calls.at(-1), ['dispatch', false]);
});

test('farming authorization resets the state that exists after Escape release', () => {
  const old = {paused: true}, state = {farmAreaState: old}, replacement = {paused: true, pending: 'work', failures: {a: 1}, message: 'blocked', retained: 'zone'};
  const names = ['W', 'P'], location = {map: 'winterland', x: 20, y: -1109}; let authorized = false;
  authorizeCoordinatorFarmingRoute(state, names, location, true, {
    release: () => {state.farmAreaState = replacement;}, authorize: (members, target, shared) => {
      assert.equal(members, names); assert.equal(target, location); assert.equal(shared, true);
      assert.deepEqual(replacement, {paused: false, pending: null, failures: {}, message: null, retained: 'zone', recoveryVersion: 2});
      authorized = true;
    },
  });
  assert.equal(authorized, true); assert.equal(old.paused, true); assert.equal(state.farmAreaState, replacement);
});

test('event checkpoint follows the current leader and keeps the original numeric coercion', () => {
  const state = {leader: 'W'}, calls = [], points = {W: {map: 'cave', x: '10', y: '20', label: ''}, P: {map: 'main', x: null, y: '0', label: 'Home'}};
  const waypoint = name => {calls.push(name); return points[name];};
  assert.deepEqual(coordinatorEventCheckpoint(state, waypoint), {map: 'cave', x: 10, y: 20, label: 'the saved party checkpoint'});
  state.leader = 'P'; assert.deepEqual(coordinatorEventCheckpoint(state, waypoint), {map: 'main', x: 0, y: 0, label: 'Home'});
  points.P.x = Infinity; assert.equal(coordinatorEventCheckpoint(state, waypoint), null);
  delete points.P; assert.equal(coordinatorEventCheckpoint(state, waypoint), null); assert.deepEqual(calls, ['W', 'P', 'P', 'P']);
});
