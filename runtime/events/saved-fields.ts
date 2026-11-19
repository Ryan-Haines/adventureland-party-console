// The saved fields of events (06), its declarations for the settings owner (11), which builds its
// table from them at load. They moved from the
// held block runtime/settings/held/06-events.ts with no change to a field.
import { text, boolean, mapOf, listOf } from '../settings/api.ts';
import type { Declarations, SettingsWrite, SettingsWriteResult } from '../settings/api.ts';
import type { SavedEventState } from './coordinator/attendance.ts';
import { anniversaryDefaults, legacyFlagEvents, validEventLimits, type EventLimits } from './rules.ts';

// The saved shape of the event selections, which the settings owner's start reads (initial.ts initialPartySelection).
export interface SavedEventSelections {
  eventsByCharacter?: Record<string, boolean> | null;
  eventLimitsByCharacter?: Record<string, Record<string, EventLimits>>;
  eventPrioritiesByCharacter?: Record<string, string[]> | null;
  eventSelectionsByCharacter?: Record<string, string[]> | null;
}

export const eventsSavedFields = {
  name: 'core:events',
  settings: {
    // The selection list before eventSelectionsByCharacter, migrated at load (`migrateEventSelections` below).
    eventsByCharacter: { label: 'Events (older list)', kind: 'value', default: {} satisfies SavedEventSelections['eventsByCharacter'],
      scope: 'character', importable: true, check: mapOf(boolean), refusal: 'invalid events setting', deliver: ['dashboard'] },
    eventSelectionsByCharacter: { label: 'Events to attend', kind: 'value', default: {} satisfies SavedEventSelections['eventSelectionsByCharacter'],
      scope: 'character', importable: true, check: mapOf(listOf(text)), deliver: ['dashboard'] },
    eventPrioritiesByCharacter: { label: 'Event priority order', kind: 'value', default: {} satisfies SavedEventSelections['eventPrioritiesByCharacter'],
      scope: 'character', importable: true, check: mapOf(listOf(text)), deliver: ['dashboard'] },
    // Its boss approach per event is a player setting.
    eventLimitsByCharacter: { label: 'Event limits', kind: 'value', default: {} satisfies SavedEventSelections['eventLimitsByCharacter'],
      scope: 'character', importable: true, check: mapOf(mapOf(validEventLimits)), deliver: ['dashboard'] },
  },
  records: {
    huntEventTrips: { default: {} satisfies SavedEventState['huntEventTrips'] },
    eventAttendance: { default: {} satisfies SavedEventState['eventAttendance'], liveness: true, deliver: ['dashboard'] },
    eventSessions: { default: {} satisfies SavedEventState['eventSessions'], scope: 'scope', liveness: true },
    eventReturn: { default: null satisfies SavedEventState['eventReturn'], scope: 'scope', deliver: ['dashboard-core'] },
    eventReturnLast: { default: null, scope: 'scope', profileOnly: true },
    deferredEventReturns: { default: {} satisfies SavedEventState['deferredEventReturns'], deliver: ['dashboard-core'] },
    abtestingStrategy: { default: null satisfies SavedEventState['abtestingStrategy'], scope: 'scope', deliver: ['characters'] },
    anniversary: { default: anniversaryDefaults() },
    returnProgress: { default: {} },
  },
} satisfies Declarations;


/**
 * The events owner's load migration: explicit event selections, including empty
 * arrays, override the legacy enable flags. Each character's selection is one write through the
 * settings writer as `core:events`; a refused write is logged, as the slot migration logs its own.
 */
export function migrateEventSelections(
  state: { merchantCharacter: string | null; eventSelectionsByCharacter: Record<string, unknown>; eventsByCharacter: Record<string, unknown> },
  workers: Record<string, unknown>,
  write: (batch: SettingsWrite) => SettingsWriteResult,
  log: (message: string) => void,
): void {
  for (const name of new Set(
    [...Object.keys(workers), state.merchantCharacter].filter((name): name is string => !!name),
  )) {
    if (Object.prototype.hasOwnProperty.call(state.eventSelectionsByCharacter, name)) continue;
    const otherEvents = state.eventsByCharacter[name] && name !== state.merchantCharacter ? legacyFlagEvents() : [];
    const written = write({ by: 'core:events', changes: [{ field: 'eventSelectionsByCharacter', character: name, value: ["anniversary", ...otherEvents] }] });
    if (!written.ok) log(`The event selection of ${name} was not migrated: ${written.error}`);
  }
}
