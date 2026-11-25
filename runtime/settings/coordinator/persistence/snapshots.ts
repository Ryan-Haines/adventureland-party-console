/** Persisted v1 keys are API contracts: keep them stable across coordinator builds. */
export const stateKeys = {
  bank: "party_dashboard_bank_state_v1",
  settings: "party_dashboard_settings_state_v1",
  selections: "party_dashboard_selections_state_v1",
  history: "party_dashboard_history_state_v1",
  roster: "party_dashboard_roster_state_v1",
  aldata: "party_dashboard_aldata_state_v1",
  /** Settings layout 2: the ALData market cache, saved on each refresh. */
  market: "party_dashboard_market_state_v1",
  /** Settings layout 2: the production receipts and attempt journals. */
  production: "party_dashboard_production_state_v1",
} as const;

/**
 * A settings document carrying this marker gets its market and production
 * fields from their own keys. Without it, the settings document is the only
 * source: a v1.4.0 journal, or settings rewritten by a v1.4.0 build.
 */
export const settingsLayout = { field: "persistenceLayout", split: 2 } as const;

// The four documents' field lists come from the declaration table (runtime/settings/coordinator/
// table.ts), which the writer reads. This module keeps
// the document keys and the snapshot shapes.

// The market cache's five fields: each saved name and the ALData field it copies.
const marketFields = {
  aldataMarketListings: "marketListings",
  aldataMarketBuyOrders: "marketBuyOrders",
  aldataTrades: "trades",
  aldataMerchantsUpdatedAt: "merchantsUpdatedAt",
  aldataTradesUpdatedAt: "tradesUpdatedAt",
} as const;
type MarketField = keyof typeof marketFields;
const authFields = ["key", "auth", "authCheckedAt", "publishedAt"] as const;

/** Selectors preserve the domain's types while excluding timers, processes, and transient state. */
export function selectSnapshot<T, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const snapshot = {} as Pick<T, K>;
  for (const key of keys) snapshot[key] = source[key];
  return snapshot;
}

type SettingsInput = Record<string, unknown> & {
  aldata: Record<(typeof marketFields)[MarketField], unknown>;
};

/** `fields` is the settings document's list, which the declaration table builds. */
export function settingsSnapshot<T extends SettingsInput>(state: T, fields: readonly string[]) {
  return { ...selectSnapshot<Record<string, unknown>, string>(state, fields), ...marketSnapshot(state.aldata) };
}

/** Settings fields that layout 2 saves under their own key. */
export const marketSettingsFields = Object.keys(marketFields) as MarketField[];
export const productionSettingsFields = ["production"] as const;

export function marketSnapshot(aldata: SettingsInput["aldata"]): Record<MarketField, unknown> {
  return Object.fromEntries(marketSettingsFields.map(field => [field, aldata[marketFields[field]]])) as Record<MarketField, unknown>;
}

/**
 * The timestamp keys of a liveness field (a record declared `liveness`). A save
 * whose only changes are those values waits for the hidden setting `settingsLivenessMs` (writer.ts).
 */
const livenessKeys = new Set(["lastLiveAt", "lastObservedAt", "elapsedMs", "authorizedAt", "seenAt"]);

/**
 * JSON of a liveness field with its timestamps blanked. `quiet` keeps its area
 * keys and drops their times. `seen` is the 15 s hit filter in
 * runtime/hunting/coordinator/farm.ts and drops out.
 */
export function withoutLiveness(value: unknown): string | undefined {
  return JSON.stringify(value, (key, entry: unknown) => {
    if (typeof entry === "number" && livenessKeys.has(key)) return 0;
    if (key === "seen") return undefined;
    if (key === "quiet" && entry && typeof entry === "object") return Object.keys(entry);
    return entry;
  });
}

export function authSnapshot<T extends Record<(typeof authFields)[number], unknown>>(state: T) {
  return selectSnapshot(state, authFields);
}

/**
 * History is intentionally capped independently for each character. Each list keeps its newest
 * `kept` entries, the hidden setting historyKept, the
 * settings audit lines (section 4) included.
 */
export function historySnapshot<A, C, L>(
  activity: readonly A[],
  combat: Readonly<Record<string, readonly C[]>>,
  settingsChanges: readonly L[],
  kept: number,
) {
  return {
    merchantActivity: activity.slice(-kept),
    combatLogs: Object.fromEntries(
      Object.entries(combat).map(([name, entries]) => [name, entries.slice(-kept)]),
    ),
    settingsChanges: settingsChanges.slice(-kept),
  };
}
