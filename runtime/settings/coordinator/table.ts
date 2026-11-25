// The coordinator's declaration table and the lists built from it. The start builds the table on
// its first read, the state initializer's first declared default, so the table exists before the
// state loads and a refused declaration fails the start with every refused field named. The first
// read comes after every module loads: several declarers take their defaults from the modules that
// read the table, so a build at import would read a declarer that has not loaded yet.
import { buildSettingsTable, type SettingsTable } from '../rules.ts';
import { declaredSettings, settingsLists, savedOrDefault } from '../lists.ts';
import { settingsDeclarations } from './declarations.ts';

let built: { table: SettingsTable; lists: ReturnType<typeof settingsLists> } | undefined;
export function coordinatorSettings() {
  if (built) return built;
  const result = buildSettingsTable(settingsDeclarations);
  if (!result.ok) throw Error(`The settings declarations are refused:\n${result.refusals.join('\n')}`);
  return built = { table: result.table, lists: settingsLists(result.table) };
}

// Each declared field and its default's type, from the declarers' own literals.
type Declarer = (typeof settingsDeclarations)[number];
type FieldsOf<D> = D extends { settings: infer S; records: infer R } ? S & R : D extends { settings: infer S } ? S : D extends { records: infer R } ? R : never;
type Defaults<D> = D extends unknown ? { [K in keyof FieldsOf<D>]: FieldsOf<D>[K] extends { default: infer V } ? V : never } : never;
type Keys<D> = D extends unknown ? keyof FieldsOf<D> & string : never;
export type DeclaredField = Keys<Declarer>;
type DefaultOf<K extends string> = Extract<Defaults<Declarer>, Record<K, unknown>>[K];
type DeliveredOf<D, To> = D extends unknown ? { [K in keyof FieldsOf<D>]: FieldsOf<D>[K] extends { deliver: readonly (infer X)[] } ? To extends X ? K & string : never : never }[keyof FieldsOf<D>] : never;
// The saved copies' types, from each declared default (the start's saved settings, initial.ts).
export type SavedFields = { [K in DeclaredField]?: DefaultOf<K> | null };
// The declared fields delivered to a reader (`deliver`), for the types of the heartbeat reply's
// state and the dashboard's payload.
export type DeliveredField<To extends 'characters' | 'dashboard' | 'dashboard-core'> = DeliveredOf<Declarer, To>;

// The saved value of a declared field, or a fresh copy of its default. Its type is the saved
// copies' type, with null only where the declared default is null.
export function declared<K extends DeclaredField, T>(field: K, ...saved: (T | null | undefined)[]): null extends DefaultOf<K> ? T | null : T {
  return savedOrDefault(coordinatorSettings().table, field, saved) as null extends DefaultOf<K> ? T | null : T;
}
type HiddenOf<D> = D extends unknown ? { [K in keyof FieldsOf<D>]: FieldsOf<D>[K] extends { hidden: true } ? K & string : never }[keyof FieldsOf<D>] : never;
export type HiddenField = HiddenOf<Declarer>;
// Each hidden setting's value, typed by its declared default.
export type HiddenSettings = { [K in HiddenField]: DefaultOf<K> };
// Where a hidden setting's value lives: the start's load until the settings owner installs on the
// party state, then the party state, which the settings writer changes and the settings document
// saves (`holdHiddenSettings`). It holds a reference, never a copy.
let hiddenSource: Readonly<HiddenSettings> | undefined;
// The start's load of the hidden settings, one pass over the declarations: each one's saved copy or
// its default. A hidden setting a declarer adds reaches the state with no line of its own.
export function hiddenSettings(saved: Record<string, unknown>): HiddenSettings {
  const { table } = coordinatorSettings();
  return hiddenSource = Object.fromEntries(declaredSettings(table).filter(entry => !entry.record && entry.hidden)
    .map(entry => [entry.field, savedOrDefault(table, entry.field, [saved[entry.field]])])) as HiddenSettings;
}
// The settings that load at the top of the settings document: every setting but a hidden one
// (`hiddenSettings`), a farming scope's (the profiles hold it), a credential (`path`) and one of
// another document.
type TopOf<D> = D extends { settings: infer S } ? { [K in keyof S]: S[K] extends { hidden: true } | { scope: 'scope' } | { path: unknown } | { document: unknown } ? never : K & string }[keyof S] : never;
export type TopSetting = TopOf<Declarer>;
// The start's load of those settings, one pass over the declarations: each one's saved copy or
// its default. A setting a declarer adds reaches the state with no line in initial.ts; an
// initializer that converts a field's saved value replaces its entry.
export function topSettings(saved: Record<string, unknown>): { [K in TopSetting]: DefaultOf<K> } {
  const { table } = coordinatorSettings();
  return Object.fromEntries([...table.fields.values()].filter(({ record, setting }) => !record && !setting.hidden &&
    setting.scope !== 'scope' && !setting.path && setting.document === undefined)
    .map(({ field }) => [field, savedOrDefault(table, field, [saved[field]])])) as { [K in TopSetting]: DefaultOf<K> };
}
// The settings install points the read at the party state, so a write applies at the next read.
export function holdHiddenSettings(state: Readonly<HiddenSettings>): void {
  hiddenSource = state;
}
// A hidden setting's value, the one read every owner's code takes: the saved copy or the declared
// default, and each write since. Before any saved settings load, as in a tool or a test that builds
// no state, there is no saved copy, so the value is the declared default, the answer
// `savedOrDefault` gives a field with none.
export function hiddenValue<K extends HiddenField>(field: K): HiddenSettings[K] {
  if (hiddenSource) return hiddenSource[field];
  const declared = coordinatorSettings().table.fields.get(field);
  if (!declared || declared.record || !declared.setting.hidden) throw Error(`${field} is not a hidden setting`);
  return declared.setting.default as HiddenSettings[K];
}
