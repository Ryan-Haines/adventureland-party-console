// The events owner's public file: what the rest of the
// console and the other owners may import of runtime/events/. Nothing else under the folder is
// importable from another owner (owner:check); an add-on imports its types only through
// runtime/hooks/addon-api.ts.
// The event catalog, the selection and the limits.
export { bossEvents, eventDisplayNames, eventEnabled, eventLimits, eventPolicy, eventPriorityOrder, octoberEvents, selectedEvents, supportedEvents, validEventLimits } from './rules.ts';
export type { EventFormation, EventLimits } from './rules.ts';
// `events.kinds()` and `events.key()`: the kinds table's rows, and the row an event id names.
export { eventIs, eventKey, eventKinds } from './rules.ts';
// The kinds table's game-data columns on the coordinator: the short window and the moving boss.
export { eventBossMoves, eventShortWindow } from './rules.ts';
// The occurrence id, which `event.schedule` is asked by.
export { occurrenceId } from './rules.ts';
// The Cipher's gathering window and daily mix count, which the dashboard's Cipher text shows.
export { CIPHER_DAILY_MIXES, CIPHER_GATHERING_MINUTES } from './rules.ts';
export type { EventKind, EventKindAnswer, EventKindName } from './rules.ts';
// `event.kind`: the check of an add-on's row and its adoption into the kinds table, in each realm.
export { addonKindProblem, adoptAddonKinds } from './rules.ts';
// The `event-list` slot's data, which 12 draws from the delivered attendance record.
export { eventListRows, eventReturnLine, eventAttendanceLine, type EventCardLine } from './rules.ts';
export type { EventListRow } from './rules.ts';
// The schedule reports.
export type { TrickOrTreatCounts } from './coordinator/occurrences.ts';
// Attendance, its limits and the hunt trips.
export type { AttendanceInstance, AttendanceReport, DeferredRecovery, EventAdmission, EventAttendance, EventSession, HuntEventTrip, HuntEventTrips, LastEventReturn, SavedEventState } from './coordinator/attendance.ts';
// The event return.
export type { EventRecovery, EventReturnState, ReturnLocation, ReturnOwner, ReturnStatus, Waypoints } from './coordinator/returns.ts';
// The anniversary round (EVT-041 to EVT-054).
export type { AnniversaryBuffStatus, AnniversaryCycle } from './coordinator/anniversary.ts';
// The A/B strategy.
export type { ABReport, ABStrategy } from './coordinator/abtesting.ts';
// The event routes (EVT-049 to EVT-052, EVT-058).
export type { ReturnProgress } from './coordinator/routes.ts';
// The published reads. The events owner's coordinator install publishes them in this realm, as 01
// publishes its answers (runtime/tasks/api.ts `tasks()`).
export type { EventPresence, PresencePhase } from './coordinator/source.ts';
export type { EventSchedule, OccurrencePhase } from './coordinator/occurrences.ts';
export interface EventAnswers {
  presence(name: string): import('./coordinator/source.ts').EventPresence | null;
  schedule(occurrence: string): import('./coordinator/occurrences.ts').EventSchedule | null;
  deferredReturn(name: string): boolean;
}
type EventRoot = { __partyEventAnswers?: EventAnswers };
// `event.presence(name)`: where a member is in an occurrence, or null.
export function eventPresence(name: string): import('./coordinator/source.ts').EventPresence | null {
  const answers = (globalThis as EventRoot).__partyEventAnswers;
  if (!answers?.presence) throw Error('The events owner is not installed in this realm');
  return answers.presence(name);
}
// `event.schedule(occurrence)`: the group's occurrence of an event, its spawn and planned walk
//, or null.
export function eventSchedule(occurrence: string): import('./coordinator/occurrences.ts').EventSchedule | null {
  const answers = (globalThis as EventRoot).__partyEventAnswers;
  if (!answers?.schedule) throw Error('The events owner is not installed in this realm');
  return answers.schedule(occurrence);
}
// Whether a member holds a deferred event return (its saved `deferredEventReturns` row): an offline
// member's return waits for its reconnect, and the merchant jobs owner reserves the merchant for it, as b9b5c91e
// runtime/coordinator/merchant/event-control.ts:18 read the row.
export function eventDeferredReturn(name: string): boolean {
  const answers = (globalThis as EventRoot).__partyEventAnswers;
  if (!answers?.deferredReturn) throw Error('The events owner is not installed in this realm');
  return answers.deferredReturn(name);
}
// Each coordinator part publishes its own answers: source.ts `presence`, install.ts `schedule` and `deferredReturn`.
export function publishEventAnswers(answers: Partial<EventAnswers>): void {
  const root = globalThis as EventRoot;
  root.__partyEventAnswers = { ...root.__partyEventAnswers, ...answers } as EventAnswers;
}
// The character facts and event movers: character/combat.ts publishes
// them when shared.js installs it, and 02, 03 and 04 ask them here.
export type { EventFacts, EventMoverTick } from './character/combat.ts';
type FactsRoot = { __partyEventFacts?: import('./character/combat.ts').EventFacts };
export function eventFacts(): import('./character/combat.ts').EventFacts {
  const facts = (globalThis as FactsRoot).__partyEventFacts;
  if (!facts) throw Error('The events owner is not installed on this character');
  return facts;
}
export function publishEventFacts(facts: import('./character/combat.ts').EventFacts): void { (globalThis as FactsRoot).__partyEventFacts = facts; }
export { CIPHER_MIX_LENGTH, cipherCandidates, cipherDropRate, cipherIngredients, defaultCipherSettings, validMix } from './october.ts';
export type { CipherBoard, CipherGatheringPlan, CipherSettings } from './october.ts';
// The events owner's add-on action doors (rows/06-events.ts `ACTIONS`), which the
// character's calls.ts installs.
export type { ChatAnswer, ChatBand, EventDoorFacts } from './character/calls.ts';
import type { Door } from '../hooks/registry.ts';
type DoorRoot = { __partyEventDoors?: typeof import('./character/calls.ts').eventDoors };
function eventDoors() {
  const doors = (globalThis as DoorRoot).__partyEventDoors;
  if (!doors) throw Error('The events owner is not installed on this character');
  return doors;
}
export const chatSay: Door = (args, ask) => eventDoors().chatSay(args, ask.band);
// The coordinator's admission rides in the facts (coordinator/api.ts `eventAskFacts`); one of another
// shape is left out, so the door refuses as it does with none.
export const eventJoin: Door = (args, ask) =>
  eventDoors().eventJoin(args, ask.band, typeof ask.facts?.admitted === 'boolean' ? { admitted: ask.facts.admitted } : {});
// The rest of the events owner's PLAIN reads (rows/06-events.ts `PLAIN`), so each is a door export an add-on reads.
export { merchantAnniversaryReserved, searchExhausted, eventJoins, roundOrder, eventArea, eventNames, eventSupported, eventWalkBoss, eventMap,
  eventTargetTypes, eventAttackers, eventReservedBy, eventAreas, anniversaryDefaults, leadFor } from './rules.ts';
