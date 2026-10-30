import type { KeyValueStorage } from "./json-store.ts";
import {
  stateKeys,
  rosterFields,
  bankFields,
  selectionFields,
  selectSnapshot,
  settingsSnapshot,
  settingsFields,
  settingsLayout,
  splitSettingsFields,
  marketSnapshot,
  livenessFields,
  withoutLiveness,
  historySnapshot,
  authSnapshot,
} from "./snapshots.ts";
import { rosterSnapshots } from "../status/character-appearance.ts";

type PersistedCoordinator = Parameters<typeof settingsSnapshot>[0] &
  Record<
    (typeof rosterFields)[number] | (typeof bankFields)[number] | (typeof selectionFields)[number],
    unknown
  > & {
    merchantActivity: unknown[];
    combatLogs: Record<string, unknown[]>;
    aldata: Parameters<typeof settingsSnapshot>[0]["aldata"] & Parameters<typeof authSnapshot>[0];
  };

/**
 * History lines arrive 3-5 times a second. The saved history trails memory by
 * at most this long; docs/efficiency.md (Persistence) states the crash window.
 */
export const HISTORY_SAVE_MS = 5000;

/**
 * A settings save whose only changes are liveness timestamps
 * (`livenessFields`, snapshots.ts) waits until this long after the previous
 * settings record. Any other change saves within a second.
 */
export const SETTINGS_LIVENESS_MS = 30000;

type SettingsField = (typeof settingsFields)[number];

/** Use explicit snapshots so process handles and credentials stay in their intended documents. */
export function createCoordinatorPersistence(
  state: PersistedCoordinator,
  storage: KeyValueStorage,
) {
  let settingsTimer: ReturnType<typeof setTimeout> | undefined;
  let historyTimer: ReturnType<typeof setTimeout> | undefined;
  let historyDirty = false;
  let livenessTimer: ReturnType<typeof setTimeout> | undefined;
  // The last settings record: JSON per field, the same with timestamps
  // blanked for liveness fields, and the time the writer saved it.
  let savedFields: Map<string, string> | undefined;
  let savedLiveness = new Map<string, string | undefined>();
  let savedAt = 0;
  let savedMarket: unknown[] | undefined;
  function write(key: string, value: unknown): void {
    // KeyValueStorage.set copies or serializes before it returns, so the
    // snapshot can share arrays with live state.
    storage.set(key, value);
  }
  function writeJson(key: string, json: string): void {
    if (storage.setSerialized) storage.setSerialized(key, json);
    else storage.set(key, JSON.parse(json));
  }
  function market(): void {
    // aldata-service.ts replaces these values on refresh and never edits the
    // arrays in place, so identity tells whether the cache changed.
    const { aldata } = state;
    const sources = [aldata.marketListings, aldata.marketBuyOrders, aldata.trades,
      aldata.merchantsUpdatedAt, aldata.tradesUpdatedAt];
    if (savedMarket?.every((value, index) => value === sources[index])) return;
    write(stateKeys.market, marketSnapshot(aldata));
    savedMarket = sources;
  }
  function fieldJson(fields: readonly string[], source: Record<string, unknown>): Map<string, string> {
    const result = new Map<string, string>();
    for (const field of fields) {
      const json = JSON.stringify(source[field]);
      if (json !== undefined) result.set(field, json);
    }
    return result;
  }
  function documentJson(fields: Map<string, string>): string {
    let json = "";
    for (const [field, value] of fields) json += (json ? "," : "{") + JSON.stringify(field) + ":" + value;
    return json ? json + "}" : "{}";
  }
  /** "same" saves nothing, "liveness" waits for the liveness window, "changed" saves now. */
  function settingsChange(fields: Map<string, string>): "same" | "liveness" | "changed" {
    if (!savedFields || fields.size !== savedFields.size) return "changed";
    let liveness = false;
    for (const [field, json] of fields) {
      if (savedFields.get(field) === json) continue;
      if (!livenessFields.has(field) ||
        withoutLiveness(state[field as SettingsField]) !== savedLiveness.get(field)) return "changed";
      liveness = true;
    }
    return liveness ? "liveness" : "same";
  }
  function saveSettings(fields: Map<string, string>, json: string): void {
    writeJson(stateKeys.settings, json);
    savedFields = fields;
    savedLiveness = new Map([...livenessFields].map((field) =>
      [field, withoutLiveness(state[field as SettingsField])]));
    savedAt = Date.now();
    clearTimeout(livenessTimer);
    livenessTimer = undefined;
  }
  function roster(): void {
    const fields = selectSnapshot(state, rosterFields);
    write(stateKeys.roster, { ...fields, characterSnapshots: rosterSnapshots(state, fields.characterSnapshots) });
  }
  function bank(): void {
    write(stateKeys.bank, selectSnapshot(state, bankFields));
  }
  /**
   * Saves selections, the market cache and production, then settings in
   * layout 2. Split documents go first, so a settings record with the layout
   * marker always has its split documents on disk.
   */
  function settings(): void {
    clearTimeout(settingsTimer);
    settingsTimer = undefined;
    write(stateKeys.selections, selectSnapshot(state, selectionFields));
    market();
    write(stateKeys.production, { production: state.production });
    const fields = fieldJson(splitSettingsFields, state);
    fields.set(settingsLayout.field, String(settingsLayout.split));
    const change = settingsChange(fields);
    if (change === "same") {
      clearTimeout(livenessTimer);
      livenessTimer = undefined;
      return;
    }
    if (change === "liveness" && Date.now() - savedAt < SETTINGS_LIVENESS_MS) {
      livenessTimer ??= setTimeout(() => { livenessTimer = undefined; settings(); },
        savedAt + SETTINGS_LIVENESS_MS - Date.now());
      livenessTimer.unref();
      return;
    }
    saveSettings(fields, documentJson(fields));
  }
  /**
   * The v1.4.0 layout: every field in the settings document, plus the marker.
   * A v1.4.0 build started after this save reads every field.
   */
  function rollbackSettings(): void {
    clearTimeout(settingsTimer);
    settingsTimer = undefined;
    write(stateKeys.selections, selectSnapshot(state, selectionFields));
    market();
    write(stateKeys.production, { production: state.production });
    const legacy = fieldJson([...settingsFields, ...Object.keys(marketSnapshot(state.aldata))],
      settingsSnapshot(state));
    legacy.set(settingsLayout.field, String(settingsLayout.split));
    const fields = fieldJson(splitSettingsFields, state);
    fields.set(settingsLayout.field, String(settingsLayout.split));
    saveSettings(fields, documentJson(legacy));
  }
  function historyNow(): void {
    clearTimeout(historyTimer);
    historyTimer = undefined;
    historyDirty = true;
    write(stateKeys.history, historySnapshot(state.merchantActivity, state.combatLogs));
    historyDirty = false;
  }
  function savePendingHistory(): void {
    historyTimer = undefined;
    // The timer has no request to fail. The document stays dirty, so the next
    // line or the shutdown flush retries it.
    try { historyNow(); } catch (error) { console.error("Coordinator history save failed", error); }
  }
  function history(): void {
    historyDirty = true;
    if (historyTimer) return;
    historyTimer = setTimeout(savePendingHistory, HISTORY_SAVE_MS);
    historyTimer.unref();
  }
  function aldata(): void {
    write(stateKeys.aldata, authSnapshot(state.aldata));
  }
  function scheduleSettings(): void {
    if (settingsTimer) return;
    settingsTimer = setTimeout(settings, 1000);
    settingsTimer.unref();
  }
  /** Shutdown: save everything pending and leave settings readable by v1.4.0. */
  function flush(): void {
    try {
      rollbackSettings();
    } finally {
      if (historyDirty) historyNow();
    }
  }
  return { roster, bank, settings, scheduleSettings, flush, history, historyNow, aldata };
}
