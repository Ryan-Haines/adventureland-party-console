// What other owners, apps and add-ons import from dashboard and status:
// types only. The report and reply shapes moved here from
// runtime/coordinator/status/response-types.ts, observed-status.ts and ingestion.ts with no change to a
// field.
import type { InventoryEntry, Item } from "../coordinator/contracts/item.ts";
import type { HuntStatus } from "../hunting/api.ts";
import type { AnniversaryMerchantStatus } from "../merchant-jobs/api.ts";
import type { AnniversaryBuffStatus } from "../events/api.ts";
import type { createMerchantObservation } from "../items/coordinator/api.ts";
import type { Member } from "../coordinator/targeting/api.ts";
import type { MerchantCommand } from "../merchant-jobs/api.ts";
import type { DeliveredField } from "../settings/coordinator/api.ts";
import type { Catalog, HuntCycle } from "../hunting/api.ts";
// The status owner's saved fields, for the dashboard's polls. A reader enters through this door: fields.ts imports
// The items owner's door, whose survival chain imports this door back (survival/death.ts boundFired), so a reader
// that loads fields.ts first reads rules.ts's constants before fields.ts has run.
export { statusSavedFields } from "./fields.ts";
// The death a character last recorded (telemetry.ts `lastDeath`), which its report and targeting's
// queue report carry.
export interface DeathRecord { at: number; message: string; details: unknown; eventTrip: Record<string, unknown> | null }
// The catalog versions and table F, for the characters' report and the dashboard's field audit.
export { CATALOG_VERSIONS, catalogValue, characterFields, sectionFields, streamFields } from "./rules.ts";
// The derived stats of a report and a saved profile's inspection (the lifecycle owner's inspection route).
export { reportedStats, TABLE_G } from "./rules.ts";
// The command types that walk a character, for the tasks owner's travel route and the hunting owner's destination change.
export { navigational, writeSlot, type SlotWrite } from "./rules.ts";
export { classifyGameLog, defaultLogFilters, logFilters, showGameLog, type GameLog } from "./game-log.ts";
// A kept bound in a game window tells the status owner's bound record through its window's next report
// (character/bounds.ts). It reads no DOM, so it rides this door, which the dashboard also loads.
export { boundFired, boundsPending, boundsSent, capReached } from "./character/bounds.ts";
// Table K's caller of a request body, which the owners' command routes read for its tier and name.
export type { LeasedRing, OwnedStock, RequestCaller } from "./rules.ts";
// The metrics rules the character collector, the coordinator's service and the dashboard share.
export { METRIC_BUCKET_MS, HISTORY_KEPT_MS, METRIC_RESET_KINDS, metricOutboxOwner, metricNumber, metricText, parseMetricResets, parseMetricSample,
  parseMetricFrame, encouragementLuck, projectDirectDrop } from "./rules.ts";
import type { characterFields, METRIC_RESET_KINDS, LeasedRing, ReplySectionName, StateSection } from "./rules.ts";

/** Application sighting protocol: normalized IDs/maps and coordinator-clock time. */
export interface SlendermanSighting {
  id: string;
  map: string;
  in: string | number;
  x: number;
  y: number;
  server: string;
  observedAt: number;
}

export interface HeartbeatStatus {
  [field: string]: unknown;
  name: string;
  server?: string;
  map?: string;
  x?: number;
  y?: number;
  seenAt?: number;
  /** Hash of the compiled character artifact that sent this heartbeat. */
  codeHash?: string | null;
  combat?: { kiting?: boolean; positioning?: { movementOwner?: string | null; phase?: string } | null };
  combatStats?: { armorPiercing?: number };
  combatSelection?: Record<string, unknown>;
  eventTeam?: string;
  activeEvent?: string;
  joinedEvent?: string;
  // The one event fact (01 design 3.1), written by status ingestion once per full report
  // (application.ts `observePresence`); every reader of "is this member at an event" reads it.
  presence?: import('../events/api.ts').EventPresence | null;
  // The admission answer for the event the report names, written by the events ingest once per full report.
  eventAdmission?: import('../events/api.ts').EventAdmission | null;
  // The event the `rejoinPending` mark names for this member, written beside the admission.
  eventRejoin?: string | null;
  // The `due` leads of the member's group (events occurrences.ts), written by the events owner's ingest.
  eventLeads?: Record<string, number> | null;
  threats?: EntityReference[];
  target?: EntityReference | null;
  serverLiveEvents?: { name: string }[];
  eventSchedules?: {id:string; cipher?:{board?:{id?:string}|null;runtime?:{stock?:Record<string,number>;day?:{mixes_left?:number};journal?:{gathering?:import('../events/api.ts').CipherGatheringPlan}}}}[];
  slendermanSighting?: SlendermanSighting | null;
}
export interface EntityReference {
  id?: string;
  target?: string;
  [field: string]: unknown;
}

// The saved fields the reply carries raw are the declarations delivered to `characters`
// (runtime/settings/coordinator/table.ts).
export interface HeartbeatState extends Record<DeliveredField<'characters'>, unknown> {
  // Step 9b: each target mode add-on's store for this scope (runtime/hooks/registry.ts target.mode).
  addonFarming?: Record<string, Record<string, unknown>>;
  eventLimitsByCharacter?: import('../events/api.ts').EventFormation['eventLimitsByCharacter'];
  eventSelectionsByCharacter?: Record<string, string[]>;
  dailyDungeons?: import("../hunting/api.ts").DungeonState;
  passiveHunting: import('../hunting/api.ts').PassiveSettings;
  // The events owner's saved forms as the reply reads them (runtime/events/coordinator/attendance.ts `SavedEventState`).
  eventSessions?: Record<string, { participants?: string[] }>;
  eventReturn?: Pick<import('../events/api.ts').EventRecovery, 'participants'> &
    Partial<Pick<import('../events/api.ts').EventRecovery, 'cycleId'>> | null;
  deferredEventReturns?: Record<string, unknown>;
  merchantQueue?: import("../merchant-jobs/api.ts").MerchantWork[];
  huntEventTrips?: import("../events/api.ts").HuntEventTrips["huntEventTrips"];
  leader: string | null;
  merchantCharacter: string | null;
  merchantStandLocation: import('../merchant-jobs/api.ts').MerchantStandLocation | null;
  commands: Record<string, MerchantCommand | undefined>;
  // The shared command sequence every command id is drawn from; the Town restore draws its
  // command's id from it (the movement owner's 1.5 row 9).
  nextCommandId: number;
  statuses: Record<string, HeartbeatStatus | undefined>;
  followers: Record<string, boolean>;
  escape: { stage?: string } | null;
  // The survival owner's delivered fight reset times, which its `combat-recovery` section reads (recoveryReply).
  combatResetByCharacter: Record<string, number | undefined> | null;
  targetMode: string;
  monsterHunt: HuntCycle | null;
  monsterFocus: string[];
  monsterFocusByCharacter: Record<string, string[]>;
  monsterPrioritiesByCharacter: Record<string, Record<string, number>>;
  monsterSearchRadiusByCharacter: Record<string, number>;
  farmAreaState: { paused?: boolean } | null;
  rareHuntState?: { patrol?: { paused?: boolean } } | null;
  townCycle: { id: string; pending: string[]; revisions?: Record<string, number> } | null;
  returnProgress?: Record<string, import("../events/api.ts").ReturnProgress>;
  activeConvoy: (import('../coordinator/targeting/api.ts').HuntTravelConvoy & { participants: string[] }) | null;
  bankCurrent: { name: string } | null;
  bankQueue: { name: string }[];
  bankbois: Record<string, import("../items/coordinator/api.ts").BankboiInventory>;
  goldTargets: Record<string, number>;
  gatheringModes: string[];
  merchantAutomations?: Record<string, boolean>;
  partyFarmingMode: string;
  monsterLocationsVersion?: number;
  travelPlaces: unknown;
  monsterChoices: Catalog | null;
  monsterHunterLocation: unknown;
  bestiaryCatalog: unknown;
  skillCatalog: unknown;
  appearanceChoices: unknown;
  merchantCatalog: unknown;
  merchantCatalogVersion: unknown;
}

export interface HeartbeatResponsePorts {
  now(): number;
  persist?(): void;
  activeNames(): string[];
  enabled(name: string, event?: string): boolean;
  navigationRevision(name: string): number;
  // The hunting owner's rejected rares (`farming.focus`), which the passing control's Hunt travel reads.
  rareRejections(): import('../coordinator/targeting/api.ts').RareRejections;

  rareControl(name: string): unknown;
  convoySignal(name: string): unknown;
  partyLocation(name: string): unknown;
  navigationIntent(name: string): unknown;
  // Movement's reply fields (movement.reply, runtime/movement/coordinator/routes.ts `heartbeatMovement`).
  partyTownActive(name: string): boolean;
  // Table R's movement section, assembled by movement from its reads and the hunting owner's paused flags.
  movementSection(name: string): Record<string, unknown>;
  partyConvoyActive(name: string): boolean;
  clickWaitMs(name: string): number;
  partyTownCycleId(): string | null;
  returnProgress(name: string): unknown;
  rareEncounter(): unknown;
  huntTurnInOwnsTravel(): boolean;
  mapSubscriberCount(name: string): number;
  // Table G: the rings a diagnostics view leases from this character, which it posts after the
  // report (coordinator/diagnostics.ts).
  diagnosticsRings(name: string): readonly string[];
  // The items owner's reply fields and the merchant command's lucky slot (`items.reply`).
  items(name: string, command: { luckyUpgradeSlot?: unknown; [field: string]: unknown } | null): Record<string, unknown>;
  groupedCombat(): unknown;
  selectedEvents(state: HeartbeatState, name: string): string[];
  anniversary(): unknown;
  rareOwns(): boolean;
  // The member's assignment from its group's task owner (01 design 1.3), null before its group
  // exists.
  task(name: string): import("../tasks/api.ts").Assignment | null;
  // The settings owner's `settings.read`, for the
  // reply fields that apply a rule to a declared setting (2.4).
  setting(query: import("../settings/api.ts").SettingsRead): unknown;
}

// Each table F field (rules.ts `characterFields`) by name, so the published report and the table are
// one list and an add-on's view names every field the character sends.
export type ReportFields = { [K in keyof typeof characterFields]?: unknown };
export interface StatusReport extends ReportFields {
  name: string;
  ctype?: string;
  runtime?: string;
  steamPrimary?: boolean;
  seenAt?: number;
  lastCommandId?: number;
  // Stamped by the coordinator (coordinator/line.ts), never sent by the character.
  activity?: unknown;
}

// The report as the coordinator stores it (moved from runtime/coordinator/status/observed-status.ts).
type MerchantObservation = Parameters<ReturnType<typeof createMerchantObservation>["observe"]>[0];

/** inventoryOperationEntry emits either an occupied indexed slot or null. */
export interface ObservedInventoryEntry extends InventoryEntry {
  slot: number;
  item: Item;
}

/** Latest character heartbeat after ingestion stamps its coordinator observation time. */
export interface ObservedCharacterStatus extends HeartbeatStatus, AnniversaryMerchantStatus {
  // The report's own cadence (report.ts `reportIntervalMs`), and the lifecycle owner's reload readiness (`busy`, `busyReason`).
  reportIntervalMs?: number;
  busy?: boolean;
  busyReason?: string;
  upgradePreviewSession?: string;
  upgradePreviewRevision?: string;
  upgradeInventoryBusy?: boolean;
  seenAt: number;
  /** Full inventory receipt time; fast combat reports must not refresh it. */
  inventorySeenAt?: number;
  clientVersion?: number;
  clientInstance?: string;
  map: string;
  x: number;
  y: number;
  ctype?: string;
  gold: number;
  level: number;
  owner?: string | number | null;
  anniversaryState?: AnniversaryMerchantStatus["anniversaryState"] &
    AnniversaryBuffStatus["anniversaryState"] &
    MerchantObservation["anniversaryState"];
  hp: number;
  rip?: boolean;
  items?: (ObservedInventoryEntry | null)[];
  monsterHunt?: HuntStatus["monsterHunt"];
  huntLoot?: HuntStatus["huntLoot"];
  activeCombatTarget?: HuntStatus["activeCombatTarget"];
  combatSelection?: NonNullable<Member["status"]>["combatSelection"];
  groupedCombat?: NonNullable<Member["status"]>["groupedCombat"];
}

// The group's line from the groups and tasks owner (`task.status`): the top line
// and why other tasks wait.
export interface GroupLine {
  phase: string; label: string; since: number;
  reasons: { kind: string; label: string; since: number; needsAction: boolean }[];
}
// A character's appearance, kept apart from its live status so a saved doll never makes it online,
// and its offline inspection snapshot (coordinator/intake.ts; the lifecycle owner's roster and the settings owner's roster save read
// the types).
export interface AppearanceSprite { url: string; tileSize: number; columns: number; rows: number; x: number; y: number }
export interface CharacterAppearance {
  skin?: string;
  characterSprite: AppearanceSprite | null;
  characterDollHtml: string | null;
  updatedAt: number;
}
export interface AppearanceState {
  characterSnapshots?: Record<string, Record<string, unknown> & { updatedAt: number }>;
  characterAppearances?: Record<string, CharacterAppearance>;
}
// Table L's answer for a character (coordinator/line.ts), the state's `activity`.
export interface CardLine {
  text: string;
  // The task and phase the text comes from, for readers that group or test by them.
  task: string; phase: string;
  // "Stuck - trying <rung>" while the character's climber reports a stuck notice.
  notice?: string;
  // The stuck record's id, which the diagnostics view resolves.
  incident?: string;
  // The member's group line, so a reader sees why a task waits.
  group?: GroupLine;
  // `status.line`: each enabled add-on's line under this one, with the add-on's name.
  addons?: { addon: string; label: string }[];
}

// The log entries (coordinator/logs.ts). A line the character numbers carries its `session` and
// `seq`, so a resent batch keeps it once.
export interface CombatLogEntry {
  at: number;
  type: string;
  message: string;
  details: unknown;
  session?: string;
  seq?: number;
}
/** Older retained logs are not normalized by the append endpoint. */
export interface StoredCombatLogEntry {
  at?: unknown;
  type?: string;
  message?: string;
  details?: unknown;
  session?: string;
  seq?: number;
}
export interface ActivityEntry {
  at: number;
  level: unknown;
  message: string;
  details: unknown;
}

// The metrics wire shapes (coordinator/metrics/service.ts, runtime/status/character/telemetry.ts, the dashboard's
// metrics views): aggregated observations, not complete game objects.
export interface MetricContext { character: string; server: string }
export interface MetricDamage { monster: string; skill: string; amount: number; hits: number }
export interface MetricCredit { monster: string; count: number }
export interface MetricKill { id: string; at: number; monster: string; actor: string }
export interface MetricLoot { id: string; at: number; item: string; variant: string; quantity: number }
export interface MetricSample {
  at: number; gold: number; luck: number; ping: number | null; level: number; xp: number; maxXp: number;
  /** Cumulative internal gold sent/deposited minus received/withdrawn. Older history omits it. */
  goldMovement?: number;
  /** Cumulative catalog replacement cost consumed and actual consumable purchases. */
  consumableCost?: number;
  consumablePurchases?: number;
  /** Native Encouragement totals, separate from ordinary luckm. Older history omits this field. */
  encouragementLuck?: number;
}
export interface MetricFrame {
  at: number;
  sequence: number;
  observedMs: number;
  partial: boolean;
  damage: MetricDamage[];
  credits: MetricCredit[];
  kills: MetricKill[];
  loot: MetricLoot[];
  first: MetricSample;
  last: MetricSample;
}
export interface MetricBatch extends MetricContext { runtime: string; frames: MetricFrame[] }
export interface MetricTotals extends MetricContext {
  /** Independent gold baseline when other measurements survive a gold reset. */
  goldStart?: Pick<MetricSample, 'at' | 'gold' | 'goldMovement' | 'consumableCost' | 'consumablePurchases'>;
  observedMs: number;
  partial: boolean;
  damage: MetricDamage[];
  credits: MetricCredit[];
  loot: { item: string; variant: string; quantity: number }[];
  first: MetricSample;
  last: MetricSample;
  samples: number;
  luckSum: number;
  pingSum: number;
  pingSamples: number;
}
/** Death attribution is independent of the character that observed the packet. */
export interface MetricDeathTotal { server: string; monster: string; actor: string; count: number }
/** A kept safety bound's firings in one bucket (bounds.ts `boundFired`). */
export interface MetricBoundCount { bound: string; owner: string; count: number }
export interface MetricPoint { at: number; values: MetricTotals[]; kills: MetricDeathTotal[]; bounds: MetricBoundCount[] }
export interface MetricsResponse {
  version: 1;
  startedAt: number;
  from: number;
  to: number;
  resolutionMs: number;
  points: MetricPoint[];
  characters: string[];
  servers: string[];
  lastReceivedAt: number | null;
  incomplete: boolean;
  resets?: MetricResets;
}
export interface AccountGoldPoint { at: number; total: number | null }
export interface AccountGoldResponse { from: number; to: number; points: AccountGoldPoint[] }
export type GoldSample = Pick<MetricSample, 'at' | 'gold' | 'goldMovement' | 'consumableCost' | 'consumablePurchases'>;
export interface GoldHistoryResponse {
  startedAt: number; from: number; to: number; resolutionMs: number; characters: string[]; resets?: MetricResets;
  points: { at: number; values: (Pick<MetricTotals, 'character' | 'server' | 'goldStart'> & { first: GoldSample; last: GoldSample })[] }[];
}
export interface MonsterKillSummary {
  monster: string;
  count: number;
  total: number;
  today: number;
}
export interface MetricsKillsResponse {
  version: 1;
  from: number;
  to: number;
  elapsedMs: number;
  dayFrom: number;
  dayTo: number;
  resetAt: number;
  monsters: MonsterKillSummary[];
  lastReceivedAt: number | null;
}
export interface MetricBarSummary { id: string; amount: number; total: number; today: number }
interface MetricsBarsFields {
  version: 1; from: number; to: number; elapsedMs: number;
  dayFrom: number; dayTo: number; resetAt: number; rows: MetricBarSummary[];
  characters: string[]; monsters: string[]; skills: string[]; items: string[];
  lastReceivedAt: number | null;
}
export type MetricsBarsResponse = MetricsBarsFields & ({ metric: 'damage'; by: 'character' | 'skill' } | { metric: 'loot'; by: 'item' });
export type MetricResetKind = typeof METRIC_RESET_KINDS[number];
export type MetricResets = Partial<Record<MetricResetKind, number>>;

// The names other owners, apps and add-ons use for the status owner's surface.
// A section of GET /party-api/state (table S) and of the heartbeat reply (table R).
export type Section = StateSection;
export type ReplySection = ReplySectionName;
// A diagnostics view's read of one character (coordinator/diagnostics.ts, table G): the lease's end
// and the last post of each ring it named.
/** The last ring save the record icon shows: when, which ring (table G's or an add-on's
 * `<add-on>.<key>`), whose and which record. */
export interface RecordSaved { at: number; ring: string; character: string; record: string }
export interface DiagnosticsLease {
  character: string; until: number;
  live: Partial<Record<LeasedRing, { at: number; records: unknown[]; incidents: unknown[] } | null>>;
  snapshots: unknown[];
}
// An app key: the scopes the player ticked, whether its commands count as the
// player's own (`manual`) or rank at `app`, and its last use. apps.ts stores the key hashed.
export type AppScope = 'read' | 'command' | 'settings' | 'spend';
export interface AppKey { name: string; scopes: AppScope[]; ownCommands: boolean; issuedAt: number; lastUsedAt: number | null; revokedAt: number | null }
// The read-only events, one payload each.
export interface StatusLineChanged { character: string; line: string; task: string; phase: string; by: string }
export interface StatusReceived { character: string; seq: number; seenAt: number; by: 'core:status' }
export interface StatusReplied { character: string; sections: ReplySection[]; by: 'core:status' }
export interface DashboardCommand { route: string; character?: string; group?: string; body: unknown; by: string }
export interface DashboardClients { clients: number; by: 'core:status' }
export interface DiagnosticsLeaseNotice { character: string; rings: LeasedRing[]; by: string }
export interface AppKeyNotice { name: string; scopes: AppScope[]; tier: 'app' | 'manual'; by: string }
// The account's item counts, which the events owner's anniversary reads.
export { inventoryCounts } from "../../dashboard/lib/account-inventory.ts";
