// The movement owner's shared shapes:
// the movement host, request, options, step and ports types, then the bounded decision records
// (§ 7). The ring lives in memory and is read on demand; nothing here reaches the heartbeat.
import type { MonsterEntity } from 'typed-adventureland';
import type { GameData, Geometry, Point, Step } from './walk.ts';
import type { Tier } from './ranks.ts';
import type { ScopeHandle } from '../lifecycle/api.ts';
// The movement host and request shapes: request, notice and ring record shapes.
type GameCharacter = typeof character;
// What step safety reads from `parent.entities` (design § 3.1). The map also holds
// characters and NPCs, so every field is optional.
export type SafetyEntity = Partial<Pick<MonsterEntity, 'id' | 'type' | 'mtype' | 'x' | 'y' | 'real_x' | 'real_y' | 'target' | 'aggro' | 'range' | 'dead' | 'visible' | 'hp'>>;
export interface MoveState extends Point {
  moving: boolean; found: boolean; searching: boolean; plot: Step[]; use_town: boolean; try_exact_spot: boolean; edge: number;
  on_done(done: boolean, reason?: string, failure?: unknown): void;
}
// The movement host accepts a minimal payload, with normalized geometry and death state.
export interface Character extends Point, Pick<GameCharacter, 'name' | 'real_x' | 'real_y' | 'speed' | 'moving'> {
  base: Geometry;
  hp?: GameCharacter['hp'];
  rip?: Extract<GameCharacter['rip'], boolean>;
  // Where a moving character walks to; the owner tells its own combat step from other moves.
  going_x?: GameCharacter['going_x']; going_y?: GameCharacter['going_y'];
  // The class; the console's main-map load reads it (owner.ts `consolePaused`).
  ctype?: GameCharacter['ctype'];
  // Attacks per second; the departure gate's window reads its attack period (the `ready` check).
  frequency?: GameCharacter['frequency'];
  // The attack range; step safety's fight test reads it (design § 3.1, queue AV).
  range?: GameCharacter['range'];
  // The monster the character attacks; step safety's fight test reads it too.
  target?: GameCharacter['target'];
  // Inventory observations need only a name and may include newly introduced item IDs.
  items: ({ name: string } | null)[];
}
export interface MovementHost {
  character: Character; G: GameData & { version: number };
  smart: MoveState;
  // Pinned runner 15555 exposes BFS queue/start globals; typed-adventureland
  // omits these internal counters. Optional: unknown runners keep normal bounds.
  queue?: unknown[]; start?: number;
  smart_move(this: void, destination: unknown, callback?: (done: boolean) => void): Promise<unknown>;
  smart_move_logic(this: void): void;
  start_pathfinding(this: void): void; continue_pathfinding(this: void): void;
  stop(this: void, action?: string, success?: boolean, by?: MovementStopper): Promise<unknown>;
  move(x: number, y: number): Promise<unknown>;
  use(skill: string): Promise<unknown>;
  town?(): Promise<unknown>;
  // Blink and Magiport are skills that move a character, so the owner casts them.
  use_skill?(skill: string, target?: unknown): Promise<unknown>;
  accept_magiport?(name: string): Promise<unknown>;
  // The game asks the code page before a click walks (game.js map_click); true keeps it still.
  on_map_click?(x: number, y: number): unknown;
  can_use(skill: string): boolean;
  can_walk(character: Character): boolean;
  is_transporting(character: Character): boolean;
  can_move(input: { map: string; x: number; y: number; going_x: number; going_y: number; base: Geometry }): boolean;
  is_door_close(map: string, door: unknown[], x: number, y: number): boolean;
  can_use_door(map: string, door: unknown[], x: number, y: number): boolean;
  find_npc(name: string): Point | null;
  game_log(message: string, color: string): void;
  // caracAL supplies its selected game-file version through process arguments.
  // Upstream types omit the runner's synchronous BFS visibility-budget hook.
  // Verified in pinned 15555 and installed 17665; unknown versions keep native behavior.
  parent: { __partyClientVersion?: number | string; server_region?: string; server_identifier?: string; entities?: Record<string, SafetyEntity>; is_hidden?: (this: void) => boolean; socket: { connected?: boolean; emit(event: string, data: unknown): void; on?(event: string, listener: (data: unknown) => void): unknown; off?(event: string, listener: (data: unknown) => void): unknown; removeListener?(event: string, listener: (data: unknown) => void): unknown }; push_deferred(key: string): Promise<unknown> };
  __partyMovement?: { dispose(): void };
  // Set by code the player types to park the console's movement.
  __partyMovementPaused?: unknown;
  __partyNativeMovement?: NativeFunctions;
}
export interface NativeFunctions {
  move: MovementHost['smart_move']; stop: MovementHost['stop']; start: () => void; next: () => void; tick: () => void;
}
// The lifecycle owner's console states and the Cave's gate, each a read of shared.js state.
export interface MovementPauses {
  // Manual on this character with no escape running (shared.js `manualHolds`).
  manual(): boolean;
  // The drain parks the character (the lifecycle owner's `lifecycle.drain(character).park`).
  drainPark(): boolean;
  // The Cave's gate refuses movement (the hunting owner's `dungeonClient.canMove`).
  caveHolds(): boolean;
  // The Pause, or the start before the first reply, holds the character (the run scope's `held`).
  held(): boolean;
}
export interface MovementContext {
  runtime: string; revision: number; current: boolean; paused: boolean;
  map?: string; instance?: string | number; server?: string;
}
// Who asks for movement.
// The owner ranks it and records it. Every console caller names one; a call that names
// none is code the player typed in the game client and ranks as `manual` (character/owner.ts `typed`).
export type MovementKind = 'escape' | 'death-recovery' | 'cave' | 'lifecycle' | 'town' | 'manual' | 'app' | 'group-walk' |
  'errand' | 'task-walk' | 'formation' | 'approach' | 'follow' | `addon:${string}`;
// A group walk as another owner's rule reads it (targeting's passing column, `targeting.passing`):
// the tier its task names, and for a Hunt walk the monster it walks to.
export interface WalkView { requester?: { tier?: Tier }; purpose?: string | null; huntTarget?: string }
// A requester's identity as movement's character parts hand it between them (owner.ts's requesters,
// the walk client): its kind and owner, the tier it ranks at, its deadline and its yield.
// Its tier is the task owner's answer as a string (owner.ts `assignedTier`); rules.ts `tierOf` refuses
// one outside its row's tiers.
export type Request = Pick<MovementRequest, 'kind' | 'owner' | 'deadline' | 'yields' | 'current'> & { tier?: string };
export interface MovementRequest {
  kind: MovementKind;
  // The identity the caller picks and keeps, such as `walk:<convoyId>:<epoch>` (design § 1.3).
  owner: string;
  // Group walks, task walks and add-ons name their task's tier in the one rank table
  // (runtime/protocol/ranks.ts).
  tier?: Tier;
  // The card line's words for this request while it holds movement (the status owner's card line table).
  label?: string;
  // When a hold or a waiting request ends with code `expired`, on the service clock.
  deadline?: number;
  // False once the identity the request names is gone, such as the event occurrence a
  // death recovery walks to; the owner then ends it with code `stale` (rule 3).
  current?(): boolean;
  // A standing hold (design § 3.2 invariant 2): it marks who owns a character that stands
  // still and gives way to any request, stop or step, so its holder holds again only while
  // nothing else moves the character.
  yields?: boolean;
  // On a stop: the caller clears movement before its own request, so the owner ranks the
  // stop like that request (rules.ts `judgeStop`). Only a stop that names no
  // requester, the player's typed `stop()`, carries it (character/owner.ts `typedStop`); a console
  // requester that clears the character takes a standing hold at its rank instead.
  takeover?: boolean;
}
// A navigation revision change ends the live request the way a stale identity
// ends it (design § 1.3); the stop that carries it is not a caller's stop.
export interface MovementSupersession { superseded: 'navigation-revision' }
export type MovementStopper = MovementRequest | MovementSupersession;
export interface MovementOptions {
  request?: MovementRequest;
  // Independent combat may promptly try a smaller radius after a verified planner rejection.
  rejectUnreachableGoal?: boolean;
  // Cave combat can displace an actor off its validated shared walking edge.
  // Repair only the local same-map connector, never the destination route.
  repairSharedDrift?: boolean;
  relocation?: 'town' | 'door';
  owner?: {convoyId?: string; epoch?: number; commandId?: number; navigationRevision?: number; routeVersion?: number; recoveryStage?: string};
  transitionComplete?: (destination: Point) => void;
  townAttempt?: (state: 'casting' | 'interrupted' | 'complete' | 'unavailable', index: number, from: Point, destination: Point) => void;
  compareTown?: boolean;
  // The walk's departure (rules.ts `walkDeparture`): `now` leaves the chests at a map change.
  departure?: 'now' | 'loot' | 'after-loot' | 'fight';
  avoidLeave?: boolean; town?: boolean; native?: boolean; shared?: boolean; speed?: number;
  arrivalTolerance?: number;
  // Assembled Cave followers consume the leader's validated route instead of
  // duplicating its search. Large generated floors need an explicit bound.
  awaitSharedRoute?: boolean;
  nativePlanningTimeoutMs?: number;
  // The same native search goes on past its budget while its frontier keeps advancing, with no
  // maximum (the hunting owner's Cave walks).
  nativePlanningWhileAdvancing?: boolean;
  // `lootLeft`: the executor's loot wait left this member's chests (the `ready` check), so it departs without them.
  barrier?: (step: Step, index: number, completed: boolean, lootLeft: boolean) => Promise<boolean>;
  // A gate drives this journey's ticks in place of the service's own tick and ends with the
  // journey (design § 8.1): a group walk's barrier, the Cave route's shared planning and the
  // formation recovery detour each pass one.
  gate?: { tick(): unknown };
}
// A combat step through the owner (design § 2.4). `sent` settles with the native move,
// or at once when nothing was sent.
export interface StepResult { status: 'sent' | 'kept' | 'refused'; reason?: string; sent: Promise<unknown> }
// What a combat step names for step safety: the selected target, or the boss it approaches.
export interface StepOptions {
  target?: string;
  // A step that closes on the boss on purpose: adds
  // never stop it. `terrain` checks only terrain, as the Franky approach always has;
  // `attackers` keeps the attacker rule and leaves out the idle-aggro rule, for an event boss.
  closes?: 'terrain' | 'attackers';
}
export interface MovementPorts {
  now(this: void): number;
  // Whether this runner still runs (the movement `context`); the runner's identity
  // and the navigation revision are the owner's own walk state (owner.ts `WalkState`).
  current(): boolean;
  // The pause sources outside movement that consolePaused reads (`consoleMovementPaused`).
  pauses: MovementPauses;
  // Movement's run scope handle, `act`: its click and wait wakes
  // and the correction listener, which the lifecycle hold table holds while the character is held.
  scope: ScopeHandle;
  // The chests this character still collects before it leaves (the items owner's), which the departure gate
  // reads (runtime/movement/character/walk-client.ts).
  departureChests(): readonly unknown[];
  request(path: string, options: { method: string; timeout: number; body: unknown }): Promise<unknown>;
  // The dashboard's event queue (shared.js `queueCombatEvent`), which movement's diagnostics
  // write to.
  events(type: string, message: string, details: Record<string, unknown>, key: string): void;
  metrics?(event: Record<string, unknown>): void;
  // Decision ring capacity; MOVEMENT_RING_SIZE below is the default.
  ringSize?: number;
  // Real elapsed milliseconds for the owner's cost per call (design § 9.3). A host on
  // virtual time (ChronAL) passes its real clock: a virtual clock stands still during
  // synchronous work, so the cost would read 0.
  cpu?(this: void): number;
}

// Design § 7 sizes the ring at 128 entries: at today's journey rates that covers at
// least the last minute of a fighting character.
export const MOVEMENT_RING_SIZE = 128;

export interface MovementCaller {
  kind: MovementKind; owner?: string;
  // The first frames outside the movement service, kept only for callers that
  // pass no request: typed client code, or a console caller that lost its requester.
  site?: string;
}
// The one ring entry shape for every owner's ring.
// `part` names the owner; movement's own
// entries leave it out, and the groups and tasks owner writes `part: 'tasks'`.
export interface RingEntry {
  seq: number; at: number; part?: string; decision: string;
  kind?: string; owner?: string; tier?: Tier; code?: string; ladderStep?: number;
}
export interface MovementRecord extends RingEntry {
  journeyId?: string; kind?: MovementKind; destination?: Point; by?: MovementCaller;
  // Where the character stood when a journey started.
  from?: Point;
  // The service's own cause code (for example `convoy-takeover`), kept beside the end code.
  cause?: string;
}
export type MovementRecordInput = Omit<MovementRecord, 'seq' | 'at'>;
// A stuck or caught-error record (design § 7; Corrections from the move onto b9b5c91e):
// a named record kind with an id that pruning never shifts, the facts of the moment and
// the records that led up to it, so a reader can search for it later and see why.
export type IncidentKind = 'stuck' | 'caught-error';
export interface MovementIncident {
  id: string; kind: IncidentKind; character: string;
  // The climber's identity and the activity it serves, such as "Regrouping after escape".
  owner?: string; activity?: string;
  // The rung that made no progress, its text and how long the climb has gone without progress.
  rung?: string; trying?: string; noProgressMs?: number;
  position: Point;
  // The last journey end in the lead-up that was not an arrival: what blocked the rung.
  blocked?: Pick<MovementRecord, 'code' | 'by' | 'kind' | 'owner' | 'cause'>;
  error?: string;
  leadUp: MovementRecord[];
}
// The records that led up to an incident: every record from `fromSeq` on. The caller sets
// the window by progress (the climb's start, or the previous climb's when no progress came
// between them); the ring's own size is the only other bound.
export function leadUp(entries: readonly MovementRecord[], fromSeq: number): MovementRecord[] {
  return entries.filter(entry => entry.seq >= fromSeq);
}

export function createMovementRing<T extends object = MovementRecordInput>(now: () => number, capacity = MOVEMENT_RING_SIZE) {
  if (!Number.isInteger(capacity) || capacity < 1) throw Error('Movement ring size must be a positive integer');
  type Entry = T & { seq: number; at: number };
  const entries: Entry[] = [];
  let seq = 0, start = 0;
  return {
    push(entry: T): void {
      const record = { ...entry, seq: ++seq, at: now() };
      if (entries.length < capacity) { entries.push(record); return; }
      entries[start] = record; start = (start + 1) % capacity;
    },
    // Oldest first. Each call returns fresh copies, so a reader cannot change the ring. The copy is
    // a JSON round trip because the entries are plain data and a character's CODE realm can lack
    // `structuredClone` (the live console's movement ring read failed on it, 2026-11-18).
    entries(): Entry[] {
      return [...entries.slice(start), ...entries.slice(0, start)].map(entry => JSON.parse(JSON.stringify(entry)) as Entry);
    },
    get size() { return entries.length; },
    // The sequence number of the newest entry, 0 before the first.
    get lastSeq() { return seq; },
  };
}

// Names the caller from a stack captured inside a service call: the frames after that call. Only
// calls with no request that touch a live journey pay for the capture.
export function callerSite(stack: string | undefined): string {
  const frames = (stack || '').split('\n').slice(2).map(line => line.trim()).filter(Boolean);
  return frames.slice(0, 3).join(' < ') || 'unknown';
}
