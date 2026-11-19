// Hunts and farming's door: the one file
// of runtime/hunting/ that other owners import. It answers on both runtimes, so it holds no value
// that needs a node built-in. The dashboard imports zones.ts and areas.ts instead.
import type { Hunt } from './coordinator/hunt.ts';
import type { HuntFailureState } from './saved-fields.ts';
import type { AnniversaryCycle, HuntEventTrip, HuntEventTrips, ReturnLocation } from '../events/api.ts';
import type { Death, Member } from '../coordinator/targeting/api.ts';
import type { ClaimObservation } from '../coordinator/targeting/api.ts';
import type { StoredCombatLogEntry } from '../status/api.ts';
import type { HuntTravelCheckpoint, PartyConvoy, ReturnTownPolicy, SharedConvoy } from '../movement/api/coordinator.ts';
import type { Relocation } from '../movement/api/character.ts';
import type { ObservedCharacterStatus } from '../status/api.ts';
import type { ApproachReport } from '../coordinator/targeting/api.ts';
import type { CurrentAttacker } from '../movement/api/coordinator.ts';
import type { Tier } from '../protocol/ranks.ts';
import type { HuntTravelConvoy } from '../coordinator/targeting/api.ts';
import type { PassiveSettings } from './rules.ts';
import type { Area, Catalog, Point } from './zones.ts';
export * from './zones.ts';
// The farm areas and the spawn catalog from game data (areas.ts, HNT-047), which the events owner's Cipher walk asks
// with zones.ts `firstSpawn`.
export * from './areas.ts';
// The character's loot client, which the role runner installs (character/loot.ts).
export { installLootClient } from './character/loot.ts';
// The Hunt's saved shapes, which the tasks owner's slots read for the scope's records (slots.ts).
export type { HuntFailureState, HuntFailures } from './saved-fields.ts';
// The Hunt settings' shape, defaults and check, which the dashboard's Hunt settings control reads.
export { defaultHuntSettings, validHuntSettings, type HuntSettings } from './rules.ts';
// The Hunt record's shape, which the targeting owner's group snapshot types (coordinator/hunt.ts).
export type { Hunt } from './coordinator/hunt.ts';
// The Hunt's event death test, which the survival owner's party death recovery asks.
export { eventDeath, type EventTripSpan } from './rules.ts';
// The survival owner's daily Cave answer, which the dashboard's Cave row reads.
export { caveVisitCurrent } from './rules.ts';
// The Cave floor's map name, which the dashboard's Cave map and dungeon panel draw.
export { caveFloorMap } from './rules.ts';
// How a combat mode answer reads where it arrives: the character's reply, the tasks owner's hand response.
export { answerOf } from './rules.ts';
export { farmLine, farmWalkLine, huntLine, modeLine, modePair, RARE_TRAVEL_LABEL, rareWalkLine, type HuntCardLine } from './rules.ts';
// The rare's and the patrol's walk purposes, which the status owner's card line reads to name a rare walk.
export { PATROL_WALK, RARE_WALK, rareWalkKind } from './rules.ts';
// The slot pair with its defaults, which the status owner's core section and farming context read.
export { DEFAULT_COMBAT_MODE, DEFAULT_TARGET_MODE, slotPair, type SlotFields } from './rules.ts';
// The passive rare rules: the targeting owner's queue and passing rule read the level cap and the switches, and
// the settings import migrates a profile's rules.
export { defaultPassiveRule, passiveLevelAllowed, migratePassiveSettings, committedPassiveRules } from './rules.ts';
// The ranges the passive menu and the radius control draw (saved-fields.ts's checks read the same).
export { NO_LEVEL_CAP, PASSIVE_PRIORITY_RANGE, SEARCH_RADIUS_RANGE } from './rules.ts';
// The game reaches other owners test against: movement's Hunt defense (chest reach) and targeting's
// rare rule (field generator reach).
export { GAME_CHEST_REACH, GAME_FIELD_REACH } from './rules.ts';
// The party's focus rule, which movement's engagement and heartbeat routes read.
export { partyFocus } from './rules.ts';
export type { PassiveRule, PassiveSettings } from './rules.ts';

// The shapes below are the saved Hunt record and the report fields the cycle reads (2.3). Their
// field names stay today's, so a saved cycle loads unchanged; 01, 02 and 06 type their reads of
// the record with them.

// A monster a member fights or is attacked by, as its report names it: the scatter learning
// (coordinator/modes.ts) and the events owner's event attendance read it.
export interface CombatReference {
  id?: string;
  mtype?: string;
  at?: number;
  reason?: string;
}

// The farm spot's saved shapes and the report fields farming reads (2.3 `spot`; coordinator/farm.ts).

/** A saved farm point or a catalog area: a location, its shape when the catalog gave one, and its monsters. */
export interface FarmSpot extends ReturnLocation, Area { monsterIds?: string[] }

/** One member's competition observation of the area it farms (character/farm.ts sends it). */
export interface FarmCompetitionObservation {
  at: number;
  runtimeId: string;
  revision: number;
  areaId: string;
  map: string;
  in: string;
  server: string;
  radius: number;
  monsters: Record<string, number>;
  players: string[];
}

/** Another player's hit or kill a member saw in its farm area. */
export interface FarmHit { key?: string; actor?: string; at: number; mtype: string; kill?: boolean; map?: string; x: number; y: number }

export interface FarmReport extends ReturnLocation {
  farmCompetition?: FarmCompetitionObservation;
  farmAreaEvidence?: FarmHit[];
  farmAreaObservation?: { id: string; at: number };
  // A focus monster the farm would take stands in the character's view (character/farm.ts `focusInView`).
  farmFocusInView?: boolean;
  combatSelection?: { runtimeId?: string };
  server?: string;
  seenAt: number;
  rip?: boolean;
  activeEvent?: string;
  joinedEvent?: string;
}

/** A queued farm move: its destination, the members' navigation revisions and when it was queued. */
export interface FarmRelocation {
  focusChange?: boolean;
  cause?: 'farming-conflict';
  source?: FarmSpot;
  actor?: string;
  destination: FarmSpot;
  revisions?: Record<string, number>;
  at: number;
  reason: string;
  // On the farming task's wait rung, the move waits for the next report that shows a change.
  afterReport?: boolean;
  // A failed move's retry waits for one report round after the failure.
  retry?: boolean;
}

export interface FarmAreaState {
  preferredLocation?: FarmSpot;
  recoveryVersion?: number;
  paused?: boolean;
  failures?: Record<string, number>;
  pending?: FarmRelocation | null;
  message?: string | null;
  active?: { id: string; map: string; x: number; y: number; monsterIds: string[] };
  lastFailure?: { reason?: string; at: number; transient: boolean; details: unknown } | null;
  // The contested areas with their competing player, and the areas a member last saw quiet
  // (coordinator/farm.ts `recordFarmEvidence`).
  activity?: Record<string, { actor?: string }>;
  quiet?: Record<string, number>;
}

/** The mission walk's route recovery a walk and its commands carry (hunt.ts `markRecovery`). */
export interface RouteRecoveryCommand {
  key: string;
  stage: 'native' | 'relocation' | 'post-relocation';
  relocation?: Relocation['method'];
}

/** One spawn's route failures under one movement geometry, saved in the cycle. */
export interface HuntRouteRecovery {
  destination: ReturnLocation;
  geometry: string;
  phase: 'native' | 'relocation' | 'post-relocation' | 'held' | 'excluded';
  relocation?: Relocation;
  firstFailure: string;
  message: string;
  attempts: { id: string; at: number; reason: string; details?: unknown }[];
}

/** One quest the cycle tracks from its first fresh report to its expiry or completion (B.8). */
export interface HuntExpiryAttempt {
  target: string;
  owner: string;
  revision: number;
  deadline: number;
  done?: boolean;
}

export interface LootProgress {
  id: string;
  observedAt: number;
  realm: string;
  map: string;
  in: string;
  complete: boolean;
  error?: string;
}

// What `hunt.quest` sees (6 part 1): the group, the quest's owner and the quest, and every live
// quest the selection could take.
export interface HuntQuest { id: string; count: number; ms: number }
export interface HuntQuestAsk { group: string | null; owner: string; quest: HuntQuest; candidates: HuntQuest[] }
// What `farm.spot` sees and answers (6 part 1): the group, its focus, the area it stands in and the
// alternatives the farm spot rules allow, best first; the answer refuses some by id or prefers one of them.
export interface FarmSpotAsk { group: string | null; focus: string[]; active: FarmSpot; alternatives: import('./areas.ts').FarmingArea[] }
export interface FarmSpotAnswer { refuse?: string[]; prefer?: string }
// What `cave.rejoin` sees: a member back online that the game and the entry check let enter the
// run again, the run's clock as the members inside report it, and the member's live task, or null.
// The question `drop` asks about a member the game reports offline while the run is paused.
// What `cave.destination` sees: the run, the floor, the points auto exploration may walk to next
// and the one it walks to now.
export interface CaveDestinationAsk { group: string | null; run: string; floor: number; points: CavePoint[]; previous: string | null }
export interface CaveRejoinAsk { question: 'rejoin' | 'drop'; group: string | null; member: string; run: string; clock: { paused: boolean; expires: number };
  task: { kind: string; owner: string } | null }

export interface HuntCycle extends Hunt {
  routeRecovery?: Record<string, HuntRouteRecovery>;
  // The failed Daisy return the task ladder already counted, so one failure climbs one step.
  returnClimbed?: string;
  // Deaths a suspended Hunt counted (rule 2.3.7), for its reaction once its task is live again.
  observedDeaths?: { names: string[]; blacklisted: boolean };
  travelCheckpoint?: HuntTravelCheckpoint;
  travelCause?: 'farming-conflict';
  expiryAttempts?: Record<string, HuntExpiryAttempt>;
  backup?: {
    startedAt: number;
    members: Record<string, { target: string | null; remainingMs: number; ready: boolean; fresh: boolean }>;
  };
  batchPickup?: boolean;
  missionRevision?: number;
  originArrivedAt?: number;
  loot?: { id: string; after: number; map: string; in: string; realm: string; x: number; y: number; complete: boolean; progress?: LootProgress };
  version?: number;
  cycleId: string;
  convoyId?: string | null;
  missions: {
    target: string;
    owners: string[];
    skipped?: boolean;
    skipReason?: string;
    destination?: ReturnLocation | null;
    destinationVersion?: number;
    destinationRevisions?: Record<string, number>;
  }[];
  currentIndex: number;
  target: string | null;
  waitForExpiry?: boolean;
  pickupPending?: boolean;
  // A `distance` refusal at Daisy: the next Daisy step walks there before it issues again (3.7).
  daisyRegroup?: boolean;
  skipAfterDeath?: boolean;
  recovering?: boolean;
  resumeStage?: string;
  arrivalHandoff?: { at: number };
  startedAt?: number;
  returnPolicy?: string;
  returnLocation?: ReturnLocation | null;
  returnFocus?: string;
}

export interface HuntStatus {
  movementGeometry?: { version: number; fingerprint: string };
  anniversaryState?: { busy?: boolean };
  activeCombatTarget?: { id: string; map: string; in?: string | number; server: string };
  groupedCombat?: {
    currentAttackersAt?: number;
    deaths?: Death[];
    claims?: ClaimObservation[];
    sightings?: NonNullable<NonNullable<Member['status']>['groupedCombat']>['sightings'];
    candidates?: NonNullable<NonNullable<Member['status']>['groupedCombat']>['candidates'];
    retentions?: { id: string; eligible: boolean }[];
  };
  region?: string;
  in?: string | number;
  huntLoot?: LootProgress;
  seenAt: number;
  ctype?: string;
  server?: string;
  hp?: number;
  speed?: number;
  // The call budget's status sample (characters/shared.js `calls`): its margin is the largest round
  // trip of the member's last window.
  calls?: { margin?: number } | null;
  lastDeath?: { at?: number; eventTrip?: HuntEventTrip | null };
  map: string;
  x: number;
  y: number;
  rip?: boolean;
  // The one event fact (01 design 3.1), written by status ingestion once per full report.
  presence?: unknown;
  farmReunion?: unknown;
  convoyProtocol?: number;
  huntEventPending?: boolean;
  monsterHunt?: { id: string; count: number; remainingMs: number } | null;
}

export interface HuntConvoy {
  epoch?: number;
  routeRecovery?: RouteRecoveryCommand;
  defenseReason?: string | null;
  communicationHold?: PartyConvoy['communicationHold'];
  failureDetails?: unknown;
  communicationLegacyRecovered?: boolean;
  location?: ReturnLocation;
  geometryRepair?: SharedConvoy['geometryRepair'];
  nativeFallback?: boolean;
  participants?: string[];
  walkingActivity?: string;
  walkingParents?: Record<string, { revision: number }>;
  continuousReturn?: number;
  returnTown?: ReturnTownPolicy;
  cause?: 'farming-conflict';
  huntTarget?: string;
  label?: string;
  id: string;
  phase: string;
  purpose?: string | null;
  failedAt?: number;
  failure?: string;
  failureCode?: string;
  expected?: Record<string, { revision: number }>;
  returnRouting?: unknown;
  blockerSummary?: string;
  preparationBlocker?: string;
  blockers?: Record<string, unknown>;
  townFirst?: boolean;
  combatHandoffAllowed?: boolean;
  nonPreemptible?: boolean;
  disableTown?: boolean;
}

export interface HuntCommand {
  continuousReturn?: number;
  routeRecovery?: RouteRecoveryCommand;
  nativeFallback?: boolean;
  huntTarget?: string;
  id?: number;
  type: string;
  cycleId?: string;
  action?: string;
  convoyId?: string;
  convoyHandoff?: unknown;
  navigationRevision?: number;
  purpose?: string | null;
  issuedAt?: number;
  combatHandoffAllowed?: boolean;
  nonPreemptible?: boolean;
  returnRouting?: unknown;
}

/** The group's state the Hunt cycle reads and writes. */
export interface HuntTickState extends HuntFailureState {
  location?: ReturnLocation | null;
  rareHuntState?: { encounter?: { message?: string } | null } | null;
  monsterChoices?: Catalog | null;
  groupedCombat?: { deaths?: Death[] } | null;
  huntEventTrips?: HuntEventTrips['huntEventTrips'];
  combatRecovery?: { phase: string; reason?: string } | null;
  targetMode: string;
  monsterHunt: HuntCycle | null;
  activeConvoy: HuntConvoy | null;
  /** Null during coordinator startup; active Hunt operations keep their selected-leader precondition. */
  leader: string | null;
  followers: Record<string, boolean>;
  statuses: Record<string, HuntStatus | undefined>;
  commands: Record<string, HuntCommand | undefined>;
  escape?: { stage: string } | null;
  monsterHunterLocation: ReturnLocation | null;
  farmAreaState?: FarmAreaState | null;
  huntBlacklist?: Record<string, import('./saved-fields.ts').HuntBlacklistEntry>;
  eventReturn: unknown;
  anniversary?: {
    eventCycle?: Partial<Pick<AnniversaryCycle,
      'endsAt' | 'participants' | 'waypoints' | 'returnDispatchedAt' | 'kissOperations' |
      'returnReason' | 'returnCompletedAt' | 'supersededAt' | 'combatHandoffAt'>> | null;
  };
  monsterSearchRadiusByCharacter: Record<string, number>;
  combatLogs?: Record<string, StoredCombatLogEntry[]>;
}

// ---- Rares (coordinator/rares.ts) ----
// The rare's record and the report fields it reads (2.3 `rare`), under today's field names so a
// saved patrol and its evidence load unchanged. The targeting owner's group snapshot reads a member's rare
// observation with RareStatus.

/** Who started a rare walk: a change to any of these ends it. */
export interface RareOwner {
  leader: string;
  realm: string;
  focus: string;
  policy: string;
  revisions: Record<string, number>;
}
/** A rare a member saw, keyed by realm, map, instance and id. */
export interface RareSight extends Point {
  // A sight is placed on its reporter's map (rares.ts `reportSight`).
  map: string;
  level?: number;
  id: string;
  mtype: string;
  hp: number;
  target?: string | null;
  realm: string;
  in: string;
  seenAt: number;
  reporter: string;
  visible?: boolean;
  partyEngaged?: boolean;
  reachable?: boolean;
}
/** The group's pursuit of one rare. */
export interface RareEncounter extends RareOwner {
  id: string;
  target: RareSight;
  start: number;
  lastSeen: number;
  stage: string;
  generator: string;
  message: string;
  engaged?: boolean;
  killedAt?: number;
  deathAt?: number;
  deployer?: string | null;
  deployedAt?: number;
  combatAt?: number;
  travelAt?: number;
  awaitingSelection?: boolean;
  // The rare's lowest reported HP in this encounter and when a sighting first showed it
  // (rules.ts RARE_PROGRESS_BOUND_MS).
  lowHp?: number;
  lowHpAt?: number;
}
/** The Phoenix patrol's walk through the regions in the player's order. */
export interface PhoenixPatrol extends RareOwner {
  id: string;
  index: number;
  area: Area | null;
  readyAt: number;
  // The Phoenix's death time while the game's respawn time is missing; readyAt is set from it once
  // G.monsters.phoenix.respawn loads.
  diedAt?: number;
  incomplete: string[];
  stage: string;
  points: Point[];
  remaining: Point[];
  point: number;
  arrivedAt: number;
  // A leg failed since the last stop the party reached: the next arrival is progress on the
  // farming task's ladder.
  climbing?: boolean;
  retry?: number;
  paused?: boolean;
  message?: string;
  waitingRegion?: boolean;
  choosing?: boolean;
  retryReason?: string;
  retryAt?: number;
}
/** The patrol's saved place, so a restart resumes its region and respawn wait. */
export interface PatrolCheckpoint extends RareOwner {
  regionId: string;
  readyAt: number;
  diedAt?: number;
}
/** A rare whose pursuit failed, with where the group stood, so only new evidence retries it. */
export interface RareRejection {
  sight: RareSight;
  origin: Point;
}
/**
 * A rejection the targeting owner's grouped queue reads from `farming.focus`: the rare with its server,
 * until when the queue keeps it out, when it was rejected, and when the queue forgets it.
 */
export interface RareRejected extends RareSight { server: string; until: number; rejectedAt: number; expiresAt: number }
// The rare loot pass reports the loot engine's receipt (character/loot.ts), the Hunt's shape.
export type RareLootReceipt = LootProgress;
/** A member's report as the rare reads it. */
export interface RareStatus extends Point {
  map: string;
  region?: string;
  server?: string;
  seenAt: number;
  rip?: boolean;
  hp?: number;
  max_hp?: number;
  ctype?: string;
  joinedEvent?: string;
  movement?: { event?: unknown };
  // The request that holds the member's movement (movement's `live()` on its report).
  movementLive?: { kind?: string; tier?: string } | null;
  items?: ObservedCharacterStatus['items'];
  target?: { mtype: string } | null;
  rareSightings?: RareSight[];
  groupedCombat?: { queueAck?: string | null; approach?: ApproachReport; currentAttackersAt?: number; currentAttackers?: CurrentAttacker[]; protocol?: number };
  range?: number;
  combatSelection?: { runtimeId?: string };
  rareObservation?: { at: number; runtimeId: string; map: string; in: string; server: string; x: number; y: number; sightings: RareSight[] };
  rareKills?: (Point & { id: string; mtype: string; in: string; at: number; partyEngaged?: boolean })[];
  rareFields?: { x: number; y: number }[];
  rareDeployment?: { encounterId: string; failed?: boolean };
  rareLoot?: RareLootReceipt;
}
/** The group's state the rare reads and writes. */
export interface RareState {
  combatLogs?: Record<string, { at: number; type: string; message: string; details?: unknown }[]>;
  leader: string;
  followers?: Record<string, boolean>;
  statuses: Record<string, RareStatus>;
  passiveHunting?: PassiveSettings;
  passiveRareHunts: Record<string, boolean>;
  phoenixRouteOrder: string[];
  phoenixPatrolActive?: boolean;
  phoenixPatrolCheckpoint?: PatrolCheckpoint | null;
  monsterChoices?: Catalog | null;
  monsterFocus: string[];
  monsterFocusByCharacter?: Record<string, string[]>;
  monsterPrioritiesByCharacter?: Record<string, Record<string, number>>;
  targetMode: string;
  // `requester` is the walk's tier, which the rank table's rare column reads.
  commands: Record<string, { type?: string; purpose?: string; requester?: { tier?: Tier } }>;
  activeConvoy?: HuntTravelConvoy & { phase: string; purpose?: string; failureCode?: string; communicationHold?: unknown } | null;
  rarePursuitProgress?: Record<string, { start: number }>;
  rareRetryEvidence?: Record<string, RareRejection>;
  combatRecovery?: { phase: string };
  eventReturn?: unknown;
  anniversary?: { eventCycle?: { returnCompletedAt?: number; supersededAt?: number; combatHandoffAt?: number } | null };
  townCycle?: unknown;
  escape?: { stage: string };
  monsterHunt?: { cycleId?: string; stage?: string; loot?: { complete: boolean }; travelCheckpoint?: HuntTravelCheckpoint } | null;
  location: Area | null;
  rareHuntState?: unknown;
  partyFarmingMode?: string;
  scatterBreakTarget?: unknown;
}

// ---- The Cave visit (coordinator/cave.ts and character/cave.ts) ----
// The visit's record (2.3 `cave`, saved as dailyDungeons), the members' Cave observations and the
// commands the coordinator sends. 01, 05, 08, 11, 12 and the dashboard type their reads with them.
export interface CaveRoute { plot: import('../movement/api/character.ts').Step[]; identity: { version: number; fingerprint: string } }

export interface PriestRecoveryAssignment {
  id: string;
  run: string;
  priest: string;
  target: string;
  authorized: boolean;
}
export interface PriestRecoveryObservation {
  actor: Pick<import('typed-adventureland').CharacterEntity, "ctype" | "hp" | "max_hp" | "mp" | "max_mp" | "c">;
  essence: boolean;
  id?: string;
  target?: string;
  phase: "idle" | "healing" | "waiting" | "ready" | "dispatched" | "reviving" | "uncertain" | "failed" | "complete";
  reason?: string;
}
/** Local wire observations. typed-adventureland 0.0.57 has no Cave of Many Dreams
 * contracts. Verified against official generated_zones.js / runner_functions.js
 * version 17175; review when upgrading the upstream package. */
export interface CavePoint {
  room?: string;
  kind?: string;
  id: string;
  label: string;
  map: string;
  x: number;
  y: number;
  locked?: boolean;
  done?: boolean;
  exit?: boolean;
  down?: boolean;
  to?: string;
  required?: boolean;
}
export interface CaveChoice {
  resultLabel?: string;
  summary?: string[];
  id: string;
  title: string;
  text: string;
  deadline: number;
  resolved: boolean;
  votes: Record<string, string>;
  options: { id: string; label: string; unavailable?: string; cost?: number; amber?: number }[];
  shop?: { room: string; name: string; price: number; sold: boolean; nearby: boolean };
}
export interface CaveObservation {
  protocol: 1;
  at: number;
  supported: boolean;
  alive: boolean;
  ready: boolean;
  travel?: {id:string;distance:number;prepared:boolean;route?:CaveRoute};
  members: string[];
  leader?: string;
  visitError?: string;
  visit?: {
    available: boolean;
    resets: number;
    home: string;
    resume?: { server: string; run?: string };
    checkedAt: number;
  };
  cave: {
    run: string;
    floor: number;
    expires: number;
    remainingMs: number;
    paused: boolean;
    gold: number;
    amber: number;
    points: CavePoint[];
    choice?: CaveChoice;
  } | null;
  recovery?: PriestRecoveryObservation;
  keeper?: { map: string; x: number; y: number };
  action?: {
    id: string;
    status: "dispatched" | "complete" | "uncertain" | "failed";
    error?: string;
  };
}
export interface CaveCommand {
  /** Destination repair plans from the displaced actor, not the old shared route. */
  independent?: boolean;
  cruiseSpeed?: number;
  id: string;
  action: "gather" | "enter" | "move" | "vote" | "buy" | "exit" | "revival" | "stairs" | "talk";
  run?: string;
  resume?: boolean;
  target?: CavePoint;
  choice?: string;
  option?: string;
  room?: string;
  cost?: number;
  amber?: number;
}
export interface DungeonState {
  // `ladders` holds each repair kind's climb (coordinator/cave.ts `climbRepair`),
  // `trying` names the members and the strategy for the card, and `waitAt` the wait rung's start.
  travel?: { target: CavePoint; origin: CavePoint; stage: 'assembling' | 'travelling'; serial: number;
    ladders?: Record<string, import('../protocol/ladder.ts').LadderState>; trying?: string; waitAt?: number };
  stairContinuation?: CavePoint;
  progress?: { enabled: boolean; target?: string; floor?: number; serial: number; message?: string };
  protectFromEvents: boolean;
  // Once every member is out after a run, the
  // party goes back to its task, unless the player chose to stay outside until Release.
  afterRun?: "go-back" | "stay";
  // The visit's identity, the Cave task's owner identity (`cave:<visit>`, 01 design 1.3).
  visit?: string;
  participants: string[];
  phase: "idle" | "gathering" | "entering" | "active" | "exiting" | "held";
  run?: string;
  server?: string;
  pendingEvent?: string;
  commands: Record<string, CaveCommand>;
  resuming?: boolean;
  interruptedPhase?: DungeonState["phase"];
  interruptedCommands?: Record<string, CaveCommand>;
  operations: string[];
  error?: string;
  exitDispatched?: boolean;
  priestRecovery?: PriestRecoveryAssignment;
  recoveryDeaths?: Record<string, { dead: boolean; generation: number; attempted?: boolean }>;
  manualRecovery?: boolean;
}
export interface DungeonParty {
  dailyDungeons?: DungeonState;
  leader: string | null;
  followers?: Record<string, boolean>;
  merchantCharacter: string | null;
  statuses: Record<
    string,
    | {
        seenAt: number;
        map?: string;
        x?: number;
        y?: number;
        server?: string;
        rip?: boolean;
        target?: unknown;
        speed?: import('typed-adventureland').CharacterEntity['speed'];
        // The member's speed without its temporary changes (movement's walk pace reads it).
        baseSpeed?: number | null;
        dungeon?: CaveObservation;
      }
    | undefined
  >;
}
// The dashboard's Cave read, with the answers of the Cave's own rules (coordinator/cave.ts) that
// its row and panel show.
export interface DungeonView {
  state: DungeonState;
  members: { name: string; fresh: boolean; observation?: CaveObservation }[];
  // The first refusal of the party and member entry checks, or null when the party may enter.
  entryRefusal: string | null;
  // The visit walks: exploration on, a travel target or a move command.
  travelling: boolean;
  // Every participant reports fresh and alive on the leader's floor of the run, unpaused.
  actionsReady: boolean;
  // The ids of the done points the party may choose again: a merchant room whose item may still sell.
  reopenable: string[];
}

// ---- The published reads' answers (6 part 3), re-exported for add-ons by hooks/api/07-hunting.ts ----

// `farming.focus(group)` on the coordinator: the group's focus and farm spot, the Hunt target, the
// party type and combat mode answer, the rare state and whether a dead rare's loot holds new pulls.
export interface FarmingFocus {
  focus?: string[];
  priorities?: unknown;
  radius?: unknown;
  area: (Area & { map: string }) | null;
  contains(point: Point & { map?: string }): boolean;
  huntTarget: string | null;
  partyType: string | null;
  mode?: string;
  // `patrolAcquisition`: the Phoenix patrol runs, unpaused, and nothing holds the rare (targeting reads it).
  rare: { state: unknown; rejected: RareRejected[]; owns: boolean; patrolAcquisition: boolean };
  blocksPulls: boolean;
  // The farm spot's state label, which the tasks owner's slot source sends as the farming task's
  // label; null while the spot has nothing to say.
  spot: string | null;
}
// `cave.state(member)`: whether the member stands inside a run, whether the visit owns it, and
// whether an event may take it and the visit may be released, read only (B.2); `cave.state()`: the
// visit's phase, run record and members, and while a travel repair runs, its card line.
export interface CaveMemberState { inside: boolean; owned: boolean; eventAllowed(event?: string): boolean; canRelease: boolean }
export interface CaveVisitState { phase: string; run: unknown; members: string[]; travel: string | null }
export type CaveState = CaveMemberState | CaveVisitState;
// `passive.rule(monster)`: the monster's effective rule, its default, and whether it has a core
// priority (the rares passive hunting knows by name).
export interface PassiveRuleView { rule: import('./rules.ts').PassiveRule; default: import('./rules.ts').PassiveRule; corePriority: boolean }
// `hunt.view(group)`: the cycle's stage, mission, target, owner, the target's counts and its label,
// and the warning while a rare encounter runs (the `hunt-status` slot's data).
export interface HuntView { stage: string | null; mission: unknown; target: string | null; owner: string | null; counts: unknown; label: string | null;
  warning: string | null }
// A farm area of the spawn catalog (areas.ts).
export type { FarmingArea as FarmArea } from './areas.ts';
// The hunting owner's character client, which targeting's ports hold.
export type { HuntingClient } from './character/install.ts';

// The hunting owner's add-on action door: `hunt.take`, the
// Monster Hunt NPC's accept or claim (`interact("monsterhunt")`, as hunting/character/hunt.ts sends
// it) for a member the core Hunt cycle does not hold. The add-on walks the member to the NPC with the movement owner's
// walk action first; the game refuses an interaction out of reach. The coordinator's facts
// (coordinator/api.ts `huntAskFacts`) ride beside the ask, so a character-side ask refuses.
export type HuntBand = 'job' | 'background';
import type { DoorAsk } from '../hooks/registry.ts';
export type HuntAnswer = { outcome: 'sent'; reply?: unknown } | { outcome: 'refused'; by: string; reason: string };
export interface HuntDoorFacts { held?: boolean }
type HuntRoot = { interact?: (name: string) => unknown; __partyHooks?: { calls: { band(ask: { band: HuntBand; method: string }): string } } };
export async function huntTake(_args: Readonly<Record<string, unknown>>, ask: DoorAsk): Promise<HuntAnswer> {
  const refused = (reason: string): HuntAnswer => ({ outcome: 'refused', by: '07', reason });
  const held = ask.facts?.held, band = ask.band;
  if (typeof held !== 'boolean') return refused("07's Hunt cycle is not known for this ask");
  if (held) return refused("the core Hunt holds this member's group");
  const root = globalThis as HuntRoot;
  if (!root.__partyHooks || !root.interact) throw Error('The hunting owner is not installed on this character');
  if (root.__partyHooks.calls.band({ band, method: 'interact' }) !== 'send') return refused('call budget refused the ' + band + ' band');
  return { outcome: 'sent', reply: await root.interact('monsterhunt') };
}
// The rest of the hunting owner's PLAIN reads (rows/07-hunting.ts `PLAIN`), so each is a door export an add-on reads.
export { standsAt, transientFailure, voteSettled, huntFocusTarget, rareEndReadsRare } from './rules.ts';
