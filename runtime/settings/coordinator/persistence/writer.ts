import type { KeyValueStorage } from "./json-store.ts";
import type { ScopeHandle } from "../../../lifecycle/api.ts";
import {
  stateKeys,
  selectSnapshot,
  settingsSnapshot,
  settingsLayout,
  marketSnapshot,
  productionSettingsFields,
  withoutLiveness,
  historySnapshot,
  authSnapshot,
} from "./snapshots.ts";
import { coordinatorSettings, hiddenValue } from "../table.ts";
import { rosterSnapshots } from "./roster-snapshots.ts";

type PersistedCoordinator = Parameters<typeof settingsSnapshot>[0] & {
    merchantActivity: unknown[];
    combatLogs: Record<string, unknown[]>;
    settingsChanges: unknown[];
    aldata: Parameters<typeof settingsSnapshot>[0]["aldata"] & Parameters<typeof authSnapshot>[0];
  };

/** Use explicit snapshots so process handles and credentials stay in their intended documents. */
// `saved` hears each document the persistence writes to storage, by its stateKeys name, for the
// settings owner's `settings.saved` notice (part 2). It hears only a write the store appended: the
// store skips a document equal to its last record. `timers` is the settings owner's run scope handle
// (application.ts `scopes.act11`), so the run's stop clears a pending save timer as flush's own
// releases do.
export function createCoordinatorPersistence(
  state: PersistedCoordinator,
  storage: KeyValueStorage,
  timers: Pick<ScopeHandle, 'setTimeout' | 'clearTimeout'>,
  saved: (document: keyof typeof stateKeys) => void = () => {},
) {
  const documentOf = new Map<string, keyof typeof stateKeys>(Object.entries(stateKeys).map(([name, key]) => [key, name as keyof typeof stateKeys]));
  // The documents' field lists, built from the declaration table.
  const { settingsFields, selectionFields, rosterFields, bankFields, livenessFields } = coordinatorSettings().lists;
  // The saved history trails memory by at most historySaveMs (docs/efficiency.md, Persistence,
  // states the crash window). A settings save whose only changes are liveness timestamps (records
  // declared `liveness`) waits until settingsLivenessMs after the previous settings record; any
  // other change saves within settingsSaveDelayMs. Each is a hidden setting, read when its window
  // starts, so a written value applies from the next save. Layout 2 settings: every settings field
  // except production, which has its own key.
  const splitSettingsFields = settingsFields.filter(
    (field) => !(productionSettingsFields as readonly string[]).includes(field));
  let settingsTimer: number | undefined;
  let historyTimer: number | undefined;
  let historyDirty = false;
  let livenessTimer: number | undefined;
  // The last settings record: JSON per field, the same with timestamps
  // blanked for liveness fields, and the time the writer saved it.
  let savedFields: Map<string, string> | undefined;
  let savedLiveness = new Map<string, string | undefined>();
  let savedAt = 0;
  let savedMarket: unknown[] | undefined;
  function write(key: string, value: unknown): void {
    // KeyValueStorage.set copies or serializes before it returns, so the
    // snapshot can share arrays with live state.
    if (storage.set(key, value)) saved(documentOf.get(key)!);
  }
  function writeJson(key: string, json: string): void {
    if (storage.setSerialized ? storage.setSerialized(key, json) : storage.set(key, JSON.parse(json))) saved(documentOf.get(key)!);
  }
  function market(): void {
    // The market refresh (items/coordinator/market.ts) replaces these values and never edits the
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
        withoutLiveness(state[field]) !== savedLiveness.get(field)) return "changed";
      liveness = true;
    }
    return liveness ? "liveness" : "same";
  }
  function saveSettings(fields: Map<string, string>, json: string): void {
    writeJson(stateKeys.settings, json);
    savedFields = fields;
    savedLiveness = new Map([...livenessFields].map((field) =>
      [field, withoutLiveness(state[field])]));
    savedAt = Date.now();
    timers.clearTimeout(livenessTimer);
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
    timers.clearTimeout(settingsTimer);
    settingsTimer = undefined;
    write(stateKeys.selections, selectSnapshot(state, selectionFields));
    market();
    write(stateKeys.production, { production: state.production });
    const fields = fieldJson(splitSettingsFields, state);
    fields.set(settingsLayout.field, String(settingsLayout.split));
    const change = settingsChange(fields);
    if (change === "same") {
      timers.clearTimeout(livenessTimer);
      livenessTimer = undefined;
      return;
    }
    const livenessMs = hiddenValue("settingsLivenessMs");
    if (change === "liveness" && Date.now() - savedAt < livenessMs) {
      livenessTimer ??= timers.setTimeout(() => { livenessTimer = undefined; settings(); },
        savedAt + livenessMs - Date.now());
      return;
    }
    saveSettings(fields, documentJson(fields));
  }
  /**
   * The v1.4.0 layout: every field in the settings document, plus the marker.
   * A v1.4.0 build started after this save reads every field.
   */
  function rollbackSettings(): void {
    timers.clearTimeout(settingsTimer);
    settingsTimer = undefined;
    write(stateKeys.selections, selectSnapshot(state, selectionFields));
    market();
    write(stateKeys.production, { production: state.production });
    const legacy = fieldJson([...settingsFields, ...Object.keys(marketSnapshot(state.aldata))],
      settingsSnapshot(state, settingsFields));
    legacy.set(settingsLayout.field, String(settingsLayout.split));
    const fields = fieldJson(splitSettingsFields, state);
    fields.set(settingsLayout.field, String(settingsLayout.split));
    saveSettings(fields, documentJson(legacy));
  }
  function historyNow(): void {
    timers.clearTimeout(historyTimer);
    historyTimer = undefined;
    historyDirty = true;
    const kept = hiddenValue("historyKept");
    write(stateKeys.history, historySnapshot(state.merchantActivity, state.combatLogs, state.settingsChanges, kept));
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
    const historySaveMs = hiddenValue("historySaveMs");
    historyTimer = timers.setTimeout(savePendingHistory, historySaveMs);
  }
  function aldata(): void {
    write(stateKeys.aldata, authSnapshot(state.aldata));
  }
  function scheduleSettings(): void {
    if (settingsTimer) return;
    const saveDelayMs = hiddenValue("settingsSaveDelayMs");
    settingsTimer = timers.setTimeout(settings, saveDelayMs);
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
