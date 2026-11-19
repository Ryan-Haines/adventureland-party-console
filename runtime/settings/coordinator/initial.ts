import { initialMailbox } from "../../items/api.ts";
import type { DeconstructionMark, DeconstructionRules, DeconstructionCatalog } from "../../items/coordinator/api.ts";
import type { StandMark } from "../../items/coordinator/api.ts";
import type { Item } from "../../coordinator/contracts/item.ts";
import type { createAutomaticSaleRoutes } from "../../items/coordinator/api.ts";
import { autoUpgradeEnabled, defaultMerchantAutomations, defaultMerchantRoutinePriorities, migrateExchangeAutomations, migrateRoutinePriorities, validStandLocation, type MerchantStandLocation } from "../../merchant-jobs/api.ts";
import { pruneLuckCasts } from "../../merchant-jobs/coordinator/api.ts";
import type { AddonKindRow, MerchantWork, recoverMerchantQueue } from "../../merchant-jobs/api.ts";
import type { RealmRequest } from "../../merchant-realm/api.ts";
import type { LuckySlotHistory } from "../../items/api.ts";
import type { createMerchantItemCommands } from "../../items/coordinator/api.ts";
import { initialBankSort, initialBankState, initialCollectionState, initialItemIntents, type BankSortState } from "../../items/coordinator/api.ts";
// The settings owner's part of the start state: the core state's
// initializers, the state factory and the start's read of the saved snapshots. Each initializer's saved
// value or default comes from `declared()`, and the hidden settings come in one pass (`hiddenSettings`);
// The items owner's and the status owner's initializers stay in their own files.
import type { SavedEventSelections } from "../../events/saved-fields.ts";
import type { SavedFarmingSelections } from "../../hunting/saved-fields.ts";
import type { SavedTaskSelections } from "../../tasks/coordinator/saved-fields.ts";
import type { SavedMovementLocations } from "../../movement/saved-fields.ts";
import type { SavedEventState, LastEventReturn } from "../../events/api.ts";
import type { SavedSurvivalRecords } from "../../characters/survival/saved-fields.ts";
import type { SavedTargetingFields } from "../../characters/targeting/saved-fields.ts";
import type { Catalog } from "../../hunting/api.ts";
import { declared, hiddenSettings, topSettings, type SavedFields } from "./table.ts";
import type { MerchantCommand } from "../../merchant-jobs/api.ts";
import { restoredConvoy, type SavedCommands } from "../../movement/api/coordinator.ts";
import { loadFarmingRecord } from "../../hunting/coordinator/api.ts";
import { initialCoordinatorHistory } from "../../status/coordinator/api.ts";
import { initialSteamRoster } from "../../lifecycle/coordinator/api.ts";
import { initialAnniversaryState } from '../../events/coordinator/api.ts';
import { initialALDataState } from "../../items/coordinator/api.ts";
import type { loadCoordinatorBankVaults } from "../../items/coordinator/api.ts";
import type { ResourceBlock } from "../../merchant-jobs/api.ts";
import { savedManual } from "../../tasks/api.ts";
import { initialStandBids } from "../../items/coordinator/api.ts";
import { readInitialCoordinatorSnapshots } from "./persistence/initial-snapshots.ts";
import { initialHeadlessSlots } from "../../lifecycle/coordinator/api.ts";

/** The command state at the start: command ids start from wall-clock time, since character
 *  runtimes survive host reloads; movement restores the saved walk. */
export function initialCommandState(saved: SavedCommands, now: () => number) {
  return {
    convoyCompletionReceipts: declared("convoyCompletionReceipts", saved.convoyCompletionReceipts),
    returnProgress: declared("returnProgress", saved.returnProgress),
    commands: {} as Record<string, MerchantCommand | undefined>,
    activeConvoy: restoredConvoy(saved, now),
    navigationEpoch: Math.max(Number(saved.navigationEpoch) || 0, now()),
    nextCommandId: now(),
    thresholdRunActive: false,
    bankCycleMembers: {},
    bankQueue: [],
    bankCurrent: null,
    bankStartedAt: 0,
  };
}

export function initialRecoveryState(saved: SavedSurvivalRecords & SavedTargetingFields) {
  return {
    escape: declared("escape", saved.escape),
    combatRecovery: declared("combatRecovery", saved.combatRecovery),
    combatDeathSeen: declared("combatDeathSeen", saved.combatDeathSeen),
    combatResetByCharacter: declared("combatResetByCharacter", saved.combatResetByCharacter),
    groupedCombatResetAt: declared("groupedCombatResetAt", saved.groupedCombatResetAt),
  };
}
export function initialPartySelection(saved: Pick<SavedFarmingSelections, "location"> & SavedTaskSelections & SavedEventSelections) {
  return {
    location: declared("location", saved.location),
    leader: declared("leader", saved.leader),
    followers: declared("followers", saved.followers),
    eventsByCharacter: declared("eventsByCharacter", saved.eventsByCharacter),
    eventLimitsByCharacter: declared("eventLimitsByCharacter", saved.eventLimitsByCharacter),
    eventPrioritiesByCharacter: declared("eventPrioritiesByCharacter", saved.eventPrioritiesByCharacter),
    eventSelectionsByCharacter: declared("eventSelectionsByCharacter", saved.eventSelectionsByCharacter),
    // Manual or Pause per character, with its switches.
    handControlByCharacter: declared("handControlByCharacter", saved.handControlByCharacter),
  };
}
// A save holds the event boundary as `combatEventHandoff` (the same {startedAt, endedAt?} shape), so
// a boundary open across the upgrade still retires its pre-event targets.
export function initialEventState(saved: SavedEventState & { combatEventHandoff?: SavedEventState['eventBoundary'] }, configuredRealm: string) {
  return {
    activeRealm: declared("activeRealm", saved.activeRealm as string | undefined) ?? configuredRealm,
    realmSwitch: null,
    eventReturn: declared("eventReturn", saved.eventReturn),
    eventReturnLast: null as LastEventReturn,
    eventAttendance: declared("eventAttendance", saved.eventAttendance),
    eventSessions: declared("eventSessions", saved.eventSessions),
    deferredEventReturns: declared("deferredEventReturns", saved.deferredEventReturns),
    huntEventTrips: declared("huntEventTrips", saved.huntEventTrips),
    eventBoundary: declared("eventBoundary", saved.eventBoundary ?? saved.combatEventHandoff),
    abtestingStrategy: declared("abtestingStrategy", saved.abtestingStrategy),
  };
}
export function initialMarketObservations() {
  return {
    standSearch: { status: "idle", itemId: null, listings: [], error: null },
    standListingCache: [],
    ponty: { listings: [], updatedAt: 0, error: null },
  };
}
export function initialCatalogs() {
  return {
    travelPlaces: null,
    monsterChoices: null as Catalog | null,
    bestiaryCatalog: null,
    skillCatalog: null,
    appearanceChoices: null,
    merchantCatalog: null,
    merchantCatalogVersion: null,
  };
}

// The initializers' own saved types, and every other declared field's type from its declared
// default.
type InitializerSettings = Parameters<typeof initialRecoveryState>[0] &
  SavedMovementLocations &
  Parameters<typeof initialPartySelection>[0] &
  Parameters<typeof initialEventState>[0] &
  Parameters<typeof initialCollectionState>[0] &
  Parameters<typeof initialMerchantSales>[0] &
  Parameters<typeof initialItemIntents>[0] &
  Parameters<typeof initialCommandState>[0] &
  Parameters<typeof loadFarmingRecord>[0] &
  Parameters<typeof initialMerchantRuntime>[0] &
  Parameters<typeof initialGatheringState>[0] &
  Parameters<typeof initialCoordinatorHistory>[1] &
  Parameters<typeof initialALDataState>[1] & {
    anniversary?: Parameters<typeof initialAnniversaryState>[0];
  };
type Settings = Record<string, unknown> & InitializerSettings & Omit<SavedFields, keyof InitializerSettings>;
interface InitialStateInput {
  persistedSettings: Settings;
  persistedSelections: Parameters<typeof initialCollectionState>[1] &
    Parameters<typeof loadFarmingRecord>[1];
  persistedHistory: Parameters<typeof initialCoordinatorHistory>[0] & { settingsChanges?: unknown };
  persistedBankState: Parameters<typeof initialBankState>[0];
  persistedRoster: Parameters<typeof initialSteamRoster>[0];
  persistedALData: Parameters<typeof initialALDataState>[0];
  initialHeadless: (string | null)[];
  configuredRealm: string;
}
interface InitialStatePorts<Merchant extends string | null = string> {
  now: () => number;
  loadBankVaultDefinitions: () => ReturnType<typeof loadCoordinatorBankVaults>;
  merchantDefault?: Merchant;
}

/** Compose startup state in legacy evaluation order; runtime services reconcile it afterward. */
export function createInitialCoordinatorState<Merchant extends string | null = string>(
  input: InitialStateInput,
  ports: InitialStatePorts<Merchant>,
) {
  const {
    persistedSettings,
    persistedSelections,
    persistedHistory,
    persistedBankState,
    persistedRoster,
    persistedALData,
    initialHeadless,
    configuredRealm,
  } = input;
  return {
    // Every setting at the top of the settings document; the initializers below replace the
    // entries whose saved value they convert.
    ...topSettings(persistedSettings),
    gameVersion: 0,
    dailyDungeons: declared("dailyDungeons", persistedSettings.dailyDungeons as import("../../hunting/api.ts").DungeonState | undefined),
    // Table K's app keys (the status owner's apps.ts `AppRecord`), a settings-document record;
    // the status owner publishes no door for its type, so application.ts hands the party to
    // createApps as its state.
    appKeys: declared("appKeys", (persistedSettings as { appKeys?: unknown }).appKeys),
    ...sharedSettings(persistedSettings),
    clientUpdate: null as import("../../lifecycle/api.ts").ClientUpdateStatus | null,
    ...initialRecoveryState(persistedSettings),
    ...initialCollectionState(persistedSettings, persistedSelections, { declared }),
    merchantDeliveries: declared("merchantDeliveries", persistedSettings.merchantDeliveries),
    addonItemFates: declared("addonItemFates", persistedSettings.addonItemFates),
    ...initialMerchantSales(persistedSettings, ports.now),
    merchantJobBlocks: {} as Record<string, ResourceBlock>,
    standBids: initialStandBids(persistedSettings),
    nativeStand: declared("nativeStand", persistedSettings.nativeStand),
    standPriceHistory: declared("standPriceHistory", persistedSettings.standPriceHistory),
    merchantBlacklist: declared("merchantBlacklist", persistedSettings.merchantBlacklist),
    // The add-on character and party stores by store key (runtime/hooks/store.ts), which outlive a
    // client reload. A save from before the per-key model migrates when the intake attaches it.
    addonStores: declared("addonStores", persistedSettings.addonStores as import("../../hooks/store.ts").StoreBook | undefined),
    // Each target mode add-on's store for the leader's scope; farmingScopes keeps one per
    // farming profile (runtime/tasks/coordinator/groups.ts).
    addonFarming: {} as Record<string, Record<string, unknown>>,
    // The settings writer's records (runtime/settings/coordinator/writer.ts): when each setting
    // last changed, and the audit lines, which the history document saves.
    settingsChangedAt: declared("settingsChangedAt", persistedSettings.settingsChangedAt as Record<string, number> | undefined),
    settingsChanges: declared("settingsChanges", persistedHistory.settingsChanges as import("./writer.ts").SettingsLine[] | undefined),
    // Every hidden setting, from the persistence windows (declarations.ts) to each owner's hidden
    // picks, in one pass over the declarations.
    ...hiddenSettings(persistedSettings),
    ...initialItemIntents(persistedSettings, { declared }),
    ...initialCommandState(persistedSettings, ports.now),
    ...initialPartySelection(persistedSettings),
    ...loadFarmingRecord(persistedSettings, persistedSelections, ports.now),
    characterLocations: declared("characterLocations", persistedSettings.characterLocations),
    navigationIntents: declared("navigationIntents", persistedSettings.navigationIntents),
    ...initialMerchantRuntime<Merchant>(persistedSettings, ports.merchantDefault),
    ...initialCoordinatorHistory(persistedHistory, persistedSettings),
    ...initialMarketObservations(),
    ...initialGatheringState(persistedSettings, ports.now),
    ...initialBankState(persistedBankState, ports.loadBankVaultDefinitions, { declared }),
    ...initialCatalogs(),
    headlessSlots: initialHeadless,
    ...initialSteamRoster(persistedRoster),
    ...initialEventState(persistedSettings, configuredRealm),
    anniversary: initialAnniversaryState(persistedSettings.anniversary),
    townCycle: declared("townCycle", persistedSettings.townCycle),
    // The player's own trips; the task owner asks them again.
    manualTasks: savedManual(persistedSettings.manualTasks),
    merchantCapacityBlocked: false,
    transferSignatures: {} as Record<string, string>,
    aldata: initialALDataState(persistedALData, persistedSettings),
  };
}

function sharedSettings(settings: Record<string, unknown>) {
  return { production: declared("production", settings.production as import("../../items/coordinator/api.ts").ProductionState | undefined) };
}

type InitialInput = Parameters<typeof createInitialCoordinatorState>[0];
type SavedInput = Omit<InitialInput, "initialHeadless" | "configuredRealm">;
type InitializationPorts<Merchant extends string | null> = Parameters<
  typeof createInitialCoordinatorState<Merchant>
>[1] & {
  // The coordinator's logger, which the snapshot read warns through.
  log: { warn(details: { error: unknown }, message: string): void };
};

/** Read legacy snapshots before selecting slots and constructing state in its established evaluation order. */
export function initializeCoordinatorState<Merchant extends string | null = string>(
  storage: Parameters<typeof readInitialCoordinatorSnapshots>[0],
  workers: Parameters<typeof initialHeadlessSlots>[1],
  configuredRealm: string,
  ports: InitializationPorts<Merchant>,
) {
  // The legacy persistence boundary accepts arbitrary JSON. Domain initializers retain
  // their existing coercion/failure behavior; do not sanitize or clone snapshots here.
  const saved = readInitialCoordinatorSnapshots(storage, (details, message) => ports.log.warn(details, message)) as SavedInput;
  const initialHeadless = initialHeadlessSlots(saved.persistedRoster, workers);
  const party = createInitialCoordinatorState<Merchant>(
    { ...saved, initialHeadless, configuredRealm },
    ports,
  );
  return { party, persistedSettings: saved.persistedSettings };
}

// The merchant's saved state at the start: the start's composition reads each declared field that is
// not a hidden setting with one `declared()` line, as the settings owner's RA moved the other
// initializers here.
interface SavedListing extends Partial<StandMark> {
  [key: string]: unknown;
  item: Item;
  price: number;
  quantity: number;
  id?: string;
  state?: string;
  queuedAt?: number;
}
interface SavedMerchantSettings {
  mailbox?:unknown;
  upgradePreviewResults?: Record<string, import("../../items/coordinator/api.ts").StoredUpgradePreview>;
  giveawayAttempts?: Record<string, number>;
  deconstructionMarks?: DeconstructionMark[];
  autoDeconstruction?: DeconstructionRules;
  standListings?: SavedListing[];
  // Each reader takes the marks as its own shape (items/coordinator storage.ts, market.ts), as
  // v1.5.0's `Array.isArray` load gave them.
  npcSaleMarks?: any[];
  autoNpcSales?: Parameters<typeof createAutomaticSaleRoutes>[0]["autoNpcSales"];
  autoStandMarks?: Parameters<typeof createAutomaticSaleRoutes>[0]["autoStandMarks"];
  merchantRoutinePriorities?: Record<string, number>;
  merchantAutomations?: Record<string, boolean>;
}

/** Fill legacy listing metadata while retaining saved automation overrides, including false and zero. */
export function initialMerchantSales(settings: SavedMerchantSettings, now: () => number) {
  return {
    mailbox: initialMailbox(settings.mailbox),
    upgradePreviewResults: declared("upgradePreviewResults", settings.upgradePreviewResults),
    giveawayAttempts: declared("giveawayAttempts", settings.giveawayAttempts),
    standListings: declared("standListings", settings.standListings).map((entry, index) => ({
      ...entry,
      id: entry.id || `stand-migrated-${now()}-${index}`,
      state: entry.state || "configured",
      queuedAt: entry.queuedAt || now() + index,
    })),
    deconstructionMarks: declared("deconstructionMarks", settings.deconstructionMarks),
    autoDeconstruction: declared("autoDeconstruction", settings.autoDeconstruction),
    deconstructionCatalog: {} as DeconstructionCatalog,
    merchantWeaponTypes: [] as string[],
    npcSaleMarks: declared("npcSaleMarks", settings.npcSaleMarks),
    // The keep floor reads a missing or broken keep as 0.
    autoNpcSales: Object.fromEntries(Object.entries(declared("autoNpcSales", settings.autoNpcSales)).map(([key, rule]) =>
      [key, { ...rule, keep: Number.isSafeInteger(rule.keep) && Number(rule.keep) >= 0 ? rule.keep! : 0 }])),
    autoStandMarks: declared("autoStandMarks", settings.autoStandMarks),
    merchantRoutinePriorities: {
      ...defaultMerchantRoutinePriorities(),
      ...migrateRoutinePriorities(settings.merchantRoutinePriorities),
    },
    merchantAutomations: { ...defaultMerchantAutomations(), "auto upgrade": autoUpgradeEnabled(settings.merchantAutomations), ...migrateExchangeAutomations(settings.merchantAutomations) },
  };
}
interface SavedGathering {
  gatheringModes?: string[] | null;
  gatheringMode?: string | null;
  gatheringNoTool?: Record<string, boolean> | null;
  gatheringCooldowns?: Record<string, number | undefined> | null;
  mluckCastAt?: Record<string, number> | null;
}

/** Saved multi-mode choices, including an empty array, take precedence over legacy single-mode selection. */
export function initialGatheringState(saved: SavedGathering, now: () => number = Date.now) {
  // A copy, so the prune leaves the saved settings as they were.
  const mluckCastAt = { ...declared("mluckCastAt", saved.mluckCastAt) };
  pruneLuckCasts(mluckCastAt, now());
  return {
    // A save before the multi-mode list kept one `gatheringMode`; a saved list, even an empty one,
    // comes first.
    gatheringModes: declared("gatheringModes", saved.gatheringModes, saved.gatheringMode ? [saved.gatheringMode] : undefined),
    gatheringNoTool: declared("gatheringNoTool", saved.gatheringNoTool),
    gatheringCooldowns: declared("gatheringCooldowns", saved.gatheringCooldowns),
    mluckCastAt,
  };
}

interface SavedMerchant extends Partial<BankSortState> {
  luckyUpgradeSlots?: Record<string, number | null>;
  luckySlotTracking?: LuckySlotHistory;
  luckySlotCharacterIds?: Record<string, string>;
  luckySlotLocks?: Record<string, number | null>;
  luckySlotResume?: Record<string, {slot: number; rolls: number}>;
  merchantCharacter?: string | null;
  merchantRealmRequests?: Record<string, RealmRequest | undefined>;
  merchantRealmBlacklist?: string[];
  merchantStandLocation?: MerchantStandLocation;
  merchantWeapon?: Parameters<typeof createMerchantItemCommands>[0]["merchantWeapon"];
  merchantQueue?: MerchantWork[] | null;
  merchantCurrent?: MerchantWork | null;
  merchantCargo?: Parameters<typeof recoverMerchantQueue>[0]["merchantCargo"] | null;
  merchantAddonKinds?: AddonKindRow[];
}

export function initialMerchantRuntime<DefaultMerchant extends string | null = string>(
  saved: SavedMerchant,
  defaultMerchant?: DefaultMerchant,
) {
  const merchantCharacter: string | DefaultMerchant =
    saved.merchantCharacter || (defaultMerchant ?? null) as DefaultMerchant;
  // A copy, so the retirement below leaves the saved settings as they were.
  const luckyUpgradeSlots = { ...declared("luckyUpgradeSlots", saved.luckyUpgradeSlots) };
  // Older builds persisted this hardcoded default without verification.
  // Retire it so that installing discovery enables the slot search.
  if (luckyUpgradeSlots.GoldMajesty === 7) delete luckyUpgradeSlots.GoldMajesty;
  return {
    ...initialBankSort(saved),
    merchantCharacter,
    merchantRealmRequests: declared("merchantRealmRequests", saved.merchantRealmRequests),
    luckyUpgradeSlots,
    luckySlotLocks: declared("luckySlotLocks", saved.luckySlotLocks),
    luckySlotResume: declared("luckySlotResume", saved.luckySlotResume),
    luckySlotTracking: declared("luckySlotTracking", saved.luckySlotTracking),
    luckySlotCharacterIds: declared("luckySlotCharacterIds", saved.luckySlotCharacterIds),
    // The blacklist, saved or its declared empty default.
    merchantRealmBlacklist: declared("merchantRealmBlacklist", saved.merchantRealmBlacklist) as string[],
    merchantStandLocation: validStandLocation(saved.merchantStandLocation) ? {...saved.merchantStandLocation} : null,
    merchantWeapon: declared("merchantWeapon", saved.merchantWeapon),
    merchantQueue: declared("merchantQueue", saved.merchantQueue),
    merchantCurrent: declared("merchantCurrent", saved.merchantCurrent),
    merchantCargo: declared("merchantCargo", saved.merchantCargo),
    merchantAddonKinds: declared("merchantAddonKinds", saved.merchantAddonKinds),
  };
}


