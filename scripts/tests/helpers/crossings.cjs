// The farm reunion's crossings (runtime/movement/character/crossings.ts) in a sliced test's vm
// context, with shared.js's ports (characters/shared.js `installReunionCrossings`) read live from
// the context's globals, so a test that changes `reunion` or `smart_move` after creation reaches the
// module. The member reports are the targeting owner's, read through the context's targeting module. Movement's own
// ports come from install.ts `crossingsPorts` over the context's walk state, stop and requesters
// (helpers/requesters.cjs). The handlers go on the context's `root`.
const { installReunionCrossings } = require('../../../runtime/movement/character/crossings.ts');
const { crossingsPorts, reunionMovement } = require('../../../runtime/movement/character/install.ts');
const { plantWalkState } = require('./walk-state.cjs');
const parts = context => ({ movement: () => context.movement, stop: (...args) => context.stop(...args), requesters: () => context });

function installCrossings(context) {
  const call = (name, ...args) => context[name](...args);
  plantWalkState(context);
  const crossings = installReunionCrossings(context, {
    ...crossingsPorts(context.walkState, parts(context), { sharedPartyWalk: (...args) => call('sharedPartyWalk', ...args) }),
    now: () => (context.Date || Date).now(),
    character: () => context.character, G: () => context.G, root: () => context.root,
    reunion: () => context.reunion, reunionBlocked: () => call('reunionBlocked'), reunionMembers: () => call('reunionMembers'),
    reunionCurrent: token => call('reunionCurrent', token),
    acceptEscapePort: name => typeof context.acceptEscapePort === 'function' ? context.acceptEscapePort(name) : false,
    partyLocation: () => context.partyLocation, partyPositions: () => context.targeting.positions(),
    desiredPartyMembers: () => context.desiredPartyMembers, leader: () => context.leader,
    scatter: () => context.farmingMode === 'scatter', engagedMonster: () => call('engagedMonster'),
    entryPoint: location => call('farmingEntryPoint', location),
    smartMove: (destination, callback, options) => call('smart_move', destination, callback, options),
    sleep: ms => call('sleep', ms),
    // The owner's next scheduler pass (owner.ts `nextPass`). A sliced context runs no scheduler, so a
    // 100 ms sleep of its own stands in for a pass, as the Blink landing's sleep did before.
    nextPass: () => call('sleep', 100),
  });
  Object.assign(context, crossings);
  return crossings;
}
// The tasks owner's farm reunion (runtime/tasks/character/assignment.ts `installFarmReunion`) in the same
// context, with shared.js's ports read live from its globals. The crossings are the reunion's walk:
// movement's `ReunionMovement` is install.ts `reunionMovement` over the context's crossings, its
// requesters, the walk client (helpers/walk-reports.cjs) and its kite, built at each read so a stub
// the test plants later reaches the reunion. `reunion` reads the module's token.
function installReunion(context) {
  const call = (name, ...args) => context[name](...args);
  const { installFarmReunion } = require('../../../runtime/tasks/character/assignment.ts');
  const { contains } = require('../../../runtime/hunting/zones.ts');
  const { walkClient } = require('./walk-reports.cjs');
  const walks = () => reunionMovement(context.walkState, { requesters: context, crossings: context, walkClient: walkClient(context),
    kite: context.kiteState || (context.kiteState = {}) });
  const reunions = installFarmReunion({
    now: () => (context.Date || Date).now(), root: context.root, parent: context.parent, walkState: context.walkState, walks,
    movement: { live: () => context.movement.live?.() ?? null, fresh: (...args) => context.movement.fresh(...args), stop: (...args) => call('stop', ...args) },
    character: () => context.character, current: () => call('runtimeCurrent'), dungeonOwned: () => call('dungeonOwned'),
    lastDeath: () => context.lastDeathInfo, deathRecoveryRequest: () => call('deathRecoveryRequest'), farmTravel: () => context.farmingTravelToken,
    setCombatTarget: id => { context.combatTargetId = id; }, eventRecovery: () => context.eventRecoveryState,
    partyLocation: () => context.partyLocation, partyPositions: () => context.targeting.positions(),
    desiredPartyMembers: () => context.desiredPartyMembers, leader: () => context.leader,
    // The targeting owner's attacker rule (shared.js `isAttackingPartyMember`), from the context's targeting module.
    attacking: entity => call('isAttackingPartyMember', entity),
    request: (...args) => call('request', ...args), farmingTravelTarget: command => call('farmingTravelTarget', command),
    // shared.js's bag facts, read from the context's own flags.
    bagBusy: () => !!(context.banking || context.bankQueued || context.stocking || context.upgrading),
    // A context with no farm area rule asks hunting's own area test (zones.ts `contains`) at its
    // default radius, as shared.js's `farm.inArea` does for a spot with no shape.
    farmingEntryPoint: location => call('farmingEntryPoint', location),
    inFarmArea: (target, location, margin) => typeof context.inFarmArea === 'function' ? call('inFarmArea', target, location, margin) : contains(location, target, margin),
    farmRadius: () => context.farmRadius ?? 400,
    canMoveTo: (x, y) => call('can_move_to', x, y), log: (message, color) => call('game_log', message, color),
  }, { taskKind: () => call('taskKind'), reunionAssigned: command => call('reunionAssigned', command), eventReturnHolds: () => call('eventReturnHolds') });
  const { currentReunion, ...answers } = reunions;
  Object.assign(context, answers);
  Object.defineProperty(context, 'reunion', { configurable: true, enumerable: true, get: currentReunion });
  return reunions;
}
module.exports = { installCrossings, installReunion };
