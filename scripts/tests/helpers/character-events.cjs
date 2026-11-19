// The events owner's character facts (runtime/events/character/combat.ts `installEventFacts`) for a vm context
// that runs shared.js code, or a bundle that asks api.ts `eventFacts()`. shared.js installs them
// first at load, each port a read of its own state (characters/shared.js `characterEvents`); this
// file installs them over the context's variables of the same names (`eventAttend`,
// `eventTargetTypes`, `eventSettings`, `eventExit`,
// `eventAnniversary`, `merchantRunner`, the game's `G`, `character` and `parent.entities`), each
// read at the ask, so a test that changes one later reaches the facts. A context with no
// `eventAttend` reads no event.
//
// A test replaces a fact by planting `characterEvents` with that fact before the install; the
// installed facts take each planted member over their own, and from then on `context.characterEvents`
// is the installed facts, which a test may change. The facts go to the context's realm, where a
// bundle run in the context asks them, and to this realm's, where a module this process requires
// asks them; the newest install answers there.
const { installEventFacts } = require('../../../runtime/events/character/combat.ts');

// Attendance with no event (attend.ts): no selection, no marker, no sighting, and a rejoin that
// does not apply.
const NO_ATTEND = { selected: () => false, joined: () => null, traveling: () => null, active: () => null, owns: () => false,
  sighting: () => null, rejoin: async () => ({ status: 'not-applicable' }), rejoinPending: () => null };

exports.installCharacterEvents = context => {
  if (Object.prototype.hasOwnProperty.call(context, '__partyEventFacts')) {
    globalThis.__partyEventFacts = context.__partyEventFacts;
    return context.__partyEventFacts;
  }
  const planted = context.characterEvents && typeof context.characterEvents === 'object' ? context.characterEvents : {};
  const has = name => typeof context[name] === 'function';
  const attend = () => ({ ...NO_ATTEND, ...context.eventAttend });
  const realm = () => context.root && typeof context.root === 'object' ? context.root : context;
  const facts = installEventFacts({
    game: () => context.G || {}, limits: name => (context.eventSettings || {})[name],
    character: () => context.character, entities: () => (context.parent && context.parent.entities) || {},
    attend, activity: () => null, clockOffset: () => (context.walkState && context.walkState.clockOffset) || 0,
    // The targeting owner's member reports through the context's targeting module (targeting-module.cjs).
    members: () => context.targeting.positions(),
    inPvp: () => has('in_pvp') && !!context.in_pvp(), targetTypes: () => context.eventTargetTypes || [],
    exitPending: () => !!context.eventExit?.pending?.(), exiting: () => !!context.eventExit?.exiting?.(),
    leaveEventMap: (current, request) => context.eventExit ? context.eventExit.leaveEventMap(current, request) : Promise.resolve(false),
    travelling: () => !!(attend().traveling() || (context.eventAnniversary?.busy?.() || context.eventAnniversary?.staging?.()) && !context.convoyDefense),
    recovering: () => { const staging = context.eventAnniversary?.operation?.(); return !!(staging && !staging.cancelled || context.eventExit?.returning?.()); },
    merchantJob: () => context.merchantRunner?.holder?.() ?? null,
    inRange: target => has('is_in_range') && !!context.is_in_range(target),
    approachPoint: target => context.combatApproachPoint(target),
    canMoveTo: (x, y) => has('can_move_to') && !!context.can_move_to(x, y),
    safePoint: (point, target) => context.safeCombatPoint(point, target),
    step: (target, point, mode, closes) => context.sendCombatMove(target, point, mode, closes),
    resetSteps: () => context.resetCombatMovement(), position: record => { realm().partyCombatPosition = record; },
    now: () => (context.Date || Date).now(),
    frankyAllows: target => context.frankyTargetAllowed(target),
    returnFight: () => has('returnCombatActive') && !!context.returnCombatActive(),
    cancelReturnTown: () => context.cancelReturnTownUnderAttack(),
  });
  Object.assign(facts, planted);
  context.characterEvents = facts;
  context.__partyEventFacts = facts;
  return facts;
};
