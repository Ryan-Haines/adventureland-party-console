// Gives a vm context that runs sliced shared.js code the member's combat steps
// (runtime/movement/character/steps.ts `createCombatSteps`) once, each port read live from the
// context's globals as shared.js's install reads its own, so a test that changes `can_move_to` or
// `eventAttend` after creation reaches the module. The host is the context's `root` as it stands at
// each read (the global in production); the game reads are the context's. The joined event, the
// Franky fight, its tick, the event boss and the boss approach are the events owner's facts
// (helpers/character-events.cjs), as shared.js hands them from `eventAttend` and `characterEvents`. A stand-in the context leaves out answers as
// shared.js's `typeof` checks did before the move: no return combat and no intercept. The
// context's own kite fields seed the module's kite state, and from then on `context.kiteState` is
// the module's. A stub the context defines of a step function stays the sliced code's.
const { contextHost } = require('./context-host.cjs');
const { createCombatSteps } = require('../../../runtime/movement/character/steps.ts');
const { walkClient } = require('./walk-reports.cjs');
const { installCharacterEvents } = require('./character-events.cjs');

const STEP_NAMES = ['isCurrentlyKiting', 'desiredCombatRange', 'combatDistance', 'combatApproachPoint', 'resetCombatMovement',
  'sendCombatMove', 'safeCombatPoint', 'kiteIfNeeded', 'approachCombatTarget', 'queueRecoveryMove', 'queueCoverageCost',
  'queueRecoveryReason'];
exports.installCombatSteps = context => {
  const host = contextHost(context, new Set(['parent', 'get_entity', 'is_in_range', 'can_move_to', 'distance', 'can_walk', 'can_move']));
  const call = (name, ...args) => context[name](...args);
  const read = (name, absent) => (...args) => typeof context[name] === 'function' ? context[name](...args) : absent;
  installCharacterEvents(context);
  const events = () => context.characterEvents;
  const steps = createCombatSteps(host, walkClient(context), {
    now: () => (context.Date || Date).now(), character: () => context.character, movement: () => context.movement,
    current: () => call('runtimeCurrent'), intent: () => context.navigationIntent, joinedEvent: () => events().joinedEventName(),
    following: () => context.followingLeader, forceTraveling: () => context.forceTraveling,
    townTraveling: () => context.townTraveling, departurePending: () => context.departurePending,
    formation: () => context.formationState, performance: () => context.formationPerformance,
    independentApproachOwns: () => call('independentApproachOwnsJourney'),
    interceptCenter: read('combatInterceptCenter', null), returning: read('returnCombatActive', false),
    franky: () => events().frankyActive(), frankyTick: target => events().frankyTick(target),
    eventBoss: target => events().bossMovement(target), fightsAdds: name => events().fightsAdds(name),
    groupedCombat: () => context.groupedCombat, safePoint: point => call('formationRecoverySafePoint', point),
  });
  Object.assign(steps.kiteState, context.kiteState);
  context.kiteState = steps.kiteState;
  for (const name of STEP_NAMES) if (!(name in context)) context[name] = steps[name];
  return context;
};
