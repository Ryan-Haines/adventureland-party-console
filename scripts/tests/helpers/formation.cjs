// Gives a vm context that runs sliced shared.js code the member's formation solver
// (runtime/movement/character/formation.ts `createFormationSolver`) once, each port read live from
// the context's globals as shared.js's install reads its own, so a test that changes `is_in_range`
// or `groupedCombat` after creation reaches the module. The host is the context's `root` as it
// stands at each read (the global in production); the game reads are the context's. The walk is
// the context's `groupWalk` and its travel defense reads. The joined event, the event walk, the event
// team and the Franky fight are the events owner's facts (helpers/character-events.cjs), as shared.js hands them
// from `eventAttend` and `characterEvents`, so a test that changes `eventAttend` reaches them. The
// context's own formation fields seed the module's record, and from then on
// `context.formationState` and `context.formationPerformance` are the module's. A stub the context
// defines of a formation function stays the sliced code's.
const { contextHost } = require('./context-host.cjs');
const { createFormationSolver } = require('../../../runtime/movement/character/formation.ts');
const {walkStatePorts}=require('./walk-state-ports.cjs');
const { installCharacterEvents } = require('./character-events.cjs');

exports.installFormation = context => {
  if (context.__formation) return context;
  const host = contextHost(context, new Set(['parent', 'get_player', 'get_entity', 'is_in_range', 'can_move_to', 'can_move', 'distance', 'draw_line', 'draw_circle']));
  const call = name => (...args) => context[name](...args);
  const walk = { get groupWalk() { return context.groupWalk || { travel: null }; },
    travelCombatActive: call('travelCombatActive'), currentTravelAttackers: call('currentTravelAttackers') };
  installCharacterEvents(context);
  const events = () => context.characterEvents;
  const formation = createFormationSolver(host, walk, { ...walkStatePorts(context),
    now: () => (context.Date || Date).now(), clockOffset: () => context.coordinatorClockOffset,
    character: () => context.character, G: () => context.G, movement: () => context.movement,
    partyList: call('currentPartyList'), partyPositions: () => context.targeting.positions(), realm: call('reunionRealm'),
    groupedCombat: () => context.groupedCombat, grouped: call('groupedFarming'), joinedEvent: () => events().joinedEventName(),
    scatter: () => context.farmingMode === 'scatter',
    leader: () => context.leader, followLeader: () => context.followLeader, sameTeam: member => events().sameTeam(member),
    leaderSelection: () => context.leaderCombatSelection, franky: () => events().frankyActive(),
    bagErrand: () => !!(context.banking || context.bankQueued || context.stocking), departurePending: () => !!context.departurePending,
    convoyActive: () => context.partyConvoyActive, following: () => context.followingLeader, kite: () => context.kiteState,
    combatDistance: call('combatDistance'), desiredCombatRange: call('desiredCombatRange'),
    resetCombatMovement: call('resetCombatMovement'), sendCombatMove: call('sendCombatMove'),
    safeCombatPoint: call('safeCombatPoint'), combatApproachPoint: call('combatApproachPoint'), kiteIfNeeded: call('kiteIfNeeded'),
    independentApproach: () => context.independentApproach, independentApproachOwns: call('independentApproachOwnsJourney'),
    interceptCenter: call('combatInterceptCenter'), rangeReference: call('combatRangeReference'),
    cancelFarmApproach: call('cancelFarmApproach'), intent: () => context.navigationIntent, dungeonOwned: call('dungeonOwned'),
    fresh: call('groupedFresh'), unfinishedFight: call('unfinishedFight'), activeEvent: (...args) => context.eventAttend.active(...args),
    recoveryHolds: call('combatRecoveryHolds'), covered: call('groupedCovered'), cancelGroupRoute: call('cancelGroupRoute'),
    recoveryRequest: () => context.terrainRecoveryRequest, smartMove: (...args) => context.smart_move(...args),
    stop: request => context.stop('smart', undefined, request), logEvent() {},
  });
  Object.assign(formation.formationState, context.formationState);
  context.formationState = formation.formationState;
  context.formationPerformance = formation.formationPerformance;
  for (const [name, value] of Object.entries(formation)) if (!(name in context)) context[name] = value;
  Object.defineProperty(context, '__formation', { value: formation, enumerable: false, configurable: true });
  return context;
};
