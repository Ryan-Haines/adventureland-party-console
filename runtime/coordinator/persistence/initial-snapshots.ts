import { createJsonStore, type KeyValueStorage } from "./json-store.ts";
import { stateKeys, settingsLayout, marketSettingsFields, productionSettingsFields, joinAchievementState } from "./snapshots.ts";

const snapshotSources = {
  persistedBankState: {
    key: "party_dashboard_bank_state_v1",
    warning: "Ignoring invalid persisted Party Console bank state",
  },
  persistedSettings: {
    key: "party_dashboard_settings_state_v1",
    warning: "Ignoring invalid persisted Party Console settings",
  },
  persistedSelections: {
    key: "party_dashboard_selections_state_v1",
    warning: "Ignoring invalid persisted Party Console selections",
  },
  persistedHistory: {
    key: "party_dashboard_history_state_v1",
    warning: "Ignoring invalid persisted Party Console history",
  },
  persistedRoster: {
    key: "party_dashboard_roster_state_v1",
    warning: "Ignoring invalid persisted Party Console roster state",
  },
  persistedALData: {
    key: "party_dashboard_aldata_state_v1",
    warning: "Ignoring invalid persisted ALData settings",
  },
} as const;
type SnapshotName = keyof typeof snapshotSources;
const splitSources = [
  { key: stateKeys.market, fields: marketSettingsFields,
    warning: "Ignoring invalid persisted Party Console market cache" },
  { key: stateKeys.production, fields: productionSettingsFields,
    warning: "Ignoring invalid persisted Party Console production state" },
] as const;
const achievementWarning = "Ignoring invalid persisted Achievement Hunt state";

/** Load each saved document independently; retain legacy JSON values for initialization to interpret. */
export function readInitialCoordinatorSnapshots(
  storage: KeyValueStorage,
  warn: (details: { error: unknown }, message: string) => void,
): Record<SnapshotName, unknown> {
  const warnings = new Map(
    [...Object.values(snapshotSources), ...splitSources, { key: stateKeys.achievement, warning: achievementWarning }]
      .map((source) => [source.key as string, source.warning]),
  );
  const store = createJsonStore(storage, {
    invalid: (key, error) => warn({ error }, warnings.get(key)!),
  });
  const result = {} as Record<SnapshotName, unknown>;
  for (const name of Object.keys(snapshotSources) as SnapshotName[]) {
    result[name] = store.read({
      key: snapshotSources[name].key,
      decode: (value) => value,
      empty: () => ({}),
    });
  }
  result.persistedSettings = joinSettings(result.persistedSettings, store);
  return result;
}

/**
 * Layout 2 (docs/efficiency.md, Persistence) keeps the market cache,
 * production and Achievement Hunt state under their own keys. Only a settings document with the layout
 * marker takes them from there; settings saved by a v1.4.0 build, before or
 * after a rollback, carry these fields themselves.
 */
function joinSettings(settings: unknown, store: ReturnType<typeof createJsonStore>): unknown {
  if (!settings || typeof settings !== "object") return settings;
  const record = settings as Record<string, unknown>;
  if (!Object.hasOwn(record, settingsLayout.field)) return settings;
  const { [settingsLayout.field]: layout, ...joined } = record;
  if (layout !== settingsLayout.split) return joined;
  for (const source of splitSources) {
    const saved = store.read({ key: source.key, decode: (value) => value, empty: () => ({}) });
    if (!saved || typeof saved !== "object") continue;
    for (const field of source.fields)
      if (Object.hasOwn(saved, field)) joined[field] = (saved as Record<string, unknown>)[field];
  }
  joinAchievementState(joined, store.read({ key: stateKeys.achievement, decode: (value) => value, empty: () => ({}) }));
  return joined;
}
