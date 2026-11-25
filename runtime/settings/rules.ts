// The settings owner's rules: what a declaration
// may say (`declarationProblem`, `addonSettingProblem`, the table's rules across declarers), and
// the kind checks (`accepts`). Every saved `party` field's declaration table is built here once
// from every declarer.
import type { CheckGameData, Declarations, ObjectValue, SavedRecord, Setting } from './api.ts';

// Step 9b adds `choice` (one of `choices`), `number` (from `min` to `max`) and `per-character`
// (one of `choices` for each of the party's fighters, saved as a name-to-choice map). The
// settings rework adds `text` and `monsters`, a list of distinct monster ids that the
// coordinator's game data names. It adds `items`, a list of distinct game item ids, for
// the items owner's add-on claims. `records` is a list of records, each field checked by its own kind
//; the add-on manager draws it as a table.
export const ADDON_KINDS = ['character', 'boolean', 'choice', 'number', 'per-character', 'text', 'monsters', 'items', 'records'] as const;
// The kinds a `records` setting's field takes.
export const RECORD_FIELD_KINDS = ['boolean', 'choice', 'number', 'text', 'character', 'monsters', 'items'] as const;
export interface RecordField { label: string; kind: (typeof RECORD_FIELD_KINDS)[number]; choices?: readonly string[]; min?: number; max?: number }
// The settings owner adds `text` and `value`, a
// compound value whose `check` the route, the import and the load share. An add-on keeps the
// 9b kinds. The fields after `max` describe a saved `party` field, which a core declarer names.
export const SETTING_KINDS = [...ADDON_KINDS, 'value'] as const;
// `account` is one value; `scope` is one value per farming scope (the leader's profile, or a
// character with Follow off); `character` is a map by character name.
export const SETTING_SCOPES = ['account', 'scope', 'character'] as const;
// The saved documents of persistence/snapshots.ts `stateKeys`. Only a record goes in `history`.
// `aldata` is the credentials document, which keeps its own snapshot (persistence/snapshots.ts
// `authSnapshot`); only a secret setting under `party.aldata` names it.
export const SETTING_DOCUMENTS = ['settings', 'selections', 'roster', 'bank', 'history', 'aldata'] as const;
// Who receives a field raw: the characters in the heartbeat reply, and the dashboard in its
// `config` section or its live `core` section (runtime/status/coordinator/state.ts). A field the reply
// computes is not delivered raw; its owner's reply code reads it.
export const DELIVERIES = ['characters', 'dashboard', 'dashboard-core'] as const;
// The most a hung `flock --nonblock` helper may run when the journal store takes its guard
// (persistence/jsonl-store.ts); the helper itself returns at once. A firing tells boundFired.
export const LOCK_HELPER_TIMEOUT_MS = 5000; // b9b5c91e:runtime/coordinator/persistence/jsonl-store.ts:85
// A plain object, the shape every compound value's check starts from.
export const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);

// What an add-on setting declares. `importable` puts it in the settings export and lets the
// import set it.
// `scope: 'scope'` places a setting per farming scope; `check` is the add-on's own rule over its
// own keys; `fit` reads an imported value past the add-on's bound as that bound, as a core
// field's fit does (api.ts ImportRules).
export const ADDON_SETTING_FIELDS = ['label', 'kind', 'default', 'choices', 'min', 'max', 'fields', 'importable', 'scope', 'check', 'fit'] as const;
// One declaration's own problems. The registry's add-on
// check and the settings table both run it; the table adds the rules across declarations.
// `own` is an add-on's own settings at their defaults, for its own check of a default.
export function declarationProblem(owner: string, name: string, d: Setting | SavedRecord, record: boolean, own?: Readonly<Record<string, unknown>>): string | undefined {
  const setting = record ? undefined : d as Setting;
  if (setting && !SETTING_KINDS.includes(setting.kind)) return `${owner} declares the setting ${name} of kind "${setting.kind}", which the settings do not have`;
  if (d.scope !== undefined && !SETTING_SCOPES.includes(d.scope)) return `${owner} declares ${name} with the scope "${d.scope}", which the settings do not have`;
  if (d.document !== undefined && (!SETTING_DOCUMENTS.includes(d.document) || setting && d.document === 'history'))
    return `${owner} declares ${name} in the document "${d.document}", which the ${record ? 'records' : 'settings'} do not have`;
  for (const to of d.deliver ?? []) if (!DELIVERIES.includes(to)) return `${owner} declares ${name} delivered to "${to}", which the settings do not deliver to`;
  if (setting && (setting.kind === 'choice' || setting.kind === 'per-character') && !setting.choices?.length && !(setting.kind === 'choice' && setting.slot))
    return `${owner} declares the setting ${name} with no choices`;
  if (setting?.kind === 'value' && !setting.check) return `${owner} declares the setting ${name} of kind "value" with no check`;
  if (setting?.kind === 'records') {
    const fields = Object.entries(setting.fields ?? {});
    if (!fields.length) return `${owner} declares the setting ${name} of kind "records" with no fields`;
    for (const [key, field] of fields) {
      if (!RECORD_FIELD_KINDS.includes(field.kind)) return `${owner} declares the field ${key} of ${name} with the kind "${field.kind}", which a record does not have`;
      if (field.kind === 'choice' && !field.choices?.length) return `${owner} declares the field ${key} of ${name} with no choices`;
    }
  }
  // A derived record sits beside the fields it reads: a scope's top-level copy and its profile.
  if (record && (d as SavedRecord).derive && (d.scope !== 'scope' || d.profileOnly || d.importable))
    return `${owner} declares ${name} derived, which only a farming scope's record with a top-level copy and no import is`;
  if (d.document === 'aldata' && !(setting?.secret && setting.path?.[0] === 'aldata'))
    return `${owner} declares ${name} in the credentials document, which holds only a secret setting under party.aldata`;
  if (!accepts(d, setting, d.default, own)) return `${owner} declares ${name} with a default its own check refuses`;
  return undefined;
}
// A field's range, the one rule the settings list and the declared read share: a `number` declares
// `min` and `max`, and a `value` field's whole-number check carries them (api.ts `wholeFrom`). A
// field with neither has no range. Only a finite bound is sent, since `whole(1)` has no upper one.
export function rangeOf(setting: Setting): { min?: number; max?: number } {
  const { min, max } = setting.kind === 'number' ? setting : setting.check?.range ?? {};
  return { ...(Number.isFinite(min) ? { min } : {}), ...(Number.isFinite(max) ? { max } : {}) };
}
// The kind's own check, then the declared one.
export function accepts(d: Setting | SavedRecord, setting: Setting | undefined, value: unknown, own?: Readonly<Record<string, unknown>>, game?: CheckGameData): boolean {
  switch (setting?.kind) {
    case 'boolean': if (typeof value !== 'boolean') return false; break;
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value) || value < (setting.min ?? -Infinity) || value > (setting.max ?? Infinity)) return false; break;
    // A slot's entries come from the registry at each write; with none given, the kind takes a name.
    case 'choice': if (setting.slot && !setting.choices ? typeof value !== 'string' : !setting.choices!.includes(value as string)) return false; break;
    case 'character': if (value !== null && typeof value !== 'string') return false; break;
    case 'text': if (typeof value !== 'string') return false; break;
    // The ids' membership in game data is the writer's check, which holds the data.
    // An `items` setting names game items the same way, for the items owner's add-on claims.
    case 'monsters': case 'items': if (!Array.isArray(value) || !value.every(id => typeof id === 'string') || new Set(value).size !== value.length) return false; break;
    case 'per-character': if (!object(value) || !Object.values(value).every(v => setting.choices!.includes(v as string))) return false; break;
    // Each record names only declared fields, and each value passes its field's kind check. A
    // field a record leaves out stays unset.
    case 'records': if (!Array.isArray(value) || !value.every(record => object(record) && Object.entries(record).every(([key, field]) => {
      const declared = setting.fields?.[key] && { ...setting.fields[key], default: undefined } as Setting;
      return !!declared && accepts(declared, declared, field);
    }))) return false; break;
  }
  return !d.check || (d as Setting).check!(value, own, game);
}
// The declaration rules for a registration's own settings, which the hook registry's load check asks once per
// registration. An add-on's settings save inside its entry of `addons`,
// so the fields that place a saved `party` field do not apply to them, and an add-on
// keeps its own state in its store, so it declares no record.
export function addonSettingProblem(r: Declarations & { folder: 'core' | 'addons' }): string | undefined {
  const defaults = Object.fromEntries(Object.entries(r.settings ?? {}).map(([key, setting]) => [key, setting.default]));
  for (const [key, setting] of Object.entries(r.settings ?? {})) {
    if (r.folder === 'addons' && setting.scope !== undefined && setting.scope !== 'scope')
      return `${r.name} declares its setting ${key} with the scope "${setting.scope}"; an add-on setting is one value or one per farming scope (scope: 'scope')`;
    if (r.folder === 'addons' && !(ADDON_KINDS as readonly string[]).includes(setting.kind))
      return `${r.name} declares the setting ${key} of kind "${setting.kind}", which the settings do not have`;
    const placed = r.folder === 'addons' && Object.keys(setting).find(field => !(ADDON_SETTING_FIELDS as readonly string[]).includes(field));
    if (placed) return `${r.name} declares ${placed} on its setting ${key}; an add-on setting saves with the add-on's switch and takes only ${ADDON_SETTING_FIELDS.join(', ')}`;
    const problem = declarationProblem(r.name, key, setting, false, defaults);
    if (problem) return problem;
  }
  if (r.folder === 'addons' && Object.keys(r.records ?? {}).length)
    return `${r.name} declares the record ${Object.keys(r.records!)[0]}; an add-on keeps its own state in its store`;
  return undefined;
}

// `settings.overlay`: an add-on's value
// for one read of a player's setting. It takes a setting the player sets, never a record play
// writes, and never a field marked `noOverlay` or a credential. The value passes the field's own
// check, as a write does.
export function overlayProblem(table: SettingsTable, field: string, value: unknown, game?: CheckGameData): string | undefined {
  const problem = overlayFieldProblem(table, field);
  if (problem) return problem;
  const setting = table.members?.get(field) ?? (table.fields.get(field) as Extract<Declared, { record: false }>).setting;
  return accepts(setting, setting, value, undefined, game) ? undefined : `${setting.label} refuses this value`;
}
// The field half of `overlayProblem`, which the registry also asks at load for each field an
// add-on lists in `overlays`, so an add-on naming a hand control, a switch or a credential never loads.
export function overlayFieldProblem(table: SettingsTable, field: string): string | undefined {
  const member = table.members?.get(field);
  if (member) return member.noOverlay || member.secret ? `${member.label} takes no add-on value` : undefined;
  const d = table.fields.get(field);
  if (!d) return `${field} is not a declared setting`;
  if (d.record) return `${field} is a record play writes, not a player's setting`;
  if (d.setting.noOverlay || d.setting.secret || d.setting.path) return `${d.setting.label} takes no add-on value`;
  return undefined;
}

export type Declared =
  | { field: string; owner: string; record: false; setting: Setting }
  | { field: string; owner: string; record: true; setting: SavedRecord };
// `members` holds each record's member settings by `<record>.<key>` (api.ts SavedRecord `members`).
export interface SettingsTable { fields: ReadonlyMap<string, Declared>; members?: ReadonlyMap<string, Setting> }
export type TableResult = { ok: true; table: SettingsTable } | { ok: false; refusals: string[] };

// The heartbeat reply's name for a field delivered to the characters.
const replyName = (field: string, d: Setting | SavedRecord) => d.reply ?? field;

// Builds the table from every declarer, after every registration loads and before the state
// loads. It refuses each declaration that breaks a rule of 2.1, naming the field and every
// declarer that declares it; any refusal refuses the whole table, because the state would load
// without that field. An add-on's settings save inside `addons` under the add-on's name, so they
// are no `party` field; the registry checks them when the add-on registers.
export function buildSettingsTable(declarers: readonly (Declarations & { folder?: 'core' | 'addons' })[]): TableResult {
  const refusals: string[] = [];
  const owners = new Map<string, { owner: string; record: boolean }[]>();
  const fields = new Map<string, Declared>(), members = new Map<string, Setting>();
  for (const declarer of declarers) {
    if (declarer.folder === 'addons') continue;
    const entries: [string, Setting | SavedRecord, boolean][] = [
      ...Object.entries(declarer.settings ?? {}).map(([field, s]): [string, Setting, boolean] => [field, s, false]),
      ...Object.entries(declarer.records ?? {}).map(([field, r]): [string, SavedRecord, boolean] => [field, r, true])];
    for (const [field, d, record] of entries) {
      (owners.get(field) ?? owners.set(field, []).get(field)!).push({ owner: declarer.name, record });
      const problem = declarationProblem(declarer.name, field, d, record);
      if (problem) refusals.push(problem);
      fields.set(field, record ? { field, owner: declarer.name, record, setting: d as SavedRecord } : { field, owner: declarer.name, record, setting: d as Setting });
      for (const [key, member] of Object.entries(record ? (d as SavedRecord).members ?? {} : {})) {
        const memberProblem = declarationProblem(declarer.name, `${field}.${key}`, member, false);
        if (memberProblem) refusals.push(memberProblem);
        members.set(`${field}.${key}`, member);
      }
    }
  }
  // Rule 1: one declaration per field.
  for (const [field, by] of owners) if (by.length > 1) {
    const both = by.some(b => b.record) && by.some(b => !b.record);
    refusals.push(`${field} is declared ${both ? 'as a setting and a record' : 'twice'}, by ${by.map(b => `${b.owner} (${b.record ? 'record' : 'setting'})`).join(' and ')}`);
  }
  // Rule 5: one field per reply name.
  const replies = new Map<string, string[]>();
  for (const d of fields.values()) if (d.setting.deliver?.includes('characters'))
    (replies.get(replyName(d.field, d.setting)) ?? replies.set(replyName(d.field, d.setting), []).get(replyName(d.field, d.setting))!).push(`${d.field} (${d.owner})`);
  for (const [reply, by] of replies) if (by.length > 1) refusals.push(`${by.join(' and ')} reach the characters under one reply name, ${reply}`);
  return refusals.length ? { ok: false, refusals } : { ok: true, table: { fields, members } };
}
