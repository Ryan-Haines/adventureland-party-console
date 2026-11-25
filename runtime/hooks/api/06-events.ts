// Owner 06's published functions and types for add-ons: one re-export line each with its comment.
// Only 06's build writes this file, and runtime/hooks/addon-api.ts re-exports it.

// A saved point a return or a target walk goes to.
export type { ReturnLocation } from '../../events/api.ts';
// `events.kinds()`: K1's rows, one per event kind the console attends.
export { eventKinds } from '../../events/api.ts';
// `events.key(value)`: the K1 row an event id names, or null.
export { eventKey } from '../../events/api.ts';
// A K1 row: the event's kind, map, targets, point, exit rungs and the rest of its columns.
export type { EventKind } from '../../events/api.ts';
// A member's event presence (`event.presence`): its event, occurrence, realm, phase and since.
export type { EventPresence } from '../../events/api.ts';
// A group's occurrence of an event (`event.schedule`): its spawn, planned walk, lead and phase.
export type { EventSchedule as Occurrence } from '../../events/api.ts';
