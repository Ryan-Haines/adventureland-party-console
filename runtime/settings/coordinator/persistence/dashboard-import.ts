import { stateKeys } from "./snapshots.ts";
import { coordinatorSettings } from "../table.ts";
import { type AddonState } from "../../../hooks/registry.ts";
import { object, valueProblem, type ObjectValue, type Setting, type SettingsChange, type SettingsWrite, type SettingsWriteResult } from "../../api.ts";
// The fields the settings export carries and the import takes: the declarations marked
// `importable`, per character when declared `scope: 'character'`.
// The parse runs each one's declared check on the whole value before it
// keeps the characters this account owns, as b9b5c91e's validators ran first, so a malformed field
// refuses the preview by name before any backup. Jobs, credentials, runtime ownership and
// navigation checkpoints are not importable.
// Each declaration also carries its owner's import rules (settings/api.ts `ImportRules`).
function importable() {
  return [...coordinatorSettings().table.fields.values()].filter(d => d.setting.importable).map(d => ({ field: d.field,
    fit: d.setting.fit, characterKey: d.setting.characterKey, imported: d.setting.imported,
    malformed: (value: unknown) => d.record ? !!d.setting.check && !d.setting.check(value) : valueProblem(d.setting, value) !== undefined,
    perCharacter: d.setting.scope === 'character' }));
}
// The largest import the parse takes; the metadata route tells the dashboard.
export const IMPORT_MAX_BYTES = 128 * 1024 * 1024;

// The installed add-ons' settings (the hook registry's registrations), for the export and the
// import. An add-on setting declared `importable` travels inside `addons`, under its add-on's
// name, with no switch: the import writes each as an addressed change, which the writer checks by
// its kind and which leaves the switch and every other key as they are.
export type AddonSettings = readonly { name: string; settings?: Readonly<Record<string, Setting>> }[];
type AddonValues = Record<string, { settings: Record<string, unknown> }>;
const importableAddonSettings = (addons: AddonSettings) => addons.flatMap(addon =>
  Object.entries(addon.settings ?? {}).filter(([, setting]) => setting.importable).map(([key, setting]) => ({ addon: addon.name, key, setting })));

function safeKeys(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error("State nesting is too deep");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key))
      throw new Error("Invalid state key");
    safeKeys(child, depth + 1);
  }
}

export interface DashboardImport {
  values: ObjectValue;
  fields: string[];
  characters: string[];
  skippedCharacters?: Record<string, string[]>;
  // Each importable add-on setting's kind, by add-on and key, for the addressed changes.
  addonKinds?: Record<string, Record<string, string>>;
}

function parseRecord(line: string, lineNumber: number): [string, unknown] {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    throw new Error(`Invalid JSON on line ${lineNumber}`);
  }
  if (!object(record) || Object.keys(record).length !== 1)
    throw new Error(`Invalid state record on line ${lineNumber}`);
  return Object.entries(record)[0]!;
}

function decodeRecord(value: unknown, lineNumber: number): ObjectValue {
  let decoded: unknown;
  try {
    decoded = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new Error(`Invalid dashboard data on line ${lineNumber}`);
  }
  if (!object(decoded)) throw new Error(`Invalid dashboard data on line ${lineNumber}`);
  safeKeys(decoded);
  return decoded;
}

/** Replay JSONL in order, including overwritten records and deletion tombstones. */
function replayRecords(source: string): Map<string, ObjectValue> {
  const records = new Map<string, ObjectValue>();
  let lineNumber = 0;
  for (const line of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    lineNumber++;
    if (!line.trim()) continue;
    const [key, value] = parseRecord(line, lineNumber);
    if (key !== stateKeys.settings && key !== stateKeys.selections) continue;
    if (value === null) {
      records.delete(key);
      continue;
    }
    records.set(key, decodeRecord(value, lineNumber));
  }
  return records;
}

function validatedValues(merged: ObjectValue, owned: (name: string) => boolean, addons: AddonSettings) {
  const values: ObjectValue = {},
    characters = new Set<string>();
  const skippedCharacters: Record<string, string[]> = {};
  const include = (name: string, field: string) => {
    if (owned(name)) { characters.add(name); return true; }
    const fields = skippedCharacters[name] ||= [];
    if (!fields.includes(field)) fields.push(field);
    return false;
  };
  for (const { field: key, fit, characterKey, malformed, perCharacter } of importable()) {
    if (!(key in merged)) continue;
    let value = fit ? fit(merged[key]) : merged[key];
    if (malformed(value)) throw new Error(`Invalid saved ${key}; nothing was imported`);
    if (perCharacter) {
      const entries = Object.entries(value as ObjectValue);
      value = Object.fromEntries(entries.filter(([name]) => include(name, key)));
      if (entries.length && !Object.keys(value as ObjectValue).length) continue;
    }
    if (characterKey) value = filterCharacterReferences(key, characterKey, value, include);
    if (value === undefined) continue;
    values[key] = value;
  }
  // The importable add-on settings: a setting's declared `fit` reads the file's value first, a
  // choice per fighter keeps the characters this account owns, and a character the account no
  // longer owns leaves its setting out. The writer checks each by its kind and the add-on's check
  //, so a fit never lets a value past them, and a route write never runs the fit.
  const file = object(merged.addons) ? merged.addons : {}, carried: AddonValues = {};
  for (const { addon, key, setting } of importableAddonSettings(addons)) {
    const entry = file[addon];
    if (!object(entry) || !object(entry.settings) || !(key in entry.settings)) continue;
    let value = setting.fit ? setting.fit(entry.settings[key]) : entry.settings[key];
    if (setting.kind === 'per-character' && object(value)) value = Object.fromEntries(Object.entries(value).filter(([name]) => include(name, 'addons')));
    if (setting.kind === 'character' && typeof value === 'string' && !include(value, 'addons')) continue;
    (carried[addon] ??= { settings: {} }).settings[key] = value;
  }
  if (Object.keys(carried).length) values.addons = carried;
  // Each skipped character's fields in name order, as the imported fields are, so the preview
  // reads the same whatever order the declarations load in.
  for (const fields of Object.values(skippedCharacters)) fields.sort();
  return { values, characters, skippedCharacters };
}

// A field keyed by item names its character inside each entry, under its declared `characterKey`.
function filterCharacterReferences(key: string, characterKey: string, value: unknown, include: (name: string, field: string) => boolean): unknown {
  const entries = Object.entries(value as ObjectValue);
  const kept = entries.filter(([, entry]) => {
    const name = (entry as ObjectValue)[characterKey];
    return typeof name !== 'string' || !name || include(name, key);
  });
  if (entries.length && !kept.length) return undefined;
  return Array.isArray(value) ? kept.map(([, entry]) => entry) : Object.fromEntries(kept);
}

export function exportDashboardSettings(state: ObjectValue, addons: AddonSettings = []) {
  const settings: ObjectValue = Object.fromEntries(importable().filter(({ field }) => field in state).map(({ field, fit }) => [field,
    fit ? fit(state[field]) : state[field]]));
  const saved = (object(state.addons) ? state.addons : {}) as Record<string, AddonState>, carried: AddonValues = {};
  for (const { addon, key } of importableAddonSettings(addons)) {
    const value = saved[addon]?.settings?.[key];
    if (value !== undefined) (carried[addon] ??= { settings: {} }).settings[key] = value;
  }
  if (Object.keys(carried).length) settings.addons = carried;
  return { format: "party-console-settings", version: 1, settings };
}
function importedSettings(source: string): ObjectValue {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { /* Legacy JSONL. */ }
  if (object(parsed) && parsed.format === "party-console-settings") {
    if (parsed.version !== 1 || !object(parsed.settings)) throw new Error("Unsupported settings file");
    safeKeys(parsed.settings);
    return parsed.settings;
  }
  const records = replayRecords(source);
  return { ...records.get(stateKeys.settings), ...records.get(stateKeys.selections) };
}

export function parseDashboardImport(
  source: string,
  owned: (name: string) => boolean,
  addons: AddonSettings = [],
): DashboardImport {
  if (typeof source !== "string" || !source.trim())
    throw new Error("Choose a non-empty settings JSON or legacy JSONL file");
  if (Buffer.byteLength(source, "utf8") > IMPORT_MAX_BYTES)
    throw new Error("State file exceeds 128 MB");
  const merged = importedSettings(source);
  const { values, characters, skippedCharacters } = validatedValues(merged, owned, addons);

  if (!Object.keys(values).length && !Object.keys(skippedCharacters).length)
    throw new Error("No supported dashboard settings or marks found in this file");
  const addonKinds: Record<string, Record<string, string>> = {};
  for (const { addon, key, setting } of importableAddonSettings(addons)) (addonKinds[addon] ??= {})[key] = setting.kind;
  return { values, fields: Object.keys(values).sort(), characters: [...characters].sort(), skippedCharacters, addonKinds };
}

// The import's values after each field's declared import rule:
// the farming profile merge, the routine priority migration and the
// passive hunting pair. Settings and records apart.
function importedChanges(state: ObjectValue, parsed: DashboardImport) {
  const values = { ...parsed.values };
  for (const { field, imported } of importable()) if (imported && Object.hasOwn(parsed.values, field)) Object.assign(values, imported(parsed.values, state));
  const { table } = coordinatorSettings();
  const settings: SettingsChange[] = [], records: [string, unknown][] = [];
  for (const [field, value] of Object.entries(values)) {
    if (field === 'addons') settings.push(...addonChanges(value as AddonValues, parsed.addonKinds ?? {}));
    else if (table.fields.get(field)?.record) records.push([field, value]); else settings.push({ field, value });
  }
  return { settings, records };
}

// The value of every field the apply changes, as the state holds it before the apply: the
// settings and records of the import, the passive pair its migration derives, and the bank sort
// request it ends. The route restores exactly these if the apply fails.
export function importedPrevious(state: ObjectValue, parsed: DashboardImport): ObjectValue {
  const { settings, records } = importedChanges(state, parsed);
  const fields = new Set([...settings.map(change => change.field), ...records.map(([field]) => field), "bankSortRequest"]);
  return Object.fromEntries([...fields].map(field => [field, state[field]]));
}

// The import writes the file's settings as one batch through the settings writer, as `import`, so
// each passes the check its route uses and a refusal names the field with nothing applied.
// Its records, already checked in the parse, apply after the writer accepts the batch, with no
// audit line, and a pending bank sort ends when the imported mode is automatic. Returns the
// writer's refusal, or null.
export function applyDashboardImport(state: ObjectValue, parsed: DashboardImport, write: (batch: SettingsWrite) => SettingsWriteResult): SettingsWriteResult & { ok: false } | null {
  const { settings, records } = importedChanges(state, parsed);
  const written = write({ by: "import", changes: settings });
  if (!written.ok) return written;
  for (const [key, value] of records) state[key] = value;
  if (state.bankSortMode === "automatic") state.bankSortRequest = null;
  return null;
}
// The file's add-on settings as addressed changes, one per key and one per fighter of a
// per-character setting, so the switch and every unnamed key stay as they are.
function addonChanges(values: AddonValues, kinds: Readonly<Record<string, Readonly<Record<string, string>>>>): SettingsChange[] {
  return Object.entries(values).flatMap(([addon, entry]) => Object.entries(entry.settings).flatMap(([key, value]) =>
    kinds[addon]?.[key] === 'per-character' && object(value)
      ? Object.entries(value).map(([character, choice]) => ({ field: 'addons', addon, key, character, value: choice }))
      : [{ field: 'addons', addon, key, value }]));
}
