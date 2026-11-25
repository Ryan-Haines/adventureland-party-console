const test = require('node:test'), assert = require('node:assert/strict');
const {createCoordinatorTravelClock} = require('../../runtime/movement/coordinator/runtime.ts');
const {coordinatorEventCheckpoint} = require('../../runtime/events/coordinator/returns.ts');


const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {testRegistry,restoreGlobals}=require('./helpers/test-registry.cjs');
const {clockFixture}=require('./fixtures/coordinator-travel-runtime-scenario.cjs');
scenarioTable('the travel clock steps every convoy and the escape on its interval (MOV-146, MOV-158)', clockFixture, [
 ['event checkpoint follows the current leader and keeps the original numeric coercion', ()=>{
  const state = {leader: 'W'}, calls = [], points = {W: {map: 'cave', x: '10', y: '20', label: ''}, P: {map: 'main', x: null, y: '0', label: 'Home'}};
  const waypoint = name => {calls.push(name); return points[name];};
  assert.deepEqual(coordinatorEventCheckpoint(state, waypoint), {map: 'cave', x: 10, y: 20, label: 'the saved party checkpoint'});
  state.leader = 'P'; assert.deepEqual(coordinatorEventCheckpoint(state, waypoint), {map: 'main', x: 0, y: 0, label: 'Home'});
  points.P.x = Infinity; assert.equal(coordinatorEventCheckpoint(state, waypoint), null);
  delete points.P; assert.equal(coordinatorEventCheckpoint(state, waypoint), null); assert.deepEqual(calls, ['W', 'P', 'P', 'P']);
 }],
 // One 250 ms step for the convoy, saved after a step that changed it. The other owners'
 // ticks register their own intervals at the root (application.ts), so the clock runs none of them.
 ['the travel step runs every 250 ms and steps only the walks, saving after a change', t=>{
  t.clock.startTravel();
  assert.deepEqual(t.intervals.map(i => i.ms), [250]);
  t.intervals[0].callback(); assert.deepEqual(t.calls, ['convoy', 'persist']);
  t.calls.length = 0; t.ports.convoyStep = () => {t.calls.push('convoy'); return false;};
  t.intervals[0].callback(); assert.deepEqual(t.calls, ['convoy']);
 }],
 // EVT-043's dispatch is a progress rule: a visit's asks collapse into one mark, which
 // the next look settles at once with no walk, and on the walk's end while one holds the party.
 ['the anniversary dispatch waits for no walk to hold the party, and asks collapse into one', t=>{
  t.state.activeConvoy = {id: 'travel'};
  t.clock.anniversary.schedule(); t.clock.anniversary.schedule(); t.clock.anniversary.settle();
  assert.deepEqual(t.calls, [], 'a walk holds the party');
  t.state.activeConvoy = null; t.clock.anniversary.settle(); t.clock.anniversary.settle();
  assert.deepEqual(t.calls, [['dispatch', ['A']]], 'the walk ended: one dispatch');
 }],
]);

// The events owner looks when its state changes: a member's report looks at that member's group, a
// walk notice at the walk's group, a settings change at every group; the tasks owner's table gates each return,
// and a walk notice fired inside a look starts no second look. Its own test: the install registers
// into the realm's hook registry, which the clock fixture has no part of.
test('K6 looks at a member report, a walk notice and a settings change, one look at a time', t => {
 const {installEvents} = require('../../runtime/events/coordinator/install.ts');
 const hooks = testRegistry(t), partyHooks = () => hooks;
 restoreGlobals(t, ['__partyTaskAnswers', '__partyEventAnswers']);
 // The ingest asks 01 for the member's group (`tasks().groupOf`, 7ca7d4c1); these members walk in no group.
 require('../../runtime/tasks/api.ts').publishTasks({groupOf: () => null, live: () => null});
 const calls = [], runs = {'event-return': true, anniversary: true};
 const group = id => ({eventObservations: {admit() {}, observe() {}}, eventReturns: {reconcile() { calls.push(id); if (id === 'solo:B') partyHooks().notify('walk.ended', {group: 'solo:B'}); }}});
 const party = group('party'), solo = group('solo:B');
 const events = installEvents({statuses: {}, eventAttendance: {}, merchantCharacter: null, leader: 'A'}, {
  dungeons: {eventAllowed: () => true}, groups: {combat: () => [party, solo], solo: name => name === 'B' ? solo : null,
   walkGroup: key => ({'party:A': party, 'solo:B': solo})[key]},
  partyObservations: () => party.eventObservations, partyReturns: () => party.eventReturns, runs: kind => runs[kind],
  anniversary: () => ({tick: () => calls.push('anniversary'), schedule: () => calls.push('ask'), settle: () => calls.push('settle')}),
  observeTask() {}, activeNames: () => [], persist() {}});
 events.observe({name: 'A'}); assert.deepEqual(calls.splice(0), ['settle', 'party', 'anniversary']);
 events.observe({name: 'B'}); assert.deepEqual(calls.splice(0), ['settle', 'solo:B', 'anniversary'], 'the notice inside the look starts no look');
 partyHooks().notify('walk.ended', {group: 'party:A'}); assert.deepEqual(calls.splice(0), ['settle', 'party', 'anniversary']);
 partyHooks().notify('settings.changed', {field: 'farmingMode'}); assert.deepEqual(calls.splice(0), ['settle', 'party', 'solo:B', 'anniversary']);
 runs['event-return'] = false; runs.anniversary = false;
 events.observe({name: 'A'}); assert.deepEqual(calls.splice(0), ['settle'], "01's table runs neither return");
 events.anniversaryDispatch(); assert.deepEqual(calls.splice(0), ['ask', 'settle'], 'a route asks and the same look settles');
});
