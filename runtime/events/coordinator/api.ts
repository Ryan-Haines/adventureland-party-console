// The events owner's coordinator door: the
// coordinator values of runtime/events/. They import movement's coordinator door, whose planner
// loads node:worker_threads and node:vm (movement/coordinator/planner-service.ts), so a file the
// character bundles or the dashboard load imports runtime/events/api.ts, the rules and the types.
// The schedule reports.
export { projectEventSchedules } from './occurrences.ts';
// Attendance, its limits and the hunt trips.
export { beginHuntEventTrip, createEventObservations, endHuntEventTrip, eventInstanceAllowed, observeEventAttendance, playerMoved } from './attendance.ts';
// The event return.
export { coordinatorEventCheckpoint, createCoordinatorEventObservations, createCoordinatorEventReturns, createEventReturnTravel, createEventReturns, releaseWalkRoutes } from './returns.ts';
// The anniversary round (EVT-041 to EVT-054).
export { anniversarySlices } from '../rules.ts';
export { anniversaryLabels, anniversaryTradeIdentity, anniversaryHandedOff, anniversaryYields, supersedeAnniversary, createAnniversaryReturns, createAnniversarySnapshot, createAnniversarySupplies, createCoordinatorAnniversaryReturns, createCoordinatorAnniversarySnapshot, initialAnniversaryState, sliceQuantity } from './anniversary.ts';
// The A/B strategy.
export { activeCoordinatorNames, resolveABStrategy, updateCoordinatorABStrategy } from './abtesting.ts';
// The event routes (EVT-049 to EVT-052, EVT-058).
export { createAnniversaryCommerceRoutes, createAnniversaryNavigationRoutes, createAnniversarySuppliesRoute, createAnniversaryVisitRoutes, createCoordinatorAnniversaryActions, createEventAcknowledgementRoutes, createEventRecoveryRoutes } from './routes.ts';
// The coordinator install: the per-report ingest and the composition's answers, with the
// facts an add-on's event.join ask carries to the character's door: the admission
// answer for the member and the event, and the tasks owner's table for an event-attendance task.
import { installEvents as installOwner } from './install.ts';
import { eventInstanceAllowed as instanceAllowed } from './attendance.ts';
import type { EventDoorFacts } from '../api.ts';
type AskRoot = { __partyEventAsk?: (character: string, event: string) => EventDoorFacts };
export function installEvents(...args: Parameters<typeof installOwner>): ReturnType<typeof installOwner> {
  const owner = installOwner(...args), [party, ports] = args;
  (globalThis as AskRoot).__partyEventAsk = (character, event) =>
    ({ admitted: instanceAllowed(party, character, event) && ports.dungeons.eventAllowed(character, event, true) && ports.admits(character) });
  return owner;
}
/** The coordinator's facts for an add-on's event.join ask, which the dispatcher sends beside it. */
export function eventAskFacts(character: string, event: string): EventDoorFacts {
  const ask = (globalThis as AskRoot).__partyEventAsk;
  if (!ask) throw Error('The events owner is not installed in this realm');
  return ask(character, event);
}
export type { EventsParty } from './install.ts';
// The load migration of the selections.
export { migrateEventSelections } from '../saved-fields.ts';
// The event fields of the heartbeat reply (the status owner's table R).
export { createEventReply } from './reply.ts';
// The `event` source, `event.presence` and the first live event.
export { createEventPresence, eventFirst, eventSource, presence } from './source.ts';
export type { LiveEventReport, PresenceState } from './source.ts';
