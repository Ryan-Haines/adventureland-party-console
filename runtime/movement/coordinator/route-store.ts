// The shared route of a group walk: its types, the route
// the leader publishes and the members read, the departure checks and the arrival checks.
import type { ReturnLocation } from "../../events/api.ts";
import type { StoredCombatLogEntry } from "../../status/api.ts";
import type { HuntCycle } from "../../hunting/api.ts";
import type { ConvoyHistoryState } from "./records.ts";
import type { CompletionReceipts, PartyConvoy } from "./walk.ts";
import type { MerchantCommand } from "../../merchant-jobs/api.ts";
import { requestObject } from "../../lifecycle/api.ts";
import { fresh, reportClockError } from "../../protocol/reports.ts";
import { RENDEZVOUS_RANGE } from "../../protocol/ladder.ts";
import type { Point, SharedCommand, SharedReport } from "../../protocol/walk.ts";
// The walk command and the member's navigation report are protocol's wire shapes; the route store's
// coordinator readers import them from here.
export type { SharedCommand, SharedReport } from "../../protocol/walk.ts";
import { AREA_ARRIVAL_MARGIN, attackersHp, cancelEnds, cruisePaced, reportSlowed, departureStep, departureWaitsFight, departureWaitsLoot, departureWindow, HUNT_TARGET_ARRIVAL, walkDeparture, type DepartureSample } from "../rules.ts";
import { contains } from "../../hunting/api.ts";
import { MAX_PLOT_STEPS } from "../geometry/validation.ts";
import { samePlace } from "../../protocol/place.ts";
// arrivals.ts reads the protocol rule with the route store's other reads.
export { samePlace };

export interface RouteConvoy {
  routeRecovery?: import('../../hunting/api.ts').RouteRecoveryCommand;
  continuousReturn?: number;
  returnTown?: import('./arrivals.ts').ReturnTownPolicy;
  disableTown?: boolean;
  townRetry?: boolean;
  townRetryAt?: number;
  huntTarget?: string;
  location?: ReturnLocation;
  id: string;
  epoch?: number;
  phase: string;
  purpose?: string | null;
  participants: string[];
  completed?: string[];
  departAt?: number | null;
  failureDetails?: unknown;
}
export interface NavigationStatus {
  seenAt: number;
  x?: number;
  y?: number;
  in?: string | number;
  map?: string;
  activeEvent?: string;
  joinedEvent?: string;
  mapEvent?: string;
  target?: { target?: string } | null;
  threats?: { target?: string }[];
  combat?: { lastAttackAt?: number };
}
export interface NavigationGroup {
  ready: boolean;
  anchor?: { map?: string } | null;
  blockers: string[];
  key: string;
  selection: string | null;
  members: string[];
}
export interface NavigationRouteState {
  phoenixPatrolActive?: boolean;
  rareHuntState?: { encounter?: unknown } | null;
  eventReturn?: unknown;
  farmAreaState?: { pending?: unknown };
  anniversary?: { eventCycle?: { returnCompletedAt?: number; supersededAt?: number; combatHandoffAt?: number; endsAt?: number } | null };
  leader: string | null;
  merchantCharacter: string | null;
  activeConvoy: RouteConvoy | null;
  partyFarmingMode: string;
  targetMode: string;
  monsterHunt: HuntCycle | null;
  monsterFocus: string[];
  monsterSearchRadiusByCharacter: Record<string, number | undefined>;
  statuses: Record<string, NavigationStatus | undefined>;
  location: ReturnLocation | null;
  combatLogs: Record<string, StoredCombatLogEntry[] | undefined>;
}
// The group walk's surface the coordinator's step, the Hunt's and the farm's engage and the report
// check call (walk.ts createSharedConvoyNavigation). A convoy payload keeps its phase's fields.
interface ConvoyState {
  activeConvoy: unknown;
  commands: Record<string, Pick<MerchantCommand, "id" | "type"> | undefined>;
}
export interface ConvoyNavigationPlatform {
  step(state: ConvoyState, now?: number): boolean;
  hold(state: ConvoyState, reason: string, code: string, now: number): boolean;
  signal(state: ConvoyState, name: string, now?: number): unknown;
  validReport(state: ConvoyState, body: Record<string, unknown>): boolean;
  engage(state: ConvoyState, ...args: Parameters<NavigationRoutePorts["engage"]>): boolean;
}
export interface NavigationRoutePorts {
  now(): number;
  owned(name: string): unknown;
  intent(name: string): { revision: number; cancelled?: boolean };
  group(): NavigationGroup | null;
  huntOwns(): boolean;
  // True while the group's live task is `farming` (01 design 2.1): the farming recovery walk
  // starts under no other task.
  farmingLive(): boolean;
  engage(
    body: Record<string, unknown>,
    options: { revisions: Record<string, number>; radius: number; focus: string[]; now?: number },
  ): boolean;
  acceptArrival(convoy: RouteConvoy, body: Record<string, unknown>, now: number): boolean;
  persist(): void;
  waypoint(name: string): ReturnLocation | null;
  contains(
    area: ReturnLocation,
    destination: ReturnLocation,
    margin: number,
    radius: number,
  ): boolean;
  start(destination: ReturnLocation, label: string, names: string[], purpose: string): boolean;
  active(): string[];
  members(): string[];
}

// A route point is protocol's Point (runtime/protocol/walk.ts).
export type RoutePoint = Point;
export interface RouteWaypoint extends RoutePoint { town?: boolean; transport?: boolean; s?: number; method?: string; key?: string }
export interface SharedRoute {
  engine?: string;
  geometry: { version: number; fingerprint: string };
  version: number;
  origin: RoutePoint;
  destination: RoutePoint;
  plot: RouteWaypoint[];
  source: "search" | "remainder";
}
export interface SharedStatus extends RoutePoint {
  // Local visible native boss or selected Cipher gathering target; not a global S hint.
  // Instance IDs are normalized because native payloads use either strings or numbers.
  eventCombatSighting?: (RoutePoint & {id: string; mtype: string; event?: string; observedAt: number; attackReachable?: boolean}) | null;
  activeEvent?: string | null; joinedEvent?: string | null;
  lastDeath?: {at: number; eventTrip?: {event?: string; startedAt?: number}} | null;
  movementGeometry?: { version: number; fingerprint: string };
  returnTownReady?: boolean;
  movement?: {progress?:unknown};
  groupedCombat?: { currentAttackersAt?: number; currentAttackers?: import("./defense.ts").CurrentAttacker[] };
  // The gap between the member's last two reports (queue A20).
  reportIntervalMs?: number;
  // False while the member's game socket is disconnected (the status owner's report field), which lets it go from a walk.
  eventFeedConnected?: boolean;
  seenAt: number; server?: string; region?: string; rip?: boolean; hp?: number;
  // The character class; the event walk waits for the group healer.
  ctype?: string;
  combatSelection?: { runtimeId?: string };
  moving?: boolean; transporting?: boolean; speed?: number; convoyProtocol?: number; convoyNavigation?: SharedReport;
  // The run speed from class, gear and stats without conditions, which the walk's pace reads.
  baseSpeed?: number | null;
}
export interface SharedConvoy extends PartyConvoy {
  // The members the walk let go as silent, which it takes back on their next online report (walk.ts `takeBack`).
  silentLeft?: string[];
  eventPursuitBossId?: string;
  eventRetargetTravelStartedAt?: number;
  huntArrival?: {cycleId: string; missionIndex: number; missionRevision: number; epoch: number};
  observationPhase?: string; defenseReason?: string; loot?: unknown;
  failureDetails?: unknown;
  geometryRepair?: { id: string; startedAt: number; expected: {version: number; fingerprint: string}; runtimes: Record<string,string>;
    phase: 'waiting' | 'complete' | 'failed' };
  arrivalReadySince?: number;
  preparationBlocker?: string;
  continuousReturn?: number;
  disableTown?: boolean;
  avoidLeave?: boolean;
  nativeFallback?: boolean;
  merchantInterruption?: import("./defense.ts").MerchantInterruption;
  farmingEngagement?: { target: RoutePoint & {id: string; mtype: string; server?: string}; at: number; finished?: boolean };
  routeVersion?: number;
  sharedStartedAt?: number;
  // null while assembling; route preparation receives its own budget once settled.
  sharedPreparationStartedAt?: number | null;
  routePublishedAt?: number; sharedStoppedAt?: number;
  readinessStartedAt?: number;
  walkingFailures?: number;
  returnFirstFailure?: string;
  missingRoutes?: Record<string, { since: number; observedAt: number }>;
  walkingActivity?: string;
  walkingEvent?: string;
  routeServer?: string;
  retryExhausted?: boolean;
  walkingParents?: Record<string, { revision: number; parentId: number; command?: SlotCommand }>;
  returnRouting?: boolean; townCompleted?: boolean; force?: boolean; nonPreemptible?: boolean;
  runtimes?: Record<string, string> | null;
  observedPhase?: string | null;
  // The barrier rows' progress and blockers (walk.ts `barrier`).
  progress?: Record<string, { ack?: string | null; distance?: number; map?: string; x?: number; y?: number; phase?: string }>;
  blockers?: Record<string, unknown>; blockerSummary?: string;
  engagement?: { character: string; target: RoutePoint; at: number; convoyId: string; epoch: number; reports: Record<string, { commandId?: number; runtimeId?: string }> };
}
// The party's command slot holds every owner's row (merchant-jobs owner.ts MerchantCommand); a
// walk command is the one row kind movement builds.
export type SlotCommand = SharedCommand | MerchantCommand;
// walk.ts sharedCommand builds every walk command with type "party-monster-travel", so a member's
// slot row is the walk's only with that type; another owner's row answers undefined.
export function walkCommandOf(state: Pick<SharedState, 'commands'>, name: string): SharedCommand | undefined {
  const row = state.commands[name];
  return walkRow(row) ? row : undefined;
}
function walkRow(row: SlotCommand | undefined): row is SharedCommand { return row?.type === "party-monster-travel"; }
export interface SharedState extends ConvoyHistoryState, CompletionReceipts {
  // The commands a Hunt arrival released, so a late report of one is not read as travel (E02-07a:
  // movement's own record, no longer the Hunt's `arrivalHandoff`).
  releasedArrivalCommands?: Record<string, { id: number; revision: number }>;
  eventReturn?: unknown; escape?: {stage: string} | null;
  monsterSearchRadiusByCharacter?: Record<string, number>;
  monsterHunt?: import('../../hunting/api.ts').HuntCycle | null;
  activeConvoy: SharedConvoy | null;
  commands: Record<string, SlotCommand | undefined>;
  statuses: Record<string, SharedStatus | undefined>;
  navigationIntents?: Record<string, { revision: number; cancelled?: boolean } | undefined>;
  nextCommandId: number;
}
export function distance(a: RoutePoint, b: RoutePoint): number {
  return samePlace(a, b) ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
}
export function point(s: RoutePoint): RoutePoint {
  return { map: s.map, x: s.x, y: s.y, ...(s.in === undefined ? {} : { in: s.in }) };
}
// Design section 5.1 `sameWalk`: the one answer to "does this report belong to the walk command
// the coordinator issued?". The report names the walk (convoy id and
// epoch), the command and the member's navigation revision, and the command it answers
// names the same four. A check that also binds the report to a runtime calls
// `sameWalkOn` with the runtime the report must carry, compared strictly as before. Each
// caller keeps only what its own phase adds.
export type WalkCommand = Pick<SharedCommand, 'convoyId' | 'epoch' | 'id' | 'navigationRevision'>;
export type WalkReport = Pick<SharedReport, 'id' | 'epoch' | 'commandId' | 'navigationRevision'> & Partial<Pick<SharedReport, 'runtimeId'>>;
export function sameWalk(command: WalkCommand | undefined | null, report: WalkReport | undefined | null): boolean {
  if (!command || !report) return false;
  return report.id === command.convoyId && report.epoch === command.epoch && report.commandId === command.id &&
    report.navigationRevision === command.navigationRevision;
}
export function sameWalkOn(command: WalkCommand | undefined | null, report: WalkReport | undefined | null, runtime: string | null | undefined): boolean {
  return sameWalk(command, report) && report!.runtimeId === runtime;
}
export function reportMatches(state: SharedState, name: string): boolean {
  const c = state.activeConvoy, command = walkCommandOf(state, name), n = state.statuses[name]?.convoyNavigation;
  if (!c || !command || !n || !c.participants.includes(name)) return false;
  return command.convoyId === c.id && command.epoch === c.epoch && sameWalkOn(command, n, c.runtimes?.[name]);
}

export function characterRuntime(status: SharedStatus | undefined): string | undefined {
  return status?.combatSelection?.runtimeId || status?.convoyNavigation?.runtimeId;
}

// A member stamps its departure on its own clock, so the member's measured clock difference
// (protocol/reports.ts `reportClockError`) bounds how far it may read before the walk's start
// or after now.
function departed(state: SharedState, c: SharedConvoy, name: string, now: number): boolean {
  const status = state.statuses[name], report = status?.convoyNavigation, error = reportClockError(status);
  return !!report && reportMatches(state, name) && report.routeVersion === c.routeVersion &&
    ['travelling', 'arrived'].includes(report.phase) && Number.isFinite(report.departedAt) &&
    now >= c.departAt! - error && report.departedAt! >= c.departAt! - error && report.departedAt! <= now + error;
}

export function readinessIssue(state: SharedState, c: SharedConvoy, name: string): string | undefined {
  if (!reportMatches(state, name)) return 'waiting for current route acknowledgement';
  const s = state.statuses[name]!, n = s.convoyNavigation!;
  if (n.routeVersion !== c.routeVersion) return 'installed route version changed';
  if (!n.routeReady || n.phase !== 'route-ready') return 'route not ready (' + n.phase + ')';
  if (s.moving) return 'character still moving';
  if (distance(s, c.rally) > RENDEZVOUS_RANGE) return 'outside rendezvous range';
  if (!cruisePaced(s.speed, c.slowestSpeed, reportSlowed((s as { conditions?: Parameters<typeof reportSlowed>[0] }).conditions))) return n.cruiseRefused ? 'cruise refused: ' + n.cruiseRefused : 'waiting for cruise speed';
  return undefined;
}

// T4 `ready` on the coordinator: while a departure is deferred, each
// member's fight and loot are judged from its own reports by rules.ts `departureStep`. A member whose
// chests stop falling is left to follow, as its executor leaves them (`departure` `now` for it); a
// fight that stops falling stalls the readiness, which climbs the walk's ladder. A member with no
// fight or loot left is ready, so a deferral with nothing left on any member is only the re-plan its
// drift asked for. The samples live beside the walk, are never saved, and start again with each
// readiness start.
export const READINESS_STALLED = 'Departure readiness made no progress: ';
type Judged = { fight?: DepartureSample; loot?: DepartureSample };
const readiness = new WeakMap<SharedConvoy, { startedAt: number; members: Record<string, Judged> }>();
export function readinessStalled(state: SharedState, c: SharedConvoy): boolean {
  if (c.readinessStartedAt === undefined) return false;
  let judged = readiness.get(c);
  if (judged?.startedAt !== c.readinessStartedAt) readiness.set(c, judged = { startedAt: c.readinessStartedAt, members: {} });
  const departure = walkDeparture(c);
  let stalled = false, waiting = false;
  for (const name of c.participants) {
    const s = state.statuses[name], n = s?.convoyNavigation, j = judged.members[name] ||= {};
    if (!s) continue;
    const window = departureWindow(n?.attackPeriodMs, s.reportIntervalMs);
    const fight = departureStep(j.fight, { at: s.seenAt, attackersHp: !departureWaitsFight(departure) ? 0 : attackersHp(s.groupedCombat?.currentAttackers), chests: 0 }, window);
    const loot = departureStep(j.loot, { at: s.seenAt, attackersHp: 0, chests: !departureWaitsLoot(departure) ? 0 : Number(n?.departureChests) || 0 }, window);
    j.fight = fight.from; j.loot = loot.from;
    if (fight.verdict === 'stalled') stalled = true;
    if (['progress', 'waiting'].includes(fight.verdict) || ['progress', 'waiting'].includes(loot.verdict)) waiting = true;
  }
  return stalled && !waiting;
}

export function readinessFailure(c: SharedConvoy, reason: string): boolean {
  return ['shared-prepare', 'travel'].includes(c.phase) && !reason.startsWith(READINESS_STALLED) &&
    preparationChanged(reason);
}

export function departureConfirmed(state: SharedState, c: SharedConvoy, now: number): boolean {
  return c.participants.every(name => c.completed.includes(name) || departed(state, c, name, now));
}

export function recoveryPlanner(c: SharedConvoy, reason: string): void {
  delete c.readinessStartedAt;
  if (/Stalled walking movement/i.test(reason)) c.walkingFailures = (c.walkingFailures || 0) + 1;
  if (/leave transition/i.test(reason)) c.avoidLeave = true;
  // A failure whose cause names the route itself (the planner's route rejected, unwalkable or
  // without a path) switches the walk to the native planner, and the choice holds through later
  // retries. A stall names no such cause, so it stays on the same planner; the ladder's other-route
  // rung (protocol/ladder.ts) switches planners once a retry made no progress. `walkingFailures`
  // records the walk's stalls and decides nothing.
  c.nativeFallback = !!c.nativeFallback || /route rejected|geometry|unwalkable|path not found|no path/i.test(reason);
}

/** Preparation drift is not evidence that the destination is unreachable. */
export function preparationChanged(reason: string): boolean {
  return !reason.includes(READINESS_STALLED) &&
    /Leader moved from planning origin|Route origin changed before departure|Cruise speed changed|Prepared shared route changed/.test(reason);
}

// Weak keys prevent completed/cancelled convoys from retaining routes. Never persist this store.
const routes = new WeakMap<SharedConvoy, SharedRoute>();
export const sharedRoute = (convoy: SharedConvoy): SharedRoute | undefined => {
  const route = routes.get(convoy);
  return route?.version === convoy.routeVersion ? route : undefined;
};
export function clearSharedRoute(convoy: SharedConvoy): void { routes.delete(convoy); }

function coordinate(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
export function readRoutePoint(input: unknown): RoutePoint | null {
  const p = requestObject(input);
  if (typeof p.map !== "string" || !/^[a-zA-Z0-9_]+$/.test(p.map)) return null;
  if (!coordinate(p.x) || !coordinate(p.y)) return null;
  if (p.in !== undefined && typeof p.in !== "string" && typeof p.in !== "number") return null;
  return { map: p.map, x: p.x, y: p.y, ...(p.in === undefined ? {} : { in: p.in }) };
}
function waypoint(input: unknown): RouteWaypoint | null {
  const p = requestObject(input), location = readRoutePoint(input);
  if (!location || (p.town && p.transport)) return null;
  if (!validFlags(p)) return null;
  if (!validLeave(p)) return null;
  if (!validMetadata(p)) return null;
  return withMetadata(p, { ...location, ...(p.town === true ? { town: true } : {}),
    ...(p.transport === true ? { transport: true, s: Number(p.s) } : {}) });
}
function validLeave(p: Record<string, unknown>): boolean {
  return p.method !== 'leave' || !(p.town || p.transport || p.s !== undefined || p.key !== undefined);
}
function validFlags(p: Record<string, unknown>): boolean {
  if ([p.town, p.transport].some(flag => flag !== undefined && typeof flag !== 'boolean')) return false;
  return !p.transport || Number.isInteger(p.s) && Number(p.s) >= 0;
}
function withMetadata(p: Record<string, unknown>, location: RouteWaypoint): RouteWaypoint {
  return { ...location,
    ...(typeof p.method === 'string' ? {method: p.method} : {}), ...(typeof p.key === 'string' ? {key: p.key} : {}) };
}
function validMetadata(p: Record<string, unknown>): boolean {
  if (p.method !== undefined && (typeof p.method !== 'string' || !['move', 'town', 'door', 'transport', 'leave'].includes(p.method))) return false;
  return p.key === undefined || typeof p.key === 'string' && p.key.length <= 100;
}
function parseRoute(input: unknown): SharedRoute | null {
  const data = requestObject(input), origin = readRoutePoint(data.origin), destination = readRoutePoint(data.destination);
  const geometry = requestObject(data.geometry);
  if (!validGeometry(geometry)) return null;
  if (!origin || !destination || !Array.isArray(data.plot) || data.plot.length > MAX_PLOT_STEPS) return null;
  if (JSON.stringify(input).length > 900000) return null;
  const plot = data.plot.map(waypoint);
  if (plot.some(p => !p)) return null;
  if (!["search", "remainder"].includes(String(data.source))) return null;
  return { engine: ['native','alclient','shared'].includes(String(data.engine)) ? String(data.engine) : 'shared', geometry: {version: Number(geometry.version), fingerprint: geometry.fingerprint}, version: Number(data.version), origin, destination, plot: plot as RouteWaypoint[], source: data.source as SharedRoute["source"] };
}
function validGeometry(g: Record<string, unknown>): g is {version: number; fingerprint: string} {
  return Number.isInteger(g.version) && typeof g.fingerprint === 'string' && g.fingerprint.length <= 100;
}
function currentOwner(state: SharedState, c: SharedConvoy, name: string, command: SharedCommand, now: number): boolean {
  const intent = state.navigationIntents?.[name], status = state.statuses[name];
  if (!status || !fresh(status.seenAt, now) || status.rip) return false;
  if (intent && (intent.revision !== command.navigationRevision || cancelEnds(c, intent))) return false;
  return runtimeMatches(state, c, name);
}
function runtimeMatches(state: SharedState, c: SharedConvoy, name: string): boolean {
  return characterRuntime(state.statuses[name]) === c.runtimes?.[name];
}
function routeIdentity(c: SharedConvoy, command: SharedCommand, body: Record<string, unknown>): boolean {
  if (c.id !== body.convoyId || c.epoch !== Number(body.epoch) || command.convoyId !== c.id) return false;
  const name = String(body.character);
  // The request body names the walk the way a report does.
  return sameWalkOn({...command, epoch: c.epoch}, {id: String(body.convoyId), epoch: Number(body.epoch), commandId: Number(body.commandId),
    navigationRevision: Number(body.navigationRevision), runtimeId: body.runtimeId as string}, c.runtimes?.[name]) &&
    c.routeVersion === Number(body.routeVersion);
}
export function routeOwner(state: SharedState, body: Record<string, unknown>, now: number): boolean {
  const c = state.activeConvoy, name = String(body.character), command = walkCommandOf(state, name);
  if (!c || !command || !c.participants.includes(name) || c.phase === "failed") return false;
  return currentOwner(state, c, name, command, now) && routeIdentity(c, command, body);
}
/** Ownership without liveness, so a delayed heartbeat is a wait, not cancellation. */
export function routeIdentityOwned(state: SharedState, body: Record<string, unknown>): boolean {
  const c=state.activeConvoy,name=String(body.character),command=walkCommandOf(state, name),intent=state.navigationIntents?.[name];
  if(!c || !command || !c.participants.includes(name) || c.phase==='failed')return false;
  if(!intentMatches(intent,command,c))return false;
  return runtimeMatches(state,c,name) && routeIdentity(c,command,body);
}
function intentMatches(intent: {revision:number;cancelled?:boolean}|undefined, command: SharedCommand, c: SharedConvoy): boolean {
  return !intent || intent.revision===command.navigationRevision && !cancelEnds(c, intent);
}
function validPublication(state: SharedState, c: SharedConvoy, route: SharedRoute | null): route is SharedRoute {
  const leader = state.statuses[c.leader];
  if (!route || route.version !== c.routeVersion || !leader || leader.moving) return false;
  // Queue A27: the leader plans from where it stands, anywhere inside the rendezvous range
  // (walk-client.ts sharedConvoyRendezvous), so the route starts at the leader.
  return distance(route.origin, leader) <= 1 && distance(route.origin, c.rally) <= RENDEZVOUS_RANGE &&
    contains(c.location, route.destination, 0, 1) && samePlace(route.origin, c.rally);
}
export function publishSharedRoute(state: SharedState, body: Record<string, unknown>, now: number): string | null {
  const c = state.activeConvoy;
  if (!routeOwner(state, body, now) || body.character !== c!.leader || c!.phase !== "shared-prepare") return "stale route publisher";
  const route = parseRoute(body.route);
  if (!validPublication(state, c!, route)) return "invalid route or changed origin/destination";
  // A farming-zone destination can resolve to a different entry point. The client
  // retains its authorized area; only the current leader may resolve that point.
  const old = sharedRoute(c!);
  if (old && JSON.stringify(old) !== JSON.stringify(route)) return "route version already published";
  routes.set(c!, structuredClone(route));
  c!.routePublishedAt ??= now;
  return null;
}
export function sharedArrivalReady(state: SharedState, now: number): boolean {
  const c = state.activeConvoy;
  if (!c) return false;
  return c.participants.every(name => {
    const status = state.statuses[name];
    if (!arrivalStatus(status, now) || !arrivalOwned(state, c, name)) return false;
    if (c.completed.includes(name)) return true;
    if (!reportMatches(state, name)) return false;
    if (status.convoyNavigation?.phase !== "arrived" || status.convoyNavigation.routeVersion !== c.routeVersion) return false;
    return arrivedPosition(c, status);
  });
}

/** Terminal return holds may finish from current physical arrival, never from
 * the stale movement failure's position or a superseded command. */
export function heldReturnArrivalReady(state: SharedState, c: SharedConvoy, now: number): boolean {
  if (!c.participants.length || c.merchantInterruption || c.communicationHold) return false;
  if (state.escape && state.escape.stage !== 'released') return false;
  return c.participants.every(name => {
    const status = state.statuses[name], command = state.commands[name];
    if (!arrivalStatus(status, now) || status.transporting || !heldArrivalOwned(state, c, name)) return false;
    return command?.phase === 'hold' && command.routeVersion === c.routeVersion && arrivedPosition(c, status);
  });
}

function heldArrivalOwned(state: SharedState, c: SharedConvoy, name: string): boolean {
  const status = state.statuses[name]!, command = walkCommandOf(state, name), report = status.convoyNavigation;
  const expected = c.expected?.[name];
  if (!command || !report || !expected || report.phase !== 'failed') return false;
  if (status.server !== c.routeServer || !intentMatches(state.navigationIntents?.[name], command, c)) return false;
  return heldReportMatches(c, command, report, expected) && currentHeldRuntime(status);
}

function currentHeldRuntime(status: NonNullable<SharedState['statuses'][string]>): boolean {
  const runtime = status.convoyNavigation?.runtimeId;
  return !!runtime && characterRuntime(status) === runtime;
}

function heldReportMatches(c: SharedConvoy, command: SharedCommand,
  report: NonNullable<SharedState['statuses'][string]>['convoyNavigation'] & {},
  expected: NonNullable<SharedConvoy['expected']>[string]): boolean {
  // A hold installs no route (clients report routeVersion=0). Its fresh command
  // acknowledgment is authoritative, including holds reissued after restart.
  return command.convoyId === c.id && command.epoch === c.epoch && command.id === expected.commandId &&
    sameWalk(command, report) && expected.revision === command.navigationRevision &&
    (!expected.runtimeId || expected.runtimeId === report.runtimeId);
}

function arrivalStatus(s: SharedState['statuses'][string], now: number): s is NonNullable<SharedState['statuses'][string]> {
  return !!s && !s.rip && s.hp !== 0 && !s.moving && fresh(s.seenAt, now);
}
function arrivalOwned(state: SharedState, c: SharedConvoy, name: string): boolean {
  const status = state.statuses[name]!, intent = state.navigationIntents?.[name];
  if (status.server !== c.routeServer || characterRuntime(status) !== c.runtimes?.[name]) return false;
  return !intent || !cancelEnds(c, intent) && intent.revision === c.expected?.[name]?.revision;
}
function arrivedPosition(c: SharedConvoy, status: SharedStatus): boolean {
  if (c.purpose === 'monster-hunt' && !samePlace(c.location, status)) return false;
  if (c.purpose === 'monster-hunt' && c.huntTarget) {
    const destination = sharedRoute(c)?.destination;
    return !!destination && samePlace(destination, status) &&
      Math.hypot(status.x - destination.x, status.y - destination.y) <= HUNT_TARGET_ARRIVAL;
  }
  return c.purpose === 'franky-exit' ? status.map === 'main' : contains(c.location, status, 0, AREA_ARRIVAL_MARGIN);
}
