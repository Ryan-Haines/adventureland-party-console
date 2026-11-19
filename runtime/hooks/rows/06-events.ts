// Owner 06's rows of the hook table: events. Only 06's build writes this file;
// runtime/hooks/registry.ts composes every owner's file into one `HOOKS` and one `SLOTS`.
import type { DecisionRow, PlainKind } from './row.ts';
import { doorOnly } from './row.ts';
import type { ActionRow, DispatchContext, ReadRow, EventAttendAsk, HookRow, SlotRow } from '../registry.ts';
import { addonKindProblem, type EventKindAnswer } from '../../events/api.ts';

export const HOOKS = {
  // Moved from the tasks owner's rows with `event.presence`. Its fixture is the tasks owner's live table row, which
  // runs the same setup.
  'member.presence': { side: 'coordinator', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: "e2e/live-tasks-hooks.spec.ts#L: the event takes the group: one started, one suspended",
    receives: 'member, presence, by', returns: 'nothing' },
  // The published coordinator reads: each reads K3 or K2 and changes nothing, so an
  // add-on may ask them.
  'event.presence': { side: 'coordinator', kind: 'request', part: 'events (06)', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'e2e/live-events-hooks.spec.ts#L: the add-on reads presence while attending',
    receives: 'a member name', returns: "the member's event, occurrence, realm, phase (walking, attending, returning) and since; or nothing" },
  // The character's published read: core:events answers it on each character.
  'event.targets': { side: 'character', kind: 'request', part: 'events (06)', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'e2e/live-events-hooks.spec.ts#L: the add-on reads the event targets while attending',
    receives: 'nothing', returns: "the current event's monster types and the area event of the map the character stands on" },
  'event.schedule': { side: 'coordinator', kind: 'request', part: 'events (06)', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'e2e/live-events-hooks.spec.ts#L: the add-on reads the schedule when due',
    receives: "an occurrence id (a group's event, `occurrenceId`)",
    returns: 'the spawn, the planned walk and its lead, the phase (scheduled, due, live) and the short window; or nothing' },
  // EVT-011's fact for the hunting owner's Hunt: the member's character reports `huntEventPending`.
  'event.pending': { side: 'coordinator', kind: 'request', part: 'events (06)', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'scripts/tests/coordinator-hunt-control.test.cjs#event.pending: a released Hunt waits while a member reports an event pending',
    receives: 'a member name', returns: "true while the member's latest report says its Hunt waits on an event" },
  // EVT-043's hold for the hunting owner's rare: the staging and the cycle's own return run no 01 task.
  'event.cycle': { side: 'coordinator', kind: 'request', part: 'events (06)', answers: 'one', core: true, addonMayAsk: true,
    fixture: "scripts/tests/coordinator-anniversary-control.test.cjs#event.cycle: a rare waits through the anniversary's staging and its return",
    receives: 'nothing', returns: 'true while the anniversary cycle is staged and its return has not completed, been superseded or handed to combat' },
  // K2's phases. The spawn time and R6 fix `due` and `missed`, so no add-on answers
  // them (EV-S7, reason 6).
  'event.scheduled': { side: 'coordinator', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: 'e2e/live-events-hooks.spec.ts#L: the Mr. Green spawn is scheduled',
    receives: 'event, occurrence, realm, spawnAt, by', returns: 'nothing' },
  'event.due': { side: 'coordinator', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: 'e2e/live-events-hooks.spec.ts#L: Mr. Green becomes due at the walk estimate',
    receives: 'occurrence, event, group, leadMs, by', returns: 'nothing' },
  'event.started': { side: 'coordinator', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: 'e2e/live-events-hooks.spec.ts#L: Goobrawl goes live',
    receives: 'occurrence, event, by', returns: 'nothing' },
  'event.ended': { side: 'coordinator', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: 'e2e/live-events-hooks.spec.ts#L: Goobrawl ends',
    receives: 'occurrence, event, reason (ended, missed), by', returns: 'nothing' },
  // K3's states, K4's admission and K6's return (E6 part 2, EV-S7 part 2).
  'event.admitted': { side: 'coordinator', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: "e2e/live-events-hooks.spec.ts#L: the warrior is admitted to Goobrawl",
    receives: 'member, event, occurrence, checkpoint, by', returns: 'nothing' },
  'event.joined': { side: 'coordinator', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: "e2e/live-events-hooks.spec.ts#L: the warrior joins Goobrawl",
    receives: 'member, event, occurrence, by', returns: 'nothing' },
  'event.refused': { side: 'coordinator', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: "e2e/live-events-hooks.spec.ts#L: an add-on refuses the priest's admission",
    receives: 'member, event, occurrence, the join reply or the refusing hook, by', returns: 'nothing' },
  'event.left': { side: 'coordinator', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: "e2e/live-events-hooks.spec.ts#L: a manual move off the map leaves",
    receives: 'member, event, occurrence, the destination of the command, by', returns: 'nothing' },
  'event.limit': { side: 'coordinator', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: "scripts/tests/coordinator-event-observation.test.cjs#U: a death limit ends attendance",
    receives: 'member, event, occurrence, limit (death limit, time limit), by', returns: 'nothing' },
  'event.returning': { side: 'coordinator', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: "e2e/live-events-hooks.spec.ts#L: the Goobrawl return starts",
    receives: 'members, event, occurrence, the K6 row, by', returns: 'nothing' },
  'event.returned': { side: 'coordinator', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: "e2e/live-events-hooks.spec.ts#L: the return completes into farming",
    receives: 'members, event, occurrence, by', returns: 'nothing' },
  // The anniversary's phases, the A/B strategy and the Cipher plan (EV-S7 part 2). The server picks
  // the round's featured players by account hash, A/B testing needs two server teams and the Cipher
  // seed has its own spec, so each is a unit row.
  'anniversary.phase': { side: 'character', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: "scripts/tests/anniversary-kiss.test.cjs#U: the anniversary phases are announced",
    receives: 'round, member, phase (staging, visiting, kissed, returning, aborted), by', returns: 'nothing' },
  'abtesting.strategy': { side: 'coordinator', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: "scripts/tests/coordinator-abtesting-update.test.cjs#U: a strategy change is announced",
    receives: 'the strategy and its teams, by', returns: 'nothing' },
  'cipher.plan': { side: 'character', kind: 'notice', part: 'events (06)', answers: 'many', 
    fixture: "scripts/tests/october-runtime.test.cjs#U: the owner's Cipher plan is announced",
    receives: 'round, mode (gathering, brewing, finished), ingredient, monster, reason, by', returns: 'nothing' },
  // The add-on's admission refusal. Refusal only: it may refuse a member K4 admits,
  // never admit one K4 refuses. An add-on answers it; it never asks it.
  'event.attend': { side: 'coordinator', kind: 'request', part: 'events (06)', answers: 'many', addonMayAsk: false, bound: 'refusal only',
    fixture: "e2e/live-events-hooks.spec.ts#L: an add-on refuses the priest's admission",
    receives: "the member, its event and occurrence, and K4's answer", returns: '`refuse` with a reason, or nothing' },
  // An add-on's event kind: a K1 row for a new event name, read in each realm at load and
  // on every add-on switch. Its attendance ranks `event-attendance` through 01's event source, so it
  // names no tier. An add-on answers it; it never asks it.
  'event.kind': { side: 'both', kind: 'request', part: 'events (06)', answers: 'many', addonMayAsk: false,
    bound: 'refusal only for a core name; an add-on kind ranks event-attendance through 01, never a new tier',
    fixture: 'e2e/live-events-hooks.spec.ts#L: an add-on event kind is attended and returned from',
    receives: 'nothing', returns: 'a K1 row for a new event name: name, label, kind (join or walk), map, targets, point, exit rungs' },
} as const satisfies Record<string, HookRow>;

// C1 (addon-capabilities.md "The table by owner"): the events owner's chat and join doors, in runtime/events/api.ts.
// An event.join ask carries K4's answer (events/coordinator/api.ts `eventAskFacts`) beside its args.
export const ACTIONS = {
  'chat.say': { events: ['say'], functions: ['say', 'party_say', 'private_say'], door: 'chatSay', args: '{message, party?, name?}',
    bound: "public chat, party chat, or a whisper to the player `name` names; the call budget's band" },
  'event.join': { events: ['join'], functions: ['join'], door: 'eventJoin', args: '{event}',
    bound: "a join the game offers (G.events[event].join) that K4's rows 2 and 3 admit for the member (attendance.ts eventInstanceAllowed, the Cave's answer)" },
  'skill.kiss': { events: [], functions: ['use_skill:ikissyou'], closed: 'FW', cite: "runtime/events/character/anniversary.ts: 06's anniversary kiss" },
  // The game at pin 16881a27 has no `emotion` handler in server.js: an emote is a G.skills row with
  // `emote` that the game's menu uses as a skill (functions.js:1958), so 03's spend action carries it.
  'emote': { events: ['emotion'], functions: [], closed: 'FW', cite: "server.js at 16881a27 handles no emotion event; emotes are G.skills spends, 03's spend action" },
} as const satisfies Record<string, ActionRow>;

// C3: the events owner's add-on reads, one per door export that reads (runtime/events/api.ts and its coordinator/api.ts).
export const READS = {
  // C3's completeness rule: every other door export that reads, by the export's own type. The
  // table is made from the door exports by kind (a function of state or rules, a constant).
  'door.events.eventPresence': { side: 'both', type: 'typeof eventPresence', door: 'runtime/events/api.ts#eventPresence' },
  'door.events.eventSchedule': { side: 'both', type: 'typeof eventSchedule', door: 'runtime/events/api.ts#eventSchedule' },
  'door.events.eventDeferredReturn': { side: 'both', type: 'typeof eventDeferredReturn', door: 'runtime/events/api.ts#eventDeferredReturn' },
  'door.events.eventFacts': { side: 'both', type: 'typeof eventFacts', door: 'runtime/events/api.ts#eventFacts' },
  'door.events.bossEvents': { side: 'both', type: 'typeof bossEvents', door: 'runtime/events/api.ts#bossEvents' },
  'door.events.eventDisplayNames': { side: 'both', type: 'typeof eventDisplayNames', door: 'runtime/events/api.ts#eventDisplayNames' },
  'door.events.eventEnabled': { side: 'both', type: 'typeof eventEnabled', door: 'runtime/events/api.ts#eventEnabled' },
  'door.events.eventLimits': { side: 'both', type: 'typeof eventLimits', door: 'runtime/events/api.ts#eventLimits' },
  'door.events.eventPolicy': { side: 'both', type: 'typeof eventPolicy', door: 'runtime/events/api.ts#eventPolicy' },
  'door.events.eventPriorityOrder': { side: 'both', type: 'typeof eventPriorityOrder', door: 'runtime/events/api.ts#eventPriorityOrder' },
  'door.events.octoberEvents': { side: 'both', type: 'typeof octoberEvents', door: 'runtime/events/api.ts#octoberEvents' },
  'door.events.selectedEvents': { side: 'both', type: 'typeof selectedEvents', door: 'runtime/events/api.ts#selectedEvents' },
  'door.events.supportedEvents': { side: 'both', type: 'typeof supportedEvents', door: 'runtime/events/api.ts#supportedEvents' },
  'door.events.validEventLimits': { side: 'both', type: 'typeof validEventLimits', door: 'runtime/events/api.ts#validEventLimits' },
  'door.events.eventIs': { side: 'both', type: 'typeof eventIs', door: 'runtime/events/api.ts#eventIs' },
  'door.events.eventKey': { side: 'both', type: 'typeof eventKey', door: 'runtime/events/api.ts#eventKey' },
  'door.events.eventKinds': { side: 'both', type: 'typeof eventKinds', door: 'runtime/events/api.ts#eventKinds' },
  'door.events.eventBossMoves': { side: 'both', type: 'typeof eventBossMoves', door: 'runtime/events/api.ts#eventBossMoves' },
  'door.events.eventShortWindow': { side: 'both', type: 'typeof eventShortWindow', door: 'runtime/events/api.ts#eventShortWindow' },
  'door.events.occurrenceId': { side: 'both', type: 'typeof occurrenceId', door: 'runtime/events/api.ts#occurrenceId' },
  'door.events.CIPHER_DAILY_MIXES': { side: 'both', type: 'typeof CIPHER_DAILY_MIXES', door: 'runtime/events/api.ts#CIPHER_DAILY_MIXES' },
  'door.events.CIPHER_GATHERING_MINUTES': { side: 'both', type: 'typeof CIPHER_GATHERING_MINUTES', door: 'runtime/events/api.ts#CIPHER_GATHERING_MINUTES' },
  'door.events.addonKindProblem': { side: 'both', type: 'typeof addonKindProblem', door: 'runtime/events/api.ts#addonKindProblem' },
  'door.events.eventListRows': { side: 'both', type: 'typeof eventListRows', door: 'runtime/events/api.ts#eventListRows' },
  'door.events.eventReturnLine': { side: 'both', type: 'typeof eventReturnLine', door: 'runtime/events/api.ts#eventReturnLine' },
  'door.events.eventAttendanceLine': { side: 'both', type: 'typeof eventAttendanceLine', door: 'runtime/events/api.ts#eventAttendanceLine' },
  'door.events.CIPHER_MIX_LENGTH': { side: 'both', type: 'typeof CIPHER_MIX_LENGTH', door: 'runtime/events/api.ts#CIPHER_MIX_LENGTH' },
  'door.events.cipherCandidates': { side: 'both', type: 'typeof cipherCandidates', door: 'runtime/events/api.ts#cipherCandidates' },
  'door.events.cipherDropRate': { side: 'both', type: 'typeof cipherDropRate', door: 'runtime/events/api.ts#cipherDropRate' },
  'door.events.cipherIngredients': { side: 'both', type: 'typeof cipherIngredients', door: 'runtime/events/api.ts#cipherIngredients' },
  'door.events.defaultCipherSettings': { side: 'both', type: 'typeof defaultCipherSettings', door: 'runtime/events/api.ts#defaultCipherSettings' },
  'door.events.validMix': { side: 'both', type: 'typeof validMix', door: 'runtime/events/api.ts#validMix' },
  'door.events.merchantAnniversaryReserved': { side: 'both', type: 'typeof merchantAnniversaryReserved', door: 'runtime/events/api.ts#merchantAnniversaryReserved' },
  'door.events.searchExhausted': { side: 'both', type: 'typeof searchExhausted', door: 'runtime/events/api.ts#searchExhausted' },
  'door.events.eventJoins': { side: 'both', type: 'typeof eventJoins', door: 'runtime/events/api.ts#eventJoins' },
  'door.events.roundOrder': { side: 'both', type: 'typeof roundOrder', door: 'runtime/events/api.ts#roundOrder' },
  'door.events.eventArea': { side: 'both', type: 'typeof eventArea', door: 'runtime/events/api.ts#eventArea' },
  'door.events.eventNames': { side: 'both', type: 'typeof eventNames', door: 'runtime/events/api.ts#eventNames' },
  'door.events.eventSupported': { side: 'both', type: 'typeof eventSupported', door: 'runtime/events/api.ts#eventSupported' },
  'door.events.eventWalkBoss': { side: 'both', type: 'typeof eventWalkBoss', door: 'runtime/events/api.ts#eventWalkBoss' },
  'door.events.eventMap': { side: 'both', type: 'typeof eventMap', door: 'runtime/events/api.ts#eventMap' },
  'door.events.eventTargetTypes': { side: 'both', type: 'typeof eventTargetTypes', door: 'runtime/events/api.ts#eventTargetTypes' },
  'door.events.eventAttackers': { side: 'both', type: 'typeof eventAttackers', door: 'runtime/events/api.ts#eventAttackers' },
  'door.events.eventReservedBy': { side: 'both', type: 'typeof eventReservedBy', door: 'runtime/events/api.ts#eventReservedBy' },
  'door.events.eventAreas': { side: 'both', type: 'typeof eventAreas', door: 'runtime/events/api.ts#eventAreas' },
  'door.events.anniversaryDefaults': { side: 'both', type: 'typeof anniversaryDefaults', door: 'runtime/events/api.ts#anniversaryDefaults' },
  'door.events.leadFor': { side: 'both', type: 'typeof leadFor', door: 'runtime/events/api.ts#leadFor' },
  'door.events.projectEventSchedules': { side: 'coordinator', type: 'typeof projectEventSchedules', door: 'runtime/events/coordinator/api.ts#projectEventSchedules' },
  'door.events.eventInstanceAllowed': { side: 'coordinator', type: 'typeof eventInstanceAllowed', door: 'runtime/events/coordinator/api.ts#eventInstanceAllowed' },
  'door.events.coordinatorEventCheckpoint': { side: 'coordinator', type: 'typeof coordinatorEventCheckpoint', door: 'runtime/events/coordinator/api.ts#coordinatorEventCheckpoint' },
  'door.events.anniversarySlices': { side: 'coordinator', type: 'typeof anniversarySlices', door: 'runtime/events/coordinator/api.ts#anniversarySlices' },
  'door.events.anniversaryLabels': { side: 'coordinator', type: 'typeof anniversaryLabels', door: 'runtime/events/coordinator/api.ts#anniversaryLabels' },
  'door.events.anniversaryTradeIdentity': { side: 'coordinator', type: 'typeof anniversaryTradeIdentity', door: 'runtime/events/coordinator/api.ts#anniversaryTradeIdentity' },
  'door.events.anniversaryHandedOff': { side: 'coordinator', type: 'typeof anniversaryHandedOff', door: 'runtime/events/coordinator/api.ts#anniversaryHandedOff' },
  'door.events.anniversaryYields': { side: 'coordinator', type: 'typeof anniversaryYields', door: 'runtime/events/coordinator/api.ts#anniversaryYields' },
  'door.events.sliceQuantity': { side: 'coordinator', type: 'typeof sliceQuantity', door: 'runtime/events/coordinator/api.ts#sliceQuantity' },
  'door.events.activeCoordinatorNames': { side: 'coordinator', type: 'typeof activeCoordinatorNames', door: 'runtime/events/coordinator/api.ts#activeCoordinatorNames' },
  'door.events.resolveABStrategy': { side: 'coordinator', type: 'typeof resolveABStrategy', door: 'runtime/events/coordinator/api.ts#resolveABStrategy' },
  'door.events.updateCoordinatorABStrategy': { side: 'coordinator', type: 'typeof updateCoordinatorABStrategy', door: 'runtime/events/coordinator/api.ts#updateCoordinatorABStrategy' },
  'door.events.eventFirst': { side: 'coordinator', type: 'typeof eventFirst', door: 'runtime/events/coordinator/api.ts#eventFirst' },
  'door.events.presence': { side: 'coordinator', type: 'typeof presence', door: 'runtime/events/coordinator/api.ts#presence' },
} as const satisfies Record<string, ReadRow>;
// C3's completeness rule: the door exports that are no read, each a write (it changes owner state), a
// port (an install, a factory or a published answer the composition wires) or a command (it builds
// or sends work to a character). A door named by an ACTIONS row is no entry here.
export const DOOR_ONLY = {
  ...doorOnly('runtime/events/coordinator/api.ts', 'write', ['beginHuntEventTrip', 'endHuntEventTrip', 'observeEventAttendance', 'playerMoved', 'releaseWalkRoutes', 'supersedeAnniversary', 'migrateEventSelections']),
  ...doorOnly('runtime/events/api.ts', 'port', ['publishEventAnswers', 'publishEventFacts', 'adoptAddonKinds']),
  ...doorOnly('runtime/events/coordinator/api.ts', 'port', ['installEvents', 'eventAskFacts', 'createEventObservations', 'createCoordinatorEventObservations', 'createCoordinatorEventReturns', 'createEventReturnTravel', 'createEventReturns', 'createAnniversaryReturns', 'createAnniversarySnapshot', 'createAnniversarySupplies', 'createCoordinatorAnniversaryReturns', 'createCoordinatorAnniversarySnapshot', 'initialAnniversaryState', 'createAnniversaryCommerceRoutes', 'createAnniversaryNavigationRoutes', 'createAnniversarySuppliesRoute', 'createAnniversaryVisitRoutes', 'createCoordinatorAnniversaryActions', 'createEventAcknowledgementRoutes', 'createEventRecoveryRoutes', 'createEventPresence', 'eventSource']),
  ...doorOnly('runtime/events/coordinator/api.ts', 'command', ['createEventReply']),
};

// The dashboard's event list: 12 draws it from rules.ts `eventListRows`.
export const SLOTS = {
  'event-list': { owner: 'events (06)', data: "per occurrence the member, the event's name and label, the member's K3 state and whether the rejoin route takes it back (runtime/events/api.ts eventListRows)",
    section: false, fixture: 'scripts/tests/coordinator-event-observation.test.cjs#U: the slot data lists the left member as rejoinable' },
} as const satisfies Record<string, SlotRow>;

// The registry's dispatch of the events owner's `event.kind`: each enabled add-on's row in load order.
// A row that names a core event or an earlier add-on's, or that the K1 readers cannot read, is
// dropped and kept with the notices' errors, as is an answer that throws.
export function dispatch(ctx: DispatchContext) {
  return {
    kinds(): EventKindAnswer[] {
      const rows: EventKindAnswer[] = [], taken = new Set<string>();
      for (const { addon, answer } of ctx.answers('event.kind', r => r.hooks['event.kind']!())) {
        const problem = addonKindProblem(answer, taken);
        if (problem) { ctx.record(addon, 'event.kind', problem); continue; }
        taken.add(answer.name); rows.push(answer);
      }
      return rows;
    },
    // The events owner's admission refusal: the first add-on that
    // refuses a member K4 admitted, named by its add-on. It never admits one K4 refuses, so it is
    // asked only for an admitted member. An answer that throws refuses nothing.
    attendRefuses(ask: EventAttendAsk): string | undefined {
      return ctx.refusal('event.attend', r => r.hooks['event.attend']!(ask, ctx.settings(r.name))?.refuse);
    },
  };
}

// The hook coverage (addon:check rule 8):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = ['runtime/events/rules.ts', 'runtime/events/coordinator/abtesting.ts'] as const;
export const DECISIONS = {
  'a member attends an event (K4)': { site: 'runtime/events/coordinator/attendance.ts:681', hook: 'event.attend' },
  'a member back from player travel rejoins the occurrence': { site: 'runtime/events/coordinator/attendance.ts:286', hook: 'event.attend' },
  'an add-on event kind': { at: 'runtime/events/rules.ts#addonKindProblem', hook: 'event.kind' },
  'the add-on event kinds a load adopts': { at: 'runtime/events/rules.ts#adoptAddonKinds', hook: 'event.kind' },
  'order between events': { at: 'runtime/events/rules.ts#eventPriorityOrder', hook: 'settings.overlay' },
  'event limits': { at: 'runtime/events/rules.ts#eventLimits', hook: 'settings.overlay' },
  'a core event\'s exit rungs': { at: 'runtime/events/rules.ts#eventExit', core: 'game', cite: 'runtime/events/rules.ts:209, the event map\'s exit' },
  'cipher plan': { site: 'runtime/events/coordinator/cipher.ts:26', core: 'game', cite: 'runtime/events/coordinator/cipher.ts:26, the daily mixes' },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {
  // Facts the game fixes, which the console reads; an add-on's answer cannot change them.
  merchantAnniversaryReserved: 'read', searchExhausted: 'read', eventJoins: 'read', eventShortWindow: 'read', roundOrder: 'read',
  eventKinds: 'read', eventKey: 'read', eventArea: 'read', eventIs: 'read', eventNames: 'read', eventSupported: 'read',
  eventWalkBoss: 'read', eventMap: 'read', eventTargetTypes: 'read', eventAttackers: 'read', eventReservedBy: 'read',
  eventAreas: 'read', eventBossMoves: 'read', anniversaryDefaults: 'read', selectedEvents: 'read',
  eventEnabled: 'read', eventPolicy: 'read', leadFor: 'read',
  // The A/B strategy is status: the teams the game gave the opted-in members at the join, grouped,
  // which the dashboard shows as eventStrategy. The members it names come from the reports.
  resolveABStrategy: 'read', updateCoordinatorABStrategy: 'read', activeCoordinatorNames: 'read',
  eventListRows: 'format', joinReply: 'format', occurrenceId: 'format', anniversaryRoundId: 'format',
  validEventLimits: 'validator',
  legacyFlagEvents: 'migration',
  eventReturnLine: 'label', eventAttendanceLine: 'label',
} satisfies Record<string, PlainKind>;
