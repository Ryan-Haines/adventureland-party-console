// Movement's walk state for a context that runs shared.js functions.
// In play, shared.js reads the
// navigation intent, the runtime id, the coordinator's clock difference, the walk flags, the departure,
// the party's farm spot and the farm travel pause as `walkState`, the movement owner's state
// (runtime/movement/character/owner.ts `WalkState`). A sliced context keeps them as its own variables
// under the names shared.js gave them before the move, so `plantWalkState` gives a context that names
// no `walkState` one whose fields read and write those variables.

const FIELDS = { intent: 'navigationIntent', runtimeId: 'convoyRuntimeId', clockOffset: 'coordinatorClockOffset',
  following: 'followingLeader', forceTraveling: 'forceTraveling', convoyActive: 'partyConvoyActive',
  townTraveling: 'townTraveling', townActive: 'partyTownActive', departing: 'departurePending',
  partyLocation: 'partyLocation', farmTravelPaused: 'farmTravelPaused' };

// `state` defaults to a new object; a harness that installs the real owner binds the owner's own
// `walkState` the same way, so the owner and the sliced functions read one state.
function walkStateOf(context, state = {}) {
  for (const [field, name] of Object.entries(FIELDS))
    Object.defineProperty(state, field, { enumerable: true, configurable: true, get: () => context[name], set: value => { context[name] = value; } });
  return state;
}

// A test that runs a sliced walk function calls this on its own context. A `walkState` the test
// planted stays; a test that sets one later replaces it.
function plantWalkState(context) {
  if (Object.prototype.hasOwnProperty.call(context, 'walkState')) return context;
  let state;
  Object.defineProperty(context, 'walkState', { configurable: true, enumerable: false,
    get: () => (state ??= walkStateOf(context)), set: value => { state = value; } });
  return context;
}

module.exports = { walkStateOf, plantWalkState };
