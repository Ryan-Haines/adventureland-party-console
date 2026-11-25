// The member's group movement (runtime/movement/character/formation.ts `installGroupMovement`) in a
// sliced test's vm context, each port read live from the context's globals as movement's install
// (runtime/movement/character/install.ts:165) reads shared.js's, so a test that changes `groupedCombat` or `get_entity` after creation reaches the
// module. The host is the context's `root`, which is the global in production; its game calls are
// the context's. A hunt or rare stand-in the context leaves out answers as none, as shared.js's
// `typeof` checks did before the move.
const { installGroupMovement } = require('../../../runtime/movement/character/formation.ts');
const {walkStatePorts}=require('./walk-state-ports.cjs');
const { walkClient } = require('./walk-reports.cjs');

exports.installGroupMoves = context => {
  const host = context.root || (context.root = {});
  if (host !== context) for (const name of ['parent', 'get_entity', 'get_player', 'can_move_to'])
    Object.defineProperty(host, name, { configurable: true, enumerable: false, get: () => context[name] });
  const call = (name, ...args) => context[name](...args);
  const read = (name, absent) => (...args) => typeof context[name] === 'function' ? context[name](...args) : absent;
  return Object.assign(context, installGroupMovement(host, walkClient(context), { ...walkStatePorts(context),
    now: () => (context.Date || Date).now(), character: () => context.character, G: () => context.G,
    movement: () => context.movement, intent: () => context.navigationIntent, groupedCombat: () => context.groupedCombat,
    clockOffset: () => context.coordinatorClockOffset, leader: () => context.leader, partyLocation: () => context.partyLocation,
    convoyActive: () => context.partyConvoyActive, nextReport: () => context.nextReport(),
    joinedEvent: () => context.joinedEvent, kite: () => context.kiteState,
    formation: () => context.formationState, rareControl: () => context.rareControlState,
    grouped: () => call('groupedFarming'), fresh: () => call('groupedFresh'), anchorVisible: () => call('groupedAnchorVisible'),
    defensiveTarget: () => call('groupedDefensiveTarget'), huntDefense: read('huntTravelDefense', false),
    huntControl: read('huntTravelControl', false), rareActive: read('rareActive', false), escaping: () => call('escapeOwns'),
    attacking: entity => call('isAttackingPartyMember', entity), passiveRare: target => call('passiveRareCandidate', target),
    passingKey: target => call('passingKey', target), realm: () => call('reunionRealm'),
    combatDistance: target => call('combatDistance', target), safeCombatPoint: (point, target) => call('safeCombatPoint', point, target),
    cancelFarmApproach: reason => call('cancelFarmApproach', reason), formationMove: target => call('formationMove', target),
    defensiveFormationMove: read('defensiveFormationMove', false),
    holdFormation: (reference, reason) => call('holdFormation', reference, reason),
    logGroupMovement: (key, message) => call('logGroupMovement', key, message), request: (path, options) => call('request', path, options),
    smartMove: (destination, callback, options) => call('smart_move', destination, callback, options),
    catchupRequest: route => call('catchupRequest', route), endTaskWalk: owner => call('endTaskWalk', owner),
    climbTaskWalk: walk => call('climbTaskWalk', walk),
  }));
};
