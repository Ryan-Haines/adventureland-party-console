// The member's assignment (runtime/tasks/character/assignment.ts) and the movement requesters
// (runtime/movement/character/owner.ts) in a sliced test's vm context, for the shared
// harness (fixtures/movement-owner-callers.cjs) and createSharedContext.
const { installTaskAssignment } = require('../../../runtime/tasks/character/assignment.ts');
const {walkStatePorts}=require('./walk-state-ports.cjs');
const { installMovementRequesters } = require('../../../runtime/movement/character/owner.ts');
const { walkClient } = require('./walk-reports.cjs');
const { installCharacterHolds } = require('../../../runtime/tasks/character/holds.ts');
const { partyHooks } = require('../../../runtime/hooks/index.ts');

// shared.js's ports (characters/shared.js `installTaskAssignment`, `installMovementRequesters`),
// read live from the context, so a test that sets `coordinatorCommand` or `movement` after creation
// reaches the modules; the assignment keeps the task a test hands its `receiveTask`. The assignment
// registers its apart walk's end on the realm's registry, which movement notifies, as shared.js:320
// passes `root.__partyHooks`.
function installRequesters(context, { missingOnly = false } = {}) {
  const call = (name, ...args) => context[name](...args);
  const smartMove = (destination, callback, options) => call('smart_move', destination, callback, options);
  const assignment = installTaskAssignment({ character: () => context.character,
    partyLocation: () => context.partyLocation, smartMove, hooks: partyHooks() });
  const requesters = { ...assignment, ...installMovementRequesters(walkClient(context), { now: () => (context.Date || Date).now(), movement: () => context.movement,
    smartMove,
    character: () => context.character, G: () => context.G, sleep: ms => call('sleep', ms), root: () => context.root,
    current: () => call('runtimeCurrent'), sharedMovementOptions: command => call('sharedMovementOptions', command),
    coordinatorCommand: () => ({ command: context.coordinatorCommand, seen: !!context.coordinatorCommandSeen }),
    assignedTier: fallback => context.assignedTier(fallback),
    withTimeout: (promise, ms, label) => call('anniversaryWithTimeout', promise, ms, label),
    request: (path, options) => call('request', path, options), returnPhaseRecord: (command, kind) => call('returnPhaseRecord', command, kind),
    ...walkStatePorts(context), keepReturnProgress: progress => { context.parent.__partyReturnProgress = context.root.__partyReturnProgress = progress; },
    escaping: () => call('escapeOwns'), town: () => ({ active: !!context.partyTownActive, traveling: !!context.townTraveling }),
    setDeparture: pending => { context.departurePending = pending; }, endFollow: () => { context.followingLeader = false; },
    respawn: by => call('survivalRespawnWhenAllowed', by),
    parent: () => context.parent }) };
  if (!('coordinatorCommandSeen' in context)) context.coordinatorCommandSeen = false;
  for (const [name, value] of Object.entries(requesters)) if (!missingOnly || !(name in context)) context[name] = value;
  installHolds(context, { missingOnly });
}
// The character's own hold (runtime/tasks/character/holds.ts) with shared.js's ports, read live
// from the context, so a test that sets `followMe` later reaches it; a hold goes through `handReply`.
// shared.js always defines escapeOwns, apartFromEvent, groupedFarming, groupedFollower and
// eventAttend, so a test whose row reaches one plants it. The A/B test is the events owner's fact
// (`characterEvents.liveAbtesting`, helpers/character-events.cjs), none in a context without the facts.
function installHolds(context, { missingOnly = false } = {}) {
  const read = name => () => context[name]();
  const holds = installCharacterHolds({ name: () => context.character?.name,
    escaping: read('escapeOwns'), followMe: () => context.followMe ?? null, partyLocation: () => context.partyLocation ?? null,
    cancelled: () => !!context.walkState?.intent?.cancelled, combatEvent: () => !!context.eventAttend.active(), apart: read('apartFromEvent'),
    eventReturn: () => !!context.eventExit?.returning(), groupedFarming: read('groupedFarming'),
    groupedCombat: () => context.groupedCombat ?? null, walkFollower: read('groupedFollower'), leader: () => context.leader ?? null,
    followLeader: () => !!context.followLeader, abtesting: () => !!context.characterEvents?.liveAbtesting(),
    partyPositions: () => context.targeting.positions(),
    team: () => typeof context.characterEvents?.team === 'function' ? context.characterEvents.team(context.character) : null });
  for (const [name, value] of Object.entries(holds)) if (!missingOnly || !(name in context)) context[name] = value;
  return holds;
}
// The events owner's `event.presence` answer (runtime/events/api.ts) for a test that builds
// statuses with no task owner. The events owner's source.ts writes the same fact on each member's status, so the
// answer reads it there; a status with none is at no event.
function publishPresence(statuses = () => ({})) {
  require('../../../runtime/events/api.ts').publishEventAnswers({ presence: name => statuses()?.[name]?.presence ?? null });
}
module.exports = { installRequesters, installHolds, publishPresence };
