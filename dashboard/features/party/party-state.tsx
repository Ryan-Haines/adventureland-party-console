"use client";
import type { LuckySlotHistory } from '../../../runtime/items/api.ts';
import type { MerchantStandLocation } from '../../../runtime/merchant-jobs/api.ts';
import type { DeconstructionMark } from "../../../runtime/items/api.ts";
import type { DeconstructionCatalog } from '../../../runtime/items/api.ts';
import { ActiveSlot } from "./active-slot";
import { ALDataState } from "./aldata-state";
import { AppearanceChoice } from "./appearance-choice";
import { AutoCompoundMark } from "./auto-compound-mark";
import { AutoUpgradeMarks } from "./auto-upgrade-marks";
import { BankMark } from "./bank-mark";
import { BankSnapshot } from "./bank-snapshot";
import { BankVault } from "./bank-vault";
import { Bankboi } from "./bankboi";
import { BestiaryMonster } from "./bestiary-monster";
import { Char } from "./char";
import { CombatLogEntry } from "./combat-log-entry";
import { CompoundGroup } from "./compound-group";
import { Item } from "./item";
import { Location } from "./location";
import { MerchantActivity } from "./merchant-activity";
import { MerchantBlacklistEntry } from "./merchant-blacklist-entry";
import { MerchantCatalog } from "./merchant-catalog";
import { MerchantJob } from "./merchant-job";
import { MonsterChoice } from "./monster-choice";
import { MonsterHuntState } from "./monster-hunt-state";
import { NpcSaleMark } from "./npc-sale-mark";
import { Place } from "./place";
import { PontyState } from "./ponty-state";
import { RealmControl } from "./realm-control";
import { RestockPolicy } from "./restock-policy";
import { RosterMember } from "./roster-member";
import { SkillClass } from "./skill-class";
import { StandBid } from "./stand-bid";
import { StandListing } from "./stand-listing";
import { StandPriceHistory } from "./stand-price-history";
import { StatScrollMark } from "./stat-scroll-mark";
import type { ConsoleControlState, SteamSwitch } from "../../../runtime/lifecycle/api.ts";
import { UpgradeMark } from "./upgrade-mark";
import { Withdrawal } from "./withdrawal";

export type PartyState = {
  // Declared settings the dashboard receives (DeclaredFieldsShown below).
  goldReserve?: number;
  mailCheckSeconds?: number;
  protectedFreeSlots?: number;
  farmingPolicy?: string;
  appLocks?: string[];
  characterSnapshots?: Record<string, Char & { updatedAt: number }>;
  upgradeOfferingRules?: import("../../../runtime/items/api.ts").UpgradeOfferingRule[];
  upgradeOfferingStock?: Partial<Record<import("../../../runtime/items/api.ts").UpgradeOffering, number>>;
  characterAppearances?: Record<string, Pick<Char, "skin" | "characterSprite" | "characterDollHtml"> & {updatedAt:number;
    }>;
  // The items owner's incompatible-rule rows (items/rules.ts incompatibleRuleRows).
  incompatibleRules?: { item: Item; actions: string[] }[];
  merchantRules?:
    | import("../../../runtime/items/api.ts").SharedRules | null;
  gameVersion?: number;
  gameLogs?: Record<string, import("../../../runtime/status/api.ts").GameLog[]>;
  // The settings owner's audit lines, in the logs section.
  settingsChanges?: { at: number; field: string; character?: string; addon?: string; key?: string; old?: unknown; new?: unknown; by: string }[];
  bankboiPrefix?: string;
  anniversaryAutoChat?: boolean;
  referenceRevision?: string;
  accountId?: string | null;
  passiveHunting?: import("../../../runtime/hunting/api.ts").PassiveSettings;
  passiveRareHunts?: { tinyp: boolean; phoenix: boolean; goldenbat?: boolean; cutebee?: boolean; hen?: boolean; rooster?: boolean;
  };
  phoenixRouteOrder?: string[];
  rareHuntState?: {
    message?: string | null;
    encounter?: { id: string; mtype: string; stage: string; generator: string; message?: string;
    } | null;
    patrol?: { active: boolean; paused: boolean; index: number; total: number; stage: string; message?: string; incomplete?: string[];
      regionId?: string; waypoint?: {map: string; x: number; y: number}; readyAt?: number; retryReason?: string;
    } | null;
  };
  farmAreaState?: {
    message?: string;
    paused?: boolean;
    active?: { map: string; x: number; y: number; monsterIds?: string[] };
  };
  threshold: number;
  itemCollectionThreshold?: number;
  buyUpgradeBatchSize?: number;
  characters: Record<string, Char>;
  roster?: RosterMember[];
  activeSlots?: ActiveSlot[];
  characterConnections?: import('../../../runtime/lifecycle/api.ts').CharacterConnection[];
  classChoices?: string[];
  appearanceChoices?: Record<string, AppearanceChoice[]>;
  steamSwitch?: SteamSwitch | null;
  realmControl?: RealmControl;
  consoleControl?: ConsoleControlState | null;
  marked: Record<string, BankMark[]>;
  merchantMarked?: Record<string, BankMark[]>;
  autoItemMarks?: Record<string, Record<string, "bank" | "merchant">>;
  autoUpgradeMarks?: Record<string, AutoUpgradeMarks>;
  merchantDeliveries?: Record<string, BankMark[]>;
  standListings?: StandListing[];
  // The items owner's stand count in the core section.
  standSlots?: { slots: number; used: number; free: number };
  npcSaleMarks?: NpcSaleMark[];
  deconstructionMarks?: DeconstructionMark<Item>[];
  autoDeconstruction?: Record<string, Record<string, { item: Item }>>;
  deconstructionCatalog?: DeconstructionCatalog;
  autoNpcSales?: Record<string, { item: Item; createdAt: number; character?: string; keep?: number }>;
  autoStandMarks?: Record<string, { item: Item; price: number; createdAt: number }>;
  merchantRoutinePriorities?: Record<string, number>;
  // The bag copies an add-on's claim or action holds, by character and slot (10 part 4).
  addonItemFates?: Record<string, Record<number, import("../../../runtime/items/api.ts").Fate>>;
  // The add-on job kinds the merchant runs, each under its routine key.
  merchantAddonKinds?: import("../../../runtime/merchant-jobs/api.ts").AddonKindRow[];
  marketIgnoredItems?: import("../../../runtime/items/api.ts").MarketIgnoredItem[];
  merchantBlacklist?: Record<string, MerchantBlacklistEntry>;
  merchantAutomations?: Record<string, boolean>;
  giveawayRealms?: { key: string; label: string }[];
  giveawayPlayers?: Record<string, string[]>;
  standBids?: Record<string, StandBid>;
  autoStandBuys?: boolean;
  autoBlacklistMerchants?: boolean;
  nativeStand?: { offers: Record<string, { itemId: string; auto: boolean; phase: string; slot: string; level?: number; price?: number; quantity?: number; acknowledged?: number; problem?: string }>; problems: Record<string, string>; purchases?: Record<string, { item: { name: string; q?: number; price?: number }; quantity: number; jobId: string }> };
  standPriceHistory?: Record<string, StandPriceHistory>;
  upgrades?: Record<string, UpgradeMark[]>;
  statScrolls?: Record<string, StatScrollMark[]>;
  purchases?: Record<string, { name: string }[]>;
  compounds?: Record<string, CompoundGroup[]>;
  autoCompounds?: Record<string, AutoCompoundMark[]>;
  autoExchanges?: Record<string, { name: string; level: number }>;
  goldTargets?: Record<string, number>;
  withdrawals?: Record<string, Withdrawal[]>;
  leader?: string | null;
  followers?: Record<string, boolean>;
  eventsByCharacter?: Record<string, boolean>;
  eventAttendance?: Record<string, Record<string, Pick<import("../../../runtime/events/api.ts").AttendanceInstance, "ignored" | "ended" | "attending">>>;
  eventLimitsByCharacter?: Record<string, Record<string, import("../../../runtime/events/api.ts").EventLimits>>;
  eventPrioritiesByCharacter?: Record<string, string[]>;
  eventSelectionsByCharacter?: Record<string, string[]>;
  handControlByCharacter?: Record<string, import('./hand-control').HandControl>;
  eventSchedules?: import("./event-selection-control").EventSchedule[];
  monsterFocus?: string[] | string;
  monsterFocusByCharacter?: Record<string, string[]>;
  monsterPrioritiesByCharacter?: Record<string, Record<string, number>>;
  monsterSearchRadiusByCharacter?: Record<string, number>;
  scatterMonsterTypes?: string[];
  huntSettings?: import("../../../runtime/hunting/api.ts").HuntSettings;
  // The root relocation switch.
  relocateIfCompeting?: boolean;
  huntFailures?: Record<string, {deaths: number; expirations: number}>;
  huntBlacklist?: Record<
    string,
    { monsterId: string; at: number; deaths: number; expirations?: number; reason?: string; characters?: string[];
    }
  >;
  // Each farming scope's settings (config) and its live controller state (core).
  farmingProfiles?: Record<string, {
    combatMode?: string;
    targetMode?: string;
    huntSettings?: import("../../../runtime/hunting/api.ts").HuntSettings;
    huntBlacklist?: PartyState["huntBlacklist"];
    monsterFocus?: string[];
    location?: PartyState["partyLocation"];
  }>;
  farmingLive?: Record<string, {
    farmAreaState?: PartyState["farmAreaState"];
    monsterHunt?: MonsterHuntState | null;
  }>;
  combatMode?: string;
  targetMode?: string;
  partyFarmingMode?: "default" | "scatter";
  partyFarmingMonsterType?: string | null;
  monsterHunt?: MonsterHuntState | null;
  activeConvoy?: {
    id: string;
    phase: string;
    phaseStartedAt?: number;
    lastProgressAt?: number;
    failureCode?: string;
    failure?: string;
    blockers?: Record<string, { reason: string; expectedCommandId: number | null;
      reportedCommandId: number | null; expectedPhase: string; reportedPhase: string | null;
      }>;
  } | null;
  characterLocations?: Record<string, Location>;
  partyLocation?: Location | null;
  restockPolicies?: Record<string, RestockPolicy>;
  merchantCharacter?: string | null;
  merchantForceStand?: boolean;
  // The realms automatic merchant work skips.
  merchantRealmBlacklist?: string[];
  merchantStandLocation?: MerchantStandLocation | null;
  merchantWeapon?: { item: Item } | null;
  luckyUpgradeSlots?: Record<string, number | null>;
  luckySlotLocks?: Record<string, number | null>;
  luckySlotResume?: Record<string, {slot: number; rolls: number}>;
  luckySlotTracking?: LuckySlotHistory;
  merchantQueue?: MerchantJob[];
  // the merchant jobs owner's ready jobs in its pick's order, by id.
  merchantReady?: { id: string; reason: string; target: string; priority: number; realm: string | null }[];
  merchantCurrent?: MerchantJob | null;
  merchantActivity?: MerchantActivity[];
  combatLogs?: Record<string, CombatLogEntry[]>;
  bankSortMode?: "automatic" | "request";
  bankSortRequest?: { id: string; status: "queued" | "sorting" | "retry"; message?: string;
  } | null;
  gatheringModes?: string[];
  gatheringNoTool?: Record<string, boolean>;
  gatheringCooldowns?: { fishing?: number; mining?: number };
  mluckSchedule?: {
    target: string;
    remainingMs: number;
    leadMs: number;
    dispatchInMs: number;
    marginMs: number;
    status: string;
  } | null;
  aldata?: ALDataState;
  ponty?: PontyState;
  merchantCatalog?: MerchantCatalog;
  bank?: BankSnapshot | null;
  // The bank section's sellable copies by `ownedStockKey` (the items owner's `items.bank()` and `items.stock`).
  ownedStock?: Record<string, import('../../../runtime/status/api.ts').OwnedStock>;
  bankGold?: number | null;
  accountGold?: { carried: number | null; offline: number | null; total: number | null };
  // The last ring save (coordinator/diagnostics.ts), which lights the record icon.
  recordSaved?: import('../../../runtime/status/api.ts').RecordSaved | null;
  bankVaults?: BankVault[];
  bankbois?: Bankboi[];
  bankboiQueue?: {
    id: string;
    item: Item;
    state: string;
    bootstrap?: boolean;
  }[];
  bankboiTransaction?: { bankboi: string; phase: string; mode: string } | null;
  travelPlaces?: Place[];
  monsterChoices?: MonsterChoice[];
  bestiaryCatalog?: BestiaryMonster[];
  skillCatalog?: SkillClass[];
  anniversary?: {
    blacklist?: string[];
    slices: string[];
    labels: Record<string, string>;
    counts: Record<string, number>;
    completeSets: number;
    nativeSlice?: string | null;
    tradableNative: number;
    missing: string[];
    live?: {
      round?: number;
      target?: string;
      map?: string;
      x?: number;
      y?: number;
      expires?: number;
      next?: number;
    } | null;
    schedule?: {
      round?: number;
      target?: string;
      map?: string;
      x?: number;
      y?: number;
      expires?: number;
      next?: number;
      live?: boolean;
    } | null;
    totalSlices?: number;
    perFlavorTarget?: number;
    tradeLimits?: Record<string, number>;
    message?: string;
    advertised?: boolean;
    craftReady?: boolean;
    crafted?: number;
    chatMessage?: string;
    chatAdvertisement?: {
      id: string;
      message: string;
      queuedAt: number;
    } | null;
    eventCycle?: {
      id: string;
      startsAt: number;
      endsAt: number;
      destination?: {
        map: string;
        x: number;
        y: number;
        label?: string;
      } | null;
      participants?: string[];
      returnDispatchedAt?: number | null;
      returnReason?: string | null;
    } | null;
    activity?: { at: number; level: string; message: string }[];
    handoffTargets?: { name: string; round: string; slice: string }[];
  };
};
// The settings owner ties these fields to the saved-field declarations:
// a field declared for the `config` section that PartyState lacks fails the
// typecheck. The value types stay the dashboard's own view shapes.
type Tied<Missing extends never> = Missing;
export type DeclaredFieldsShown = Tied<Exclude<import('../../../runtime/settings/coordinator/api.ts').DeliveredField<'dashboard'>, keyof PartyState>>;
