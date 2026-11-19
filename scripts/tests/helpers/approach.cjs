// Gives a vm context that runs sliced shared.js code the member's own approaches
// (runtime/movement/character/approach.ts `createApproach`) once, each port read live from the
// context's globals as shared.js's install reads its own, so a test that changes `is_in_range` or
// `groupedCombat` after creation reaches the module. The host is the context's `root` as it stands
// at each read (the global in production); the game reads are the context's. The walk is the
// context's `groupWalk` and `groupedFollower`, which are the walk client's once
// helpers/walk-reports.cjs installs it. A stand-in the context leaves out answers as shared.js's
// `typeof` checks did before the move: no defensive target, rare, unfinished fight or grouped
// follower. The events owner's derived marker and the anniversary are read as shared.js's install reads them, from
// the attendance (`eventAttend`) and the anniversary module (`eventAnniversary`); a context that
// plants neither stands outside any event. A record or stub the context defines of an approach name,
// such as targeting's planted `farmApproach`, stays the sliced code's.
const { contextHost } = require('./context-host.cjs');
const { createApproach } = require('../../../runtime/movement/character/approach.ts');
const {walkStatePorts}=require('./walk-state-ports.cjs');

exports.installApproach = context => {
  if (context.__approach) return context;
  const host = contextHost(context, new Set(['parent', 'get_entity', 'is_in_range', 'can_move_to', 'distance', 'can_move', 'can_walk']));
  const walk = { get groupWalk() { return context.groupWalk || { travel: null }; },
    groupedFollower: () => typeof context.groupedFollower === 'function' && context.groupedFollower() };
  const call = name => (...args) => context[name](...args);
  const read = (name, absent) => (...args) => typeof context[name] === 'function' ? context[name](...args) : absent;
  const approach = createApproach(host, walk, { ...walkStatePorts(context),
    now: () => (context.Date || Date).now(), clockOffset: () => context.coordinatorClockOffset,
    // The registry's notice, when the context installs one.
    notify: (name, payload) => context.__partyHooks && context.__partyHooks.notify(name, payload),
    character: () => context.character, movement: () => context.movement, current: call('runtimeCurrent'),
    intent: () => context.navigationIntent, joinedEvent: () => context.eventAttend?.joined() ?? null,
    anniversary: () => ({ staging: !!context.eventAnniversary?.staging(), busy: !!context.eventAnniversary?.busy() }),
    convoyActive: () => context.partyConvoyActive, groupedCombat: () => context.groupedCombat,
    grouped: call('groupedFarming'), fresh: call('groupedFresh'), partyLocation: () => context.partyLocation,
    farmTravelPaused: () => context.farmTravelPaused, lastAttackAt: () => context.lastAttackAt, attackReadyAt: read('attackReadyAt', null),
    inFarmArea: call('inFarmArea'), activeEvent: (...args) => context.eventAttend.active(...args), eventReturnHolds: call('eventReturnHolds'),
    rareActive: read('rareActive', false), unfinishedFight: read('unfinishedFight', false),
    defensiveTarget: read('groupedDefensiveTarget', null), dungeonOwned: call('dungeonOwned'),
    attacking: call('isAttackingPartyMember'), realm: call('reunionRealm'), journeyHandle: call('journeyHandle'),
    farmApproachRequest: call('farmApproachRequest'), smartMove: call('smart_move'),
    combatDistance: call('combatDistance'), combatApproachPoint: call('combatApproachPoint'),
    safeCombatPoint: call('safeCombatPoint'), resetCombatMovement: call('resetCombatMovement'),
    setFormationFrame: read('setFormationFrame', undefined), formationBody: call('formationBody'),
    formationMotion: call('formationMotion'), recoverCorner: call('recoverFormationCorner'),
    cancelGroupRoute: call('cancelGroupRoute'),
    // A context with no `nextReport` sends no report, so its wait never ends.
    nextReport: read('nextReport', new Promise(() => {})),
  });
  for (const [name, value] of Object.entries(approach)) if (!(name in context)) context[name] = value;
  Object.defineProperty(context, '__approach', { value: approach, enumerable: false, configurable: true });
  return context;
};
