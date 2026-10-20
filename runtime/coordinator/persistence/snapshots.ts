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
  /** Settings layout 2: Achievement Hunt state, top level and per farming profile. */
  achievement: "party_dashboard_achievement_state_v1",
} as const;

/**
 * A settings document carrying this marker gets its market, production and
 * Achievement Hunt fields from their own keys. Without it, the settings document is the only
 * source: a v1.4.0 journal, or settings rewritten by a v1.4.0 build.
 */
export const settingsLayout = { field: "persistenceLayout", split: 2 } as const;

export const rosterFields = [
  "characterSnapshots",
  "characterAppearances",
  "headlessSlots",
  "nativeOwner",
  "steamMembers",
  "steamSwitch",
] as const;
export const bankFields = [
  "bankSnapshot",
  "withdrawals",
  "bankbois",
  "bankboiQueue",
  "bankboiTransaction",
  "bankboiReservedMigrated",
] as const;
export const selectionFields = [
  "marked",
  "merchantMarked",
  "autoItemMarks",
  "autoUpgradeMarks",
  "monsterFocus",
  "monsterFocusByCharacter",
  "monsterPrioritiesByCharacter",
  "monsterSearchRadiusByCharacter",
] as const;

export const settingsFields = [
  "mailbox",
  "dailyDungeons",
  "merchantRules", "production", "upgradeOfferingRules", "upgradePreviewResults",
  "bankboiPrefix", "anniversaryAutoChat",
  "farmingProfiles",
  "combatRecovery",
  "combatDeathSeen",
  "combatResetByCharacter",
  "groupedCombatResetAt",
  "combatHuntBoundary",
  "huntEventTrips",
  "combatEventHandoff",
  "passiveRareHunts",
  "passiveHunting",
  "phoenixRouteOrder",
  "phoenixPatrolActive",
  "phoenixPatrolCheckpoint",
  "rareHuntReturn",
  "rareRetryEvidence",
  "rarePursuitProgress",
  "escape",
  "threshold",
  "itemCollectionThreshold", "buyUpgradeBatchSize",
  "merchantDeliveries",
  "standListings",
  "npcSaleMarks",
  "deconstructionMarks",
  "autoDeconstruction",
  "autoNpcSales",
  "autoStandMarks",
  "merchantRoutinePriorities",
  "giveawayAttempts",
  "merchantAutomations",
  "standBids",
  "nativeStand",
  "autoStandBuys",
  "autoBlacklistMerchants",
  "standPriceHistory",
  "merchantBlacklist",
  "marketIgnoredItems",
  "upgrades",
  "statScrolls",
  "purchases",
  "compounds",
  "autoCompounds",
  "autoExchanges",
  "goldTargets",
  "location",
  "leader",
  "followers",
  "eventsByCharacter",
  "eventSelectionsByCharacter", "eventPrioritiesByCharacter", "eventLimitsByCharacter", "eventAttendance",
  "eventSessions",
  "eventReturn",
  "deferredEventReturns",
  "abtestingStrategy",
  "anniversary",
  "farmingPolicy",
  "monsterHunt",
  "farmAreaState",
  "huntBlacklist",
  "huntSettings",
  "huntFailures",
  "achievementHunt",
  "achievementBlacklist",
  "achievementTarget",
  "achievementPassive",
  "characterLocations",
  "navigationIntents",
  "townCycle",
  "returnProgress",
  "restockPolicies",
  "merchantCharacter",
  "merchantRealmRequests",
  "merchantForceStand",
  "merchantStandLocation",
  "merchantWeapon",
  "luckyUpgradeSlots",
  "luckySlotLocks",
  "luckySlotResume",
  "luckySlotTracking",
  "luckySlotCharacterIds",
  "merchantQueue",
  "merchantCurrent",
  "merchantCargo",
  "bankSortMode", "bankSortRequest",
  "gatheringModes",
  "gatheringNoTool",
  "gatheringCooldowns",
  "mluckCastAt",
  "activeRealm",
  "activeConvoy",
  "convoyCompletionReceipts",
  "navigationEpoch",
] as const;

const marketFields = [
  "marketListings",
  "marketBuyOrders",
  "trades",
  "merchantsUpdatedAt",
  "tradesUpdatedAt",
] as const;
const authFields = ["key", "auth", "authCheckedAt", "publishedAt"] as const;

/** Selectors preserve the domain's types while excluding timers, processes, and transient state. */
export function selectSnapshot<T, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const snapshot = {} as Pick<T, K>;
  for (const key of keys) snapshot[key] = source[key];
  return snapshot;
}

type SettingsInput = Record<(typeof settingsFields)[number], unknown> & {
  aldata: Record<(typeof marketFields)[number], unknown>;
};

export function settingsSnapshot<T extends SettingsInput>(state: T) {
  return {
    ...selectSnapshot(state, settingsFields),
    aldataMarketListings: state.aldata.marketListings,
    aldataMarketBuyOrders: state.aldata.marketBuyOrders,
    aldataTrades: state.aldata.trades,
    aldataMerchantsUpdatedAt: state.aldata.merchantsUpdatedAt,
    aldataTradesUpdatedAt: state.aldata.tradesUpdatedAt,
  };
}

/** Settings fields that layout 2 saves under their own key. */
export const marketSettingsFields = [
  "aldataMarketListings", "aldataMarketBuyOrders", "aldataTrades",
  "aldataMerchantsUpdatedAt", "aldataTradesUpdatedAt",
] as const;
export const productionSettingsFields = ["production"] as const;

export function marketSnapshot(aldata: SettingsInput["aldata"]) {
  return {
    aldataMarketListings: aldata.marketListings,
    aldataMarketBuyOrders: aldata.marketBuyOrders,
    aldataTrades: aldata.trades,
    aldataMerchantsUpdatedAt: aldata.merchantsUpdatedAt,
    aldataTradesUpdatedAt: aldata.tradesUpdatedAt,
  };
}

/** Achievement Hunt settings fields that layout 2 saves under `stateKeys.achievement`. */
export const achievementSettingsFields = [
  "achievementHunt", "achievementBlacklist", "achievementTarget", "achievementPassive",
] as const;
/** The Achievement Hunt fields of each farming profile (hunt/scopes.ts), the status message included. */
export const achievementProfileFields = [...achievementSettingsFields, "achievementMessage"] as const;

/** Layout 2 settings: every settings field except the market cache, production and Achievement Hunt. */
export const splitSettingsFields = settingsFields.filter(
  (field) => !(productionSettingsFields as readonly string[]).includes(field) &&
    !(achievementSettingsFields as readonly string[]).includes(field));

type Profiles = Record<string, Record<string, unknown> | null | undefined>;
const objectValue = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The Achievement Hunt document: the top-level fields and each profile's fields, by reference. */
export function achievementSnapshot(state: Record<string, unknown>) {
  const profiles: Record<string, Record<string, unknown>> = {};
  const saved = objectValue(state.farmingProfiles) ? (state.farmingProfiles as Profiles) : {};
  for (const [name, profile] of Object.entries(saved))
    if (profile) profiles[name] = pickPresent(profile, achievementProfileFields);
  return { ...selectSnapshot(state, achievementSettingsFields), profiles };
}

/** Shallow copies of the farming profiles without their Achievement Hunt fields. */
export function profilesWithoutAchievement(profiles: unknown): unknown {
  if (!objectValue(profiles)) return profiles;
  const result: Profiles = {};
  for (const [name, profile] of Object.entries(profiles as Profiles)) {
    if (!objectValue(profile)) { result[name] = profile; continue; }
    const copy = { ...profile };
    for (const field of achievementProfileFields) delete copy[field];
    result[name] = copy;
  }
  return result;
}

/**
 * Puts a saved Achievement Hunt document back into layout 2 settings. Saved
 * profiles merge only into profiles settings already has: profile() in
 * hunt/scopes.ts builds a new profile from the character's focus and location.
 */
export function joinAchievementState(settings: Record<string, unknown>, saved: unknown): void {
  if (!objectValue(saved)) return;
  for (const field of achievementSettingsFields)
    if (Object.hasOwn(saved, field)) settings[field] = saved[field];
  const profiles = settings.farmingProfiles;
  if (!objectValue(saved.profiles) || !objectValue(profiles)) return;
  for (const [name, fields] of Object.entries(saved.profiles)) {
    const profile = (profiles as Profiles)[name];
    if (objectValue(profile) && objectValue(fields)) Object.assign(profile, fields);
  }
}

function pickPresent(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) if (Object.hasOwn(source, key)) result[key] = source[key];
  return result;
}

/**
 * Settings fields whose frequent changes are liveness timestamps. A save whose
 * only changes are those values waits for `SETTINGS_LIVENESS_MS` (writer.ts).
 */
export const livenessFields = new Set<string>([
  "eventAttendance", "eventSessions", "farmingProfiles", "farmAreaState", "standPriceHistory",
]);
const livenessKeys = new Set(["lastLiveAt", "lastObservedAt", "elapsedMs", "authorizedAt", "seenAt"]);

/**
 * JSON of a liveness field with its timestamps blanked. `quiet` keeps its area
 * keys and drops their times. `seen` is the 15 s hit filter in
 * scripts/farm-area-control.cjs and drops out.
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

/** History is intentionally capped independently for each character. */
export function historySnapshot<A, C>(
  activity: readonly A[],
  combat: Readonly<Record<string, readonly C[]>>,
) {
  return {
    merchantActivity: activity.slice(-500),
    combatLogs: Object.fromEntries(
      Object.entries(combat).map(([name, entries]) => [name, entries.slice(-500)]),
    ),
  };
}
