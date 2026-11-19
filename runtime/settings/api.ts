// The settings owner's public file: what every owner
// imports from runtime/settings/. It holds the declaration shapes, the kinds, scopes, documents and
// deliveries, the blocks every declared `check` is built from, `valueProblem` and `settingsDraft`,
// and the write and read types. The rules over them live in rules.ts; owner:check refuses an import
// of any other file of the module from another owner.
import type { SlotName } from '../hooks/registry.ts';
import { accepts, object } from './rules.ts';
// The kinds, scopes, documents and deliveries live with the rules that read them; the door
// re-exports them, so rules.ts imports only types from this file.
export { ADDON_KINDS, SETTING_KINDS, SETTING_SCOPES, SETTING_DOCUMENTS, DELIVERIES, object } from './rules.ts';
import type { ADDON_KINDS, SETTING_KINDS, SETTING_SCOPES, SETTING_DOCUMENTS, DELIVERIES, RecordField } from './rules.ts';
export type { RecordField } from './rules.ts';
// The load check's rule for a registration's settings, which the hook registry asks.
export { addonSettingProblem } from './rules.ts';

// The game data a declared check reads: the coordinator's spawn catalog, null before
// the data loads. A check given none passes a value on its shape, as the `monsters` kind does.
export interface CheckGameData { spawns: readonly unknown[] | null }
// A declared check. `range` is the bounds of a whole-number check (`wholeFrom`).
export type SettingCheck = ((value: unknown, own?: Readonly<Record<string, unknown>>, game?: CheckGameData) => boolean) & { range?: { min: number; max: number } };
// How the settings file carries an importable field, each rule declared by the field's owner, so
// the import (persistence/dashboard-import.ts) names no owner's field.
export interface ImportRules {
  // The value the export carries and the import checks: an owner's load holds a saved copy past
  // its bound to that bound (items/saved-fields.ts itemCollectionThreshold), and a farming profile
  // travels with its Hunt preferences only (hunting/saved-fields.ts farmingProfiles).
  fit?(value: unknown): unknown;
  // In a field keyed by item, the entry key that names a character. The import keeps an entry
  // only for a character this account owns.
  characterKey?: string;
  // The fields the import writes when the file carries this one, from the file's checked values
  // and the state before the import: an owner's migration or merge of its saved shape.
  imported?(file: Readonly<Record<string, unknown>>, state: Readonly<Record<string, unknown>>): Record<string, unknown>;
}
export interface Setting extends ImportRules { label: string; kind: (typeof SETTING_KINDS)[number];
  default: unknown; choices?: readonly string[]; min?: number; max?: number;
  // A `records` setting's fields by key (rules.ts RecordField).
  fields?: Readonly<Record<string, RecordField>>;
  // A `choice` whose choices are a slot's entries that are registered and switched on, so
  // the registry that holds the slots answers them at each write.
  slot?: SlotName;
  // True when the value is valid; `value` needs one. A rule that spans fields is the declaring
  // owner's check. An add-on's check also receives `own`, its own settings after the change, its
  // keys only, so a rule over its own keys needs no core edit. The writer also hands it the
  // coordinator's game data (`CheckGameData`); the import and the default's check hand none.
  check?: SettingCheck;
  // The words a refused value answers, a route's own words for its field, in place of
  // the kind's sentence.
  refusal?: string;
  // A credential: its audit line names the field and the source, never the values.
  secret?: boolean;
  // True for a field no add-on's `settings.overlay` answers: a hand control or an add-on switch,
  // which belong to the console's own controls.
  noOverlay?: true;
  // Where the value sits when it is not the `party` field of its own name: `['aldata', 'key']` is
  // `party.aldata.key`, the ALData key, which the credentials document saves with its
  // authentication (`secret`).
  path?: readonly [object: 'aldata', key: string];
  scope?: (typeof SETTING_SCOPES)[number];
  document?: Exclude<(typeof SETTING_DOCUMENTS)[number], 'history'>;
  // A `scope` field saved only inside each farming profile, with no top-level copy for the
  // party scope.
  profileOnly?: boolean;
  deliver?: readonly (typeof DELIVERIES)[number][];
  // The heartbeat reply's name for the field, when it differs from the field's.
  reply?: string;
  // Left out of the player's settings list. It
  // keeps its default, range and writer checks; its saved copy and each write are its
  // value, which coordinator/table.ts `hiddenValue` answers.
  hidden?: boolean;
  // True when today's settings export carries it.
  importable?: boolean }
// A value play produces, even when a route also edits it. Its owner
// writes it, and the settings writer refuses it. An importable record carries the check the
// import runs before it applies anything.
export interface SavedRecord extends ImportRules { default: unknown; check?(value: unknown): boolean;
  scope?: Setting['scope']; document?: (typeof SETTING_DOCUMENTS)[number]; profileOnly?: boolean;
  // Its frequent changes are timestamps, so a save of those alone waits for the writer's
  // liveness window (persistence/writer.ts).
  liveness?: boolean;
  // A `scope` record each farming scope computes from its other fields: nothing writes it, and
  // every save carries the value it derives (the `farmingPolicy` copy a
  // v1.4.0 build reads).
  derive?(scope: Readonly<Record<string, unknown>>): unknown;
  // The player's choices the record holds, by key, each declared as a setting. Its own route
  // writes them; `playedIn` reads them, and `settings.overlay` answers each as `<record>.<key>`.
  members?: Readonly<Record<string, Setting>>;
  deliver?: Setting['deliver']; reply?: string; importable?: boolean }
// What one declarer says about the saved fields it owns: an owner's registration.
export interface Declarations { name: string; settings?: Readonly<Record<string, Setting>>; records?: Readonly<Record<string, SavedRecord>> }
// Why a setting refuses a value: its kind's own check, then its declared check. The settings
// writer runs it on every change of a batch before it writes anything.
export function valueProblem(setting: Setting, value: unknown, own?: Readonly<Record<string, unknown>>, game?: CheckGameData): string | undefined {
  if (accepts(setting, setting, value, own, game)) return undefined;
  if (setting.refusal) return setting.refusal;
  // A value the kind takes and the declared check refuses names no kind rule.
  if (setting.check && accepts({ ...setting, check: undefined }, setting, value)) return `${setting.label} refuses this value`;
  switch (setting.kind) {
    case 'boolean': return `${setting.label} takes true or false`;
    case 'number': return `${setting.label} takes a number from ${setting.min ?? 'any'} to ${setting.max ?? 'any'}`;
    case 'choice': return `${setting.label} takes one of ${setting.choices!.join(', ')}`;
    case 'per-character': return `${setting.label} takes one of ${setting.choices!.join(', ')} for each character`;
    case 'character': return `${setting.label} takes a character's name`;
    default: return `${setting.label} refuses this value`;
  }
}
// The building blocks of the declared checks (`check`). Every declarer
// builds its `check` from them, and the import and the writer run it on a value before it applies
// (2.3 step 1, 2.5).
export type ObjectValue = Record<string, unknown>;
export const list = (value: unknown): value is unknown[] => Array.isArray(value);
export const text = (value: unknown) => typeof value === 'string';
export const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
export const boolean = (value: unknown) => typeof value === 'boolean';
export const mapOf = (check: (value: unknown) => boolean) => (value: unknown) => object(value) && Object.values(value).every(check);
export const listOf = (check: (value: unknown) => boolean) => (value: unknown) => list(value) && value.every(check);
export const item = (value: unknown) => object(value) && text(value.name);
export const mark = (value: unknown) => object(value) && (item(value.item) || item(value));
export const positive = (value: unknown) => number(value) && Number(value) > 0;
// A whole number from `min` to `max`, the range the console's own routes accept. The check carries
// its range, which the settings list shows (rules.ts `rangeOf`).
export const wholeFrom = (min: number, max: number): SettingCheck => Object.assign(
  (value: unknown) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max, { range: { min, max } });
// One settings write: a batch of changes and its source. A change with a
// `character` sets that character's entry of a per-character field, or the copy of a scoped field
// in that character's own farming profile: the party's scope for the leader, a follower's saved
// preference otherwise. `basis` is the time of the read the page showed.
// An add-on's setting or switch is one addressed change: `addon` and `key` name it, `enabled`
// for the switch, on the field `addons`, or `addonSettings` for a setting placed per farming scope.
export interface SettingsChange { field: string; value: unknown; character?: string; addon?: string; key?: string }
export interface SettingsWrite { changes: readonly SettingsChange[]; by: string; basis?: number }
// A refusal names the first refused field. A field changed after the basis is refused with the
// reason `out of date` and its current value (`current`, none for a secret setting), so the page
// can tell the player the change was not saved and show the value it reloaded.
export type SettingsWriteResult = { ok: true; changed: string[] } |
  { ok: false; field: string; character?: string; error: string; reason?: 'out of date'; current?: unknown };
export interface SettingsRead { field: string; character?: string }
// One declared field as `settings.declared` answers it: its declaring owner, whether it is a
// record, a fresh copy of its default, and the range, scope and `hidden` its declaration names.
export interface DeclaredSetting { field: string; owner: string; record: boolean; default: unknown;
  min?: number; max?: number; scope?: (typeof SETTING_SCOPES)[number]; hidden?: boolean }
// A request's draft of the settings it edits, for the item and merchant
// commands that edit a rule map in several steps. The first `edit` of a field copies its current
// value, every later edit in the request changes that copy, and `changes` lists each copied field
// whose value now differs, so the request writes its whole change as one batch. A field the
// request never edits is never copied.
export function settingsDraft(state: object) {
  const current = state as Record<string, unknown>, copies = new Map<string, unknown>();
  function edit<T>(field: string): T {
    if (!copies.has(field)) copies.set(field, structuredClone(current[field]));
    return copies.get(field) as T;
  }
  return {
    edit,
    set(field: string, value: unknown): void { copies.set(field, value); },
    changes(): SettingsChange[] {
      return [...copies].filter(([field, value]) => JSON.stringify(value) !== JSON.stringify(current[field])).map(([field, value]) => ({ field, value }));
    },
  };
}
export type SettingsDraft = ReturnType<typeof settingsDraft>;
// The values a target mode call reads: a farming scope's own values of the add-on's
// settings placed per scope (its profile's `addonSettings[name]`) over its account values.
// The hook registry calls it; the precedence rule is the settings owner's.
export function addonValues(name: string, scope: unknown, account: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const own = (scope as { addonSettings?: Record<string, Record<string, unknown>> } | undefined)?.addonSettings?.[name];
  return { ...account, ...own };
}
// `settings.overlay`: the value a decision plays with. The coordinator's settings install points
// the reader at the registry's overlay, so an enabled add-on's answer replaces the player's value
// for this read only, and the saved copy and the dashboard keep the player's. A character and the
// dashboard install no reader: a character's delivered copy is already overlaid
// (status/coordinator/reply.ts), and the dashboard shows the player's own value.
type OverlayReader = (field: string, value: unknown, character?: string) => unknown;
let overlayReader: OverlayReader | undefined;
export function readOverlaysWith(reader: OverlayReader | undefined): void { overlayReader = reader; }
export function played<T extends object, K extends keyof T & string>(state: T, field: K, character?: string): T[K] {
  const value = state[field];
  return overlayReader ? overlayReader(field, value, character) as T[K] : value;
}
// The same read for a player's choice a record holds (`members`), which the overlay names
// `<record>.<key>`: `playedIn('dailyDungeons', d, 'afterRun')`.
export function playedIn<T extends object, K extends keyof T & string>(record: string, state: T, key: K): T[K] {
  const value = state[key];
  return overlayReader ? overlayReader(`${record}.${key}`, value) as T[K] : value;
}
