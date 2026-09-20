export interface HuntSettings {
  relocateIfCompeting: boolean;
  blacklistDeaths: boolean;
  deathThreshold: number;
  blacklistExpirations: boolean;
  expirationThreshold: number;
}
export const defaultHuntSettings: HuntSettings = {
  relocateIfCompeting: true,
  blacklistDeaths: true,
  deathThreshold: 1,
  blacklistExpirations: true,
  expirationThreshold: 1,
};
export interface HuntFailures {
  deaths: number;
  expirations: number;
}
export interface HuntFailureState {
  huntSettings?: HuntSettings;
  huntFailures?: Record<string, HuntFailures>;
  huntBlacklist?: Record<
    string,
    { monsterId: string; at: number; deaths: number; expirations?: number; reason?: string }
  > | null;
}
export function validHuntSettings(value: unknown): value is Partial<HuntSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, item]) => {
    if (["relocateIfCompeting", "blacklistDeaths", "blacklistExpirations"].includes(key))
      return typeof item === "boolean";
    return (
      ["deathThreshold", "expirationThreshold"].includes(key) &&
      Number.isSafeInteger(item) &&
      Number(item) >= 1
    );
  });
}
export function huntSettings(state: HuntFailureState): HuntSettings {
  return { ...defaultHuntSettings, ...state.huntSettings };
}
export function migrateHuntFailures(state: HuntFailureState): Record<string, HuntFailures> {
  const counts = (state.huntFailures ||= {});
  for (const [id, entry] of Object.entries(state.huntBlacklist || {}))
    counts[id] ||= {
      deaths: entry.deaths || 0,
      expirations:
        entry.expirations ?? (entry.reason === "Hunt quest expired before completion" ? 1 : 0),
    };
  return counts;
}
export function applyHuntThresholds(state: HuntFailureState, now: number): void {
  const settings = huntSettings(state);
  for (const [id, counts] of Object.entries(migrateHuntFailures(state))) {
    const death = settings.blacklistDeaths && counts.deaths >= settings.deathThreshold;
    const expiry =
      settings.blacklistExpirations && counts.expirations >= settings.expirationThreshold;
    if (!death && !expiry) continue;
    const list = (state.huntBlacklist ||= {});
    list[id] ||= {
      monsterId: id,
      at: now,
      deaths: 0,
      reason: death ? "Hunt death threshold reached" : "Hunt quest expired before completion",
    };
    Object.assign(list[id]!, counts);
  }
}
export function recordHuntFailure(
  state: HuntFailureState,
  id: string,
  kind: keyof HuntFailures,
  amount: number,
  now: number,
): boolean {
  const counts = migrateHuntFailures(state);
  const entry = (counts[id] ||= { deaths: 0, expirations: 0 });
  entry[kind] += amount;
  applyHuntThresholds(state, now);
  return !!state.huntBlacklist?.[id];
}
