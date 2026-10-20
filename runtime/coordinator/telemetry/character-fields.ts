/**
 * Per-character state field registry. See docs/state-field-registry.md.
 *
 * Part 1, `characterFields`, lists every field a character status can carry:
 * each key `snapshot()` and `sampleTravelReport()` in characters/shared.js
 * report, and each key the coordinator stamps while storing the report
 * (runtime/coordinator/status/ingestion.ts). Part 2 holds the coded
 * whitelists that build the per-character parts of the polled sections.
 * To send another field, add its name to a whitelist and its reader to the
 * catalog entry; scripts/tests/character-field-registry.test.cjs checks both.
 *
 * Tiers, by request (runtime/coordinator/telemetry/public-state.ts):
 * - `section=fast`: `fastFields` with PARTY_STATE_FIELDS=enforce; with the
 *   default `shadow`, every stored field except `shadowFastOmitted`, which is
 *   the v1.4.0 output.
 * - `section=inventory`: `inventoryFields`, item metadata compacted.
 * - `section=core&dashboard=1`: `characterDetails` from `diagnosticFields`
 *   plus `combat.positioning`, and `characters` from `coreSummaryFields`.
 * - the live stream (dashboard-stream.ts): `streamFields`, items and slots.
 * - `/party-api/state` without a section: the debug tier, every stored field
 *   unchanged. A `tier: "debug"` field has no external reader; read it there.
 *
 * `stored: false` marks report fields the coordinator consumes and deletes
 * before storing (status/catalogs.ts, bank.ts, ponty.ts); no section has them.
 * `readers` lists the external clients of the public API that read the field
 * from a lean section or the live stream: Ryan's dashboard, the companion PWA
 * and Android app, and a metrics collector. The coordinator reads
 * `state.statuses` directly, so the lists leave it out. The readers come from a typed
 * static scan (tools/state-fields/scan-readers.mts), recorded reads during
 * the E2E suites, and the Android data classes; docs/state-field-registry.md
 * § Readers inventory has the method and the differences.
 *
 * Sizes are per character, from a saved four-character state dump
 * (2026-09-23); "small" fields stay under about 1 KB.
 */
export type FieldReader = "dashboard" | "pwa" | "android" | "metrics";
export interface CharacterField {
  description: string;
  tier: "lean" | "debug";
  size: "small" | "large";
  bytes?: string;
  stored: boolean;
  readers: readonly FieldReader[];
}

const all = ["dashboard", "pwa", "android"] as const;
const apps = ["pwa", "android"] as const;
const lean = (description: string, readers: readonly FieldReader[], size: Pick<CharacterField, "size" | "bytes"> = { size: "small" }) =>
  ({ description, tier: "lean", stored: true, readers, ...size }) as const;
const debug = (description: string, size: Pick<CharacterField, "size" | "bytes"> = { size: "small" }) =>
  ({ description, tier: "debug", stored: true, readers: [], ...size }) as const;
const consumed = (description: string, size: Pick<CharacterField, "size" | "bytes"> = { size: "large", bytes: "estimated: one whole game catalog" }) =>
  ({ description, tier: "debug", stored: false, readers: [], ...size }) as const;
const large = (bytes: string) => ({ size: "large", bytes }) as const;

export const characterFields = {
  // Identity and runtime
  name: lean("Character name; the status key.", ["dashboard", "android"]),
  owner: lean("Game account id; core derives accountId from it.", all),
  ctype: lean("Class id, such as merchant or priest.", [...all, "metrics"]),
  level: lean("Character level.", [...all, "metrics"]),
  server: lean("Realm as region plus identifier, such as USII.", all),
  ping: lean("Latest game ping in ms, or null.", all),
  home: debug("The character's home server from the game, or null."),
  runtime: debug("native (Steam or browser client) or headless (caracAL)."),
  platform: debug("caracal, the game platform name, or browser."),
  clientVersion: debug("Game client version the script runs under."),
  clientInstance: debug("Client instance id from the loader, or null."),
  steamPrimary: debug("True for the Steam window that owns native input."),
  steamRealmProtocol: debug("Steam bridge realm protocol version, 0 when absent."),
  codeGeneration: debug("Runtime generation counter of the loaded character code."),
  dashboardRuntime: debug("Runtime id the dashboard stream uses to fence stale sessions."),
  loaderGeneration: debug("Loader generation number."),
  codeHash: debug("Hash of the loaded character code, or null."),
  codeRevision: debug("Fixed protocol label of the report, such as realm-logistics-v3."),
  consoleMaintenance: debug("The character's view of the console maintenance lease."),
  bankSortProtocol: debug("Bank sort protocol version."),
  convoyProtocol: debug("Convoy protocol version."),
  huntReturnProtocol: debug("Hunt return protocol version."),
  lastCommandId: debug("Id of the last coordinator command the character applied."),
  seenAt: lean("Coordinator receive time of the last status (ingestion.ts).", [...all, "metrics"]),
  inventorySeenAt: debug("Coordinator receive time of the last report that carried items (ingestion.ts)."),
  // Appearance
  skin: lean("Skin id for the portrait.", all),
  characterSprite: lean("Sprite sheet definition for the portrait.", all),
  characterDollHtml: lean("Rendered character doll markup for the portrait.", all, large("1.6 KB")),
  // Vitals and position
  hp: lean("Current HP.", all),
  max_hp: lean("Maximum HP.", all),
  mp: lean("Current MP.", all),
  max_mp: lean("Maximum MP.", all),
  cc: lean("Code call cost, rounded up, for the CC meter (connected-character-card.tsx).", ["dashboard"]),
  xp: lean("Current XP into the level.", [...all, "metrics"]),
  max_xp: lean("XP needed for the next level.", [...all, "metrics"]),
  gold: lean("Carried gold.", [...all, "metrics"]),
  map: lean("Current map id.", [...all, "metrics"]),
  in: lean("Instance id of the current map; the live stream sends it and fast is the stream fallback.", []),
  x: lean("Rounded x position.", all),
  y: lean("Rounded y position.", all),
  moving: debug("True while the character is moving."),
  transporting: debug("True during a map transport (sampleTravelReport)."),
  rip: lean("True while dead.", [...apps, "metrics"]),
  lastDeath: lean("Last death record: time, killer and details.", ["metrics"]),
  conditions: lean("Active conditions with remaining time.", all, large("2.8 KB")),
  inventorySize: lean("Bag capacity.", all),
  upgradeInventoryBusy: lean("True while upgrade or tidy work holds the inventory; the live stream sends it and fast is the stream fallback.", []),
  standOpen: lean("True while the merchant stand is open.", all),
  target: lean("Current combat target summary, or null.", apps),
  mainTownSpawn: debug("Main town spawn point from game data."),
  realmPlayers: debug("Player names seen on the realm, for giveaways (giveaway-directory.ts)."),
  gameParty: debug("The game's party member list."),
  // Stats
  primaryStat: lean("Class main stat: str, int or dex.", all),
  attack: lean("Attack.", all),
  frequency: lean("Attack frequency.", all),
  range: lean("Attack range.", all),
  speed: lean("Run speed.", all),
  unrestrictedSpeed: lean("Merchant run speed without stand and cart limits, else null.", all),
  armor: lean("Armor.", all),
  resistance: lean("Resistance.", all),
  str: lean("Strength.", all),
  int: lean("Intelligence.", all),
  dex: lean("Dexterity.", all),
  vit: lean("Vitality.", all),
  fortitude: lean("Fortitude.", all),
  luck: lean("Luck as a percentage.", all),
  goldBonus: lean("Gold find bonus in percent.", all),
  xpBonus: lean("XP bonus in percent.", all),
  combatStats: lean("Secondary combat stats: crit, evasion, piercing, resistances.", all),
  // Activity flags
  banking: lean("True while a bank trip runs.", all),
  bankQueued: lean("True while a bank trip is queued.", all),
  stocking: lean("True while the merchant restocks.", all),
  upgrading: lean("True while the merchant upgrades.", apps),
  farmingMode: lean("Active farming mode.", all),
  farmingMonsterType: debug("Monster type the farming mode targets."),
  monsterHunt: lean("Monster hunt quest status.", all),
  huntEventPending: debug("True while a hunt waits on an event."),
  donationXpPerGold: lean("Donation XP per gold the merchant receives.", all),
  donationLevelXp: lean("XP per level from G.levels, indexed by level, for the donation preview (donation-preview.tsx).", ["dashboard"], large("about 1.5 KB")),
  merchantCommand: debug("Report on the merchant command in progress."),
  merchantEventReserved: debug("True while event work reserves the merchant."),
  upgradePreviewSession: debug("Upgrade preview session id."),
  upgradePreviewRevision: debug("Upgrade preview revision counter."),
  luckySlotTracking: lean("Lucky-slot roll evidence for the slot tracker.", all),
  luckySlotCharacterId: debug("Character id that owns the lucky-slot evidence."),
  inventoryStackRetryAt: debug("Time the merchant retries stacking."),
  inventoryStackError: debug("Last stacking error, or null."),
  // Gathering
  gatheringActive: debug("Active gathering mode, if any."),
  gatheringBlockedReason: debug("Why gathering cannot run, or null."),
  gatheringPhase: debug("Gathering attempt phase, idle when none."),
  gatheringAttemptId: debug("Gathering attempt id, or null."),
  gatheringCooldowns: lean("Fishing and mining cooldowns.", all),
  gatheringAccess: debug("Whether the character can fish and mine."),
  // Achievements and items
  monsterAchievementKills: lean("Kill counts per monster toward achievements.", ["dashboard", "android", "metrics"], large("1.7 KB")),
  monsterAchievements: lean("Achievement progress per monster.", all, large("4.3 KB")),
  tracktrix: lean("Tracktrix status and bonuses.", all),
  items: lean("Bag entries with item fingerprints and metadata.", [...all, "metrics"], large("117 to 273 KB")),
  slots: lean("Equipped entries with item fingerprints and metadata.", [...all, "metrics"], large("457 to 484 KB")),
  nearbyStandListings: debug("Player stand listings near the character.", large("up to 1.9 MB")),
  nearbyGiveaways: debug("Giveaways near the character."),
  bank: consumed("Bank snapshot; bank.ts moves it to bankSnapshot (a null report stays on the status).", large("all bank packs with item metadata")),
  bankVaults: consumed("Bank vault catalog; catalogs.ts moves it to state.bankVaults.", { size: "small" }),
  ponty: consumed("Merchant's Ponty listings; ponty.ts moves them to state.ponty.", large("grows with the listing count")),
  inventoryRevision: consumed("Revision of the items, slots and bank the report names; inventory-carry.ts removes it.", { size: "small" }),
  // Events
  activeEvent: debug("Selected live combat event name, or null."),
  activeEventId: debug("Id of the selected live event, or null."),
  joinedEvent: debug("Event the character joined; set on normal maps too."),
  mapEvent: debug("Event bound to the current map, or null."),
  serverLiveEvents: debug("Live events the server reports."),
  serverStagingEvents: debug("Staging events the server reports."),
  eventFeedConnected: debug("True while the game socket is connected."),
  eventFeedAt: debug("Time of the last event feed update."),
  eventClockStale: debug("True when the event clock has not synced for six minutes."),
  eventSchedules: debug("Event schedule snapshot; projectEventSchedules reads it."),
  eventTeam: debug("Event team of the character."),
  eventRecovery: debug("Event recovery state machine."),
  eventCombatSighting: debug("Event combat sighting of the current target."),
  slendermanSighting: debug("Local Slenderman sighting, or null."),
  slendermanSearchExhausted: debug("True when the Slenderman search found nothing."),
  goobrawlCombat: debug("True while Goobrawl combat is available."),
  anniversaryVisit: lean("Anniversary visit timer and round.", all),
  anniversaryServer: debug("Anniversary event status from the server."),
  anniversaryState: lean("Merchant anniversary work: stage, round and retries.", all),
  // Combat
  combat: debug("Combat runner state, handoffs, positioning and performance; core sends combat.positioning only.", large("0.9 to 1.1 KB")),
  combatSelection: debug("Combat selection id, revision, map and nomination."),
  combatTrace: debug("Ring buffer of recent combat decisions.", large("146 KB")),
  combatDeviation: debug("Recent combat deviation within 3 s, or null."),
  groupedCombat: debug("Grouped combat queue protocol: claims, candidates, evidence, handoffs.", large("17 to 19 KB")),
  activeCombatTarget: debug("Combat target the runner owns."),
  engagedCombatTarget: debug("Combat target the character is engaged with."),
  threats: debug("Monsters targeting the character."),
  avoidSightings: debug("Up to 8 visible bosses on the Achievement Hunt avoid list; achievement-hunt.ts reads them."),
  oneShotMonsterTypes: consumed("One-shot monster types learned; catalogs.ts merges them.", { size: "small" }),
  oneShotEpoch: consumed("Scatter epoch of oneShotMonsterTypes.", { size: "small" }),
  queueTiming: debug("Queue client timing."),
  recovery: debug("Combat recovery state."),
  lootStatus: debug("Loot client status: pending, eligible and capacity."),
  rareLoot: debug("Rare loot client report."),
  huntLoot: debug("Hunt loot client report."),
  convoyLoot: debug("Convoy loot client report."),
  rareObservation: debug("Latest rare monster observation."),
  rareSightings: debug("Rare monster sightings."),
  rareFields: debug("Rare monster field observations."),
  rareKills: debug("Rare monster kills."),
  rareNavigation: debug("Rare hunt navigation state."),
  rareDeployment: debug("Rare hunt deployment state."),
  escape: debug("Local escape state."),
  returnTownReady: debug("True when the town skill is ready."),
  // Navigation and movement
  movement: debug("Movement executor report."),
  movementGeometry: debug("Movement geometry identity."),
  convoyNavigation: debug("Convoy navigation report."),
  travelSample: debug("Sequenced travel sample (sampleTravelReport, travel-report.ts)."),
  navigationState: debug("town, convoy, follow, departing or idle."),
  navigationDetail: debug("Navigation detail while traveling."),
  smartNavigation: debug("Game smart-move state."),
  farmReunion: debug("Farm reunion state."),
  farmingNavigationDebug: debug("Farming navigation flags for debugging."),
  eventWalkFailure: debug("Last event walk failure."),
  farmAreaEvidence: debug("Farm area monster evidence.", large("2.7 to 4 KB")),
  farmAreaObservation: debug("Latest farm area observation."),
  farmCompetition: debug("Other players competing for the farm area."),
  dungeon: debug("Dungeon runtime report, with recovery inside a cave."),
  // Catalogs, reported once when the coordinator has none (status/catalogs.ts)
  merchantCatalogVersion: consumed("Merchant catalog version.", { size: "small" }),
  travelPlaces: consumed("Travel place catalog."),
  monsterChoices: consumed("Monster choice catalog."),
  monsterLocationsVersion: consumed("Monster locations version.", { size: "small" }),
  monsterHunterLocation: consumed("Monster hunter NPC location.", { size: "small" }),
  bestiaryCatalog: consumed("Bestiary catalog."),
  skillCatalog: consumed("Skill catalog."),
  appearanceChoices: consumed("Class appearance choices."),
  merchantCatalog: consumed("Merchant item catalog."),
} as const satisfies Record<string, CharacterField>;

export type CharacterFieldName = keyof typeof characterFields;

/**
 * The live stream's vitals fields. dashboard-stream.ts owns the list as
 * `liveFields`; this copy lets browser code (field-read-audit.ts) use it
 * without importing node:crypto, and the registry test checks the two match.
 */
export const streamFields = [
  "hp", "mp", "max_hp", "max_mp", "cc", "x", "y", "map", "in", "xp", "max_xp", "gold", "rip",
  "target", "standOpen", "conditions", "inventorySize", "upgradeInventoryBusy",
] as const satisfies readonly CharacterFieldName[];

/** v1.4.0's fast omit list, kept for PARTY_STATE_FIELDS=shadow. */
export const shadowFastOmitted = [
  "items", "slots", "bank", "realmPlayers", "nearbyStandListings", "nearbyGiveaways", "characterDollHtml",
] as const satisfies readonly CharacterFieldName[];

/**
 * Coded whitelists. `fast` stands in for the live stream while it is down
 * and fills the dashboard's diagnostics cache before core's first answer
 * (dashboard/features/party/query-cache.tsx), so it carries every lean field
 * except the large ones the inventory section sends.
 */
export const sectionFields = {
  fast: [
    "name", "owner", "ctype", "level", "server", "ping", "seenAt",
    "skin", "characterSprite",
    "hp", "max_hp", "mp", "max_mp", "cc", "xp", "max_xp", "gold", "map", "in", "x", "y", "rip", "lastDeath",
    "conditions", "inventorySize", "upgradeInventoryBusy", "standOpen", "target",
    "primaryStat", "attack", "frequency", "range", "speed", "unrestrictedSpeed", "armor", "resistance",
    "str", "int", "dex", "vit", "fortitude", "luck", "goldBonus", "xpBonus", "combatStats",
    "banking", "bankQueued", "stocking", "upgrading", "farmingMode", "monsterHunt", "donationXpPerGold", "donationLevelXp",
    "luckySlotTracking", "gatheringCooldowns", "monsterAchievementKills", "monsterAchievements", "tracktrix",
    "anniversaryVisit", "anniversaryState",
  ],
  inventory: ["items", "slots", "characterDollHtml"],
  /**
   * 1.5's diagnostics allow-list, unchanged; core adds combat.positioning.
   * No client reads recovery, movement, eventWalkFailure,
   * farmingNavigationDebug, activeEvent, joinedEvent, the three gathering
   * attempt fields or lootStatus from it, so the catalog marks them debug.
   */
  diagnostics: [
    "name", "recovery", "movement", "eventWalkFailure", "farmingNavigationDebug", "ctype", "server", "level",
    "seenAt", "ping", "owner", "skin", "characterSprite", "characterDollHtml", "primaryStat", "attack",
    "frequency", "range", "speed", "unrestrictedSpeed", "armor", "resistance", "str", "int", "dex", "vit",
    "fortitude", "luck", "goldBonus", "xpBonus", "combatStats", "banking", "bankQueued", "stocking",
    "upgrading", "standOpen", "farmingMode", "monsterHunt", "activeEvent", "joinedEvent", "donationXpPerGold",
    "donationLevelXp", "gatheringCooldowns", "gatheringPhase", "gatheringBlockedReason", "gatheringAttemptId",
    "monsterAchievementKills", "monsterAchievements", "tracktrix", "anniversaryVisit", "anniversaryState",
    "lootStatus",
  ],
  coreSummary: ["name", "ctype", "level", "server"],
} as const satisfies Record<string, readonly CharacterFieldName[]>;

/**
 * One character's fast-section entry. PARTY_STATE_FIELDS=enforce selects the
 * whitelist; any other value keeps the v1.4.0 omit-list output, so a console
 * can run in shadow first (docs/state-field-registry.md § Rollout). The
 * whitelist copies about 60 named fields and never visits the other stored keys.
 */
export function fastProjection(status: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (globalThis.process?.env.PARTY_STATE_FIELDS === "enforce") return pickFields(status, sectionFields.fast);
  return Object.fromEntries(Object.entries(status).filter(([key]) => !shadowOmitted.has(key)));
}
const shadowOmitted = new Set<string>(shadowFastOmitted);

/** The named fields that exist on `status`, in whitelist order. */
export function pickFields(status: Readonly<Record<string, unknown>>, fields: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) if (Object.hasOwn(status, field)) result[field] = status[field];
  return result;
}
