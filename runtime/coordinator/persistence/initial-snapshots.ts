import { createJsonStore, type KeyValueStorage } from "./json-store.ts";

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

/** Load each saved document independently; retain legacy JSON values for initialization to interpret. */
export function readInitialCoordinatorSnapshots(
  storage: KeyValueStorage,
  warn: (details: { error: unknown }, message: string) => void,
): Record<SnapshotName, unknown> {
  const warnings = new Map(
    Object.values(snapshotSources).map((source) => [source.key as string, source.warning]),
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
  return result;
}
