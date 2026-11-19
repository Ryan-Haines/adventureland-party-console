import type { MovementKind, MovementRequest } from '../protocol/records.ts';
import { TIERS, ADDON_TIERS, type Tier } from '../protocol/ranks.ts';
import type { GMap, MapKey } from 'typed-adventureland';
import type { Point } from './geometry/contracts.ts';
import { ARRIVAL_TOLERANCE } from '../protocol/ladder.ts';
import { PATROL_WALK, RARE_WALK } from '../hunting/api.ts';
// The movement rule table and the tiers of the one rank table. One module ranks every
// request, so the character owner and the coordinator's walk replacement
// (runtime/movement/coordinator/walk.ts `replaces`) rank the same pair the same way.

export type Requester = Pick<MovementRequest, 'kind'> & Partial<Pick<MovementRequest, 'owner' | 'tier' | 'label'>>;
// The movement columns of the table, one row per kind.
interface Row {
  // A fixed tier, or the tiers a task's walk or an add-on may name, highest first.
  tier?: Tier; tiers?: readonly Tier[];
  // "meets higher": a group walk or errand waits for the holder to end.
  waits?: boolean;
  // A request of the same kind may also stop the row's journey (the Stop column).
  stoppedBySameKind?: boolean;
  // The Steps column. `journey` lends the journey to steps but not a hold: a Town hold is
  // its cast, and the server's move handler clears the channel. `hold` lends a
  // hold but not the journey: a walk's member that stands for one of the walk's phases
  // defends itself, and a step on the walk's route would leave its shared route.
  steps: 'yes' | 'no' | 'journey' | 'hold';
  // The click column (queue C1 and its step 12 follow-up): `replaces`, a click ends the row's
  // journey or hold as the player's newer command; `waits`, the row waits for the click to hand
  // back; `ranks`, the click ranks against it as `manual`. A row with tiers may name it per tier.
  click?: Click | Partial<Record<Tier, Click>>;
  // The band its sends ask the call budget: an escape's sends never wait behind jobs.
  band?: 'survival';
}
type Click = 'replaces' | 'waits' | 'ranks';
const TASK_TIERS = ['event-attendance', 'hunt-turn-in', 'event-return', 'rare', 'hunt-mission', 'addon-task', 'farming'] as const;
const rows: Record<string, Row> = {
  escape: { tier: 'escape', stoppedBySameKind: true, steps: 'no', band: 'survival' },
  'death-recovery': { tier: 'death-recovery', steps: 'yes' },
  cave: { tier: 'cave', stoppedBySameKind: true, steps: 'yes' },
  lifecycle: { tier: 'lifecycle', stoppedBySameKind: true, steps: 'no' },
  town: { tier: 'town', steps: 'journey', click: 'waits' },
  manual: { tier: 'manual', steps: 'yes', click: 'replaces' },
  // An app key's command is `manual`'s row at tier `app` (74), so it meets the player's own
  // command as a higher one and never ends it (00-overview "Apps that talk to the console").
  app: { tier: 'app', steps: 'yes', click: 'replaces' },
  // A dashboard party travel is a group walk at `manual` (00-overview "The rank table",
  // party travel note), or at `app` when an app key sent it. Its standing phases lend
  // steps.
  'group-walk': { tiers: ['manual', 'app', ...TASK_TIERS], waits: true, steps: 'hold', click: { manual: 'replaces', app: 'replaces' } },
  errand: { tier: 'errand', waits: true, steps: 'no' },
  'task-walk': { tiers: TASK_TIERS, steps: 'yes' },
  formation: { tier: 'formation', steps: 'yes' },
  approach: { tier: 'approach', steps: 'yes' },
  follow: { tier: 'follow', steps: 'yes' },
  addon: { tiers: ADDON_TIERS, steps: 'yes' },
};

function row(kind: MovementKind): Row {
  return rows[kind.startsWith('addon:') ? 'addon' : kind];
}

// The request table's click column for a request: what a player's click does against it.
export function clickRule(request: Requester): Click {
  const click = row(request.kind).click;
  return typeof click === 'string' ? click : click?.[tierOf(request).tier] ?? 'ranks';
}

// The request table's band column and the band table: the band every send of a request asks. A send with no request is a
// job's.
export function sendBand(request: Requester | undefined): 'survival' | 'job' {
  return request && row(request.kind).band || 'job';
}
// The request table's band for a stop and a combat step (R1.2 the request table `band`: "every stop and combat step survival"):
// each one is the character's own safety, so it never waits behind a job.
export const STOP_AND_STEP_BAND = 'survival';
// A walk a member shows moving across two of its reports has stalled when it moved less than this
// between them (R2F3): the executor's report stall (executor.ts `reported`), and the event exit's
// walk (the events owner's exit.ts) asks the same.
export const REPORT_STALL_DISTANCE = 2;

// The mover table, the movers: the core movers in the current console's order, run once per movement tick,
// each with its tier. `positions` marks the two positioning steps inside a core mover, where
// an add-on of the same tier places the character first. The movement tick (movers.ts) runs
// them in this order and the core registration (hooks/core.ts) declares them from this list;
// add-on movers sit between them by tier (registry.ts `before`).
export const MOVERS: readonly { name: string; tier: Tier; positions?: true }[] = [
  { name: 'event-return-combat', tier: 'event-return' },
  { name: 'franky-approach', tier: 'event-attendance', positions: true },
  { name: 'rare-hunting', tier: 'rare' },
  { name: 'grouped-regroup', tier: 'formation' },
  { name: 'grouped-target-formation', tier: 'formation', positions: true },
  { name: 'farm-approach-recovery', tier: 'approach' },
  { name: 'cave-recovery', tier: 'cave' },
  { name: 'idle-formation', tier: 'formation' },
  { name: 'target-formation', tier: 'formation' },
  { name: 'kite-and-approach', tier: 'approach' },
];
// A point return's arrival distance: every point return retires at the physical arrival distance
// v1.5.0 gave the Halloween returns. v1.5.0's 180 for the other returns released a return walk 100
// to 180 units short of its checkpoint, where the member stayed (live-event-pretravel graveyard).
// Shaped farming areas use their own boundaries.
export const RETURN_ARRIVAL_RADIUS = 100; // runtime/coordinator/navigation/halloween-return-arrival.ts:5
// The movement tick's period: v1.5.0's role runner tick
// (runtime/characters/roles/runner.ts:339), kept as R1.4's "Movement loops per tick" row keeps it.
// Appendix C's class B names it the cadence of a local retry. It stays a decided loop cadence, and
// the end run measures the walk request rate at it.
export const MOVEMENT_TICK_MS = 100;
// Movement's character picks (R2F4). No screen shows them and no player chooses one, so each is a named pick and none
// is a saved setting (as every character-side hidden pick is). No game fact or progress rule gives these numbers, so
// each keeps v1.5.0's value.
export const MOVEMENT_PICKS = {
  // The planning budget of one rejected walking segment's repair (character/owner.ts).
  movementRepairMs: 3000,
  // One sight search: its time and its steps (steps.ts `createSightRecovery`).
  movementSightSearchMs: 8000,
  movementSightSteps: 6,
  // Kept safety bounds on a crossing's reply (the numbers rule, bigcheck/bounds.md). The game settles
  // a transport, leave or Town promise only on its reply (common_functions.js `push_deferred` has no
  // timeout), so a reply lost on the network holds the crossing. Each ends the crossing timed out and
  // tells the status owner's bound record. None has a measurement yet, so each keeps v1.5.0's value,
  // and the end run measures the real reply time and sets it. The transport's 10 s is the Cave
  // stairs'; the Goo Brawl exit's transport waited 6 s.
  crossingTransportBoundMs: 10000,
  // The Goo Brawl exit's leave.
  crossingLeaveBoundMs: 6000,
  // The return's and the Goo Brawl exit's Town casts.
  crossingTownBoundMs: 12000,
};
// The planner pool's memory bounds against the coordinator process running out of memory, kept
// from an earlier build planner-service.ts:46 and:62. Each worker holds one prepared game
// geometry, and each worker's pending map holds the plans it has not answered. A full pool or
// queue reports through boundFired, and the member plans natively.
export const PLANNER_POOL_SIZE = 3;
export const PLANNER_QUEUE_CAP = 32;
// A kept bound against the game's native planner stalling (planner.ts `expired`): a search past its
// budget goes on while its frontier (`host.start`) advanced within this window, and a search that
// stops advancing ends and tells the status owner's bound record as `nativeFrontierWindowMs`. No
// game data names the window; it keeps v1.5.0's value (audit 6-32) until the end run
// measures a search.
export const NATIVE_FRONTIER_WINDOW_MS = 15000;
// A kept bound against a member's runtime reload that never lands (the reload's loader fetch
// fails, or a reply carrying the signal never reaches the member): the geometry repair fails as
// `geometry-mismatch` once this long has passed since it started, and tells the status owner's
// bound record as GEOMETRY_REPAIR_DEADLINE_MS. The value is v1.5.0's, restored by
// 02-2's answer A.
export const GEOMETRY_REPAIR_DEADLINE_MS = 60000; // runtime/coordinator/navigation/shared-navigation.ts:274
// The door detour's CPU bound on the character's turn (geometry/door-detour.ts): the earlier
// console's 2048 grid expansions. A search that ends on it reports through boundFired, so a cut
// search shows in the bound record apart from a door with no reachable approach.
export const DOOR_DETOUR_EXPANSIONS = 2048;
// The shared walk's arrival radii (route-store.ts): a Hunt walk arrives within HUNT_TARGET_ARRIVAL
// of its route's end, and an area walk inside the area or within AREA_ARRIVAL_MARGIN of its edge.
export const HUNT_TARGET_ARRIVAL = 50; // runtime/coordinator/navigation/shared-route-store.ts:171
export const AREA_ARRIVAL_MARGIN = 100; // runtime/coordinator/navigation/shared-route-store.ts:173

// The owner that asked a request of each tier, for a walk's notices and a member's `commandHold`:
// survival (05) for the escape, events (06) for the event tiers, the merchant (08) for an errand,
// movement (02) for the player's `manual`, and groups and tasks (01) for every task walk.
export function ownerOfTier(tier: string | undefined): string {
  if (tier === 'escape') return '05';
  if (tier === 'event-attendance' || tier === 'event-return') return '06';
  if (tier === 'manual') return '02';
  return tier === 'errand' ? '08' : '01';
}

// The tier a request ranks at: its row's own, or the one it names among its row's tiers. A
// walk or add-on that names no tier of its row breaks the request protocol (requesters name
// tiers, 00-overview "The rank table"), and the owner records the error. An add-on's tier
// comes from its registration, which the hook registry refuses at load above `manual`
// (runtime/hooks/registry.ts), so no request needs a clamp here.
export function tierOf(request: Requester): { tier: Tier } {
  const r = row(request.kind), named = request.tier;
  if (r.tier) return { tier: r.tier };
  if (named && r.tiers!.includes(named)) return { tier: named };
  throw Error(`${request.kind} request ${request.owner ?? ''} names no tier of its row: ${String(named)}`);
}

const rankOf = (request: Requester): number => TIERS[tierOf(request).tier].rank;

export type RuleDecision =
  | { decision: 'granted'; interrupted?: 'cancel' | 'wait' }
  // The live request has the same owner identity; the owner compares destinations (§ 2.2, § 2.3).
  | { decision: 'same-owner' }
  | { decision: 'waiting' }
  | { decision: 'refused' };

export function decide(live: Requester | undefined, incoming: Requester): RuleDecision {
  if (!live) return { decision: 'granted' };
  if (incoming.owner && incoming.owner === live.owner) return { decision: 'same-owner' };
  // The Player command column.
  const held = tierOf(live).tier;
  if (tierOf(incoming).tier === 'manual' && TIERS[held].player === 'ends') return { decision: 'granted', interrupted: 'cancel' };
  if (rankOf(incoming) > rankOf(live))
    return { decision: 'granted', interrupted: incoming.kind === 'group-walk' && row(live.kind).waits ? 'wait' : 'cancel' };
  return { decision: row(incoming.kind).waits ? 'waiting' : 'refused' };
}

// Queue A2: the holder, escape and death recovery may stop a journey, plus the row's
// own addition (the Cave runtime, the lifecycle owner, escape release).
function mayStop(live: Requester, stopper: Requester): boolean {
  if (stopper.owner && stopper.owner === live.owner) return true;
  if (stopper.kind === 'escape' || stopper.kind === 'death-recovery') return true;
  return !!row(live.kind).stoppedBySameKind && stopper.kind === live.kind;
}

// A caller that clears movement before its own request marks its stop as a takeover.
export type Stopper = Requester & { takeover?: boolean };

// The stop rule in one call: `stop` ends the journey by the stop rule above, `takeover`
// ends it as a replacement by a higher request (rule 1), and `refused` leaves it alone.
export function judgeStop(live: Requester, stopper: Stopper): 'stop' | 'takeover' | 'refused' {
  if (mayStop(live, stopper)) return 'stop';
  if (!stopper.takeover) return 'refused';
  return decide(live, stopper).decision === 'granted' ? 'takeover' : 'refused';
}

// Design § 2.4 rule 1: a combat step may pause the live journey, or borrow the character
// from a hold, when its row's Steps column allows it.
export function stepAllowed(live: Requester | undefined, hold = false): boolean {
  if (!live) return true;
  const steps = row(live.kind).steps;
  return steps === 'yes' || steps === 'journey' && !hold || steps === 'hold' && hold;
}

// A coordinator walk as a requester (design § 5.1): the coordinator ranks it against the
// group's active walk with the table above. `task` names the task that starts the walk, so
// the same task asking again replaces its own walk. A survival walk and party Town's walk
// to the landing keep their own rows.
export function walkRequester(task: string, tier: Tier): Requester & { owner: string; tier: Tier } {
  return { kind: tier === 'escape' || tier === 'death-recovery' || tier === 'town' ? tier : 'group-walk', owner: task, tier };
}

// Spawns widen to number arrays because the planner's game data types them so
// (contracts.ts NavigationMap); the coordinator reads its goal from that copy.
type RespawnMap = Partial<Pick<GMap, 'on_death'>> & { spawns: readonly (readonly number[])[] };
export interface SafeGoal { goal: 'death' | 'town'; map: string; x: number; y: number; radius: number; spawn: number }
// The arrival distance lives in the protocol (protocol/ladder.ts), which the task round reads too.
export { ARRIVAL_TOLERANCE };

// The `death` row of the movement owner's safe table, with queue A6 and A29 applied:
// the party regroups where the game itself respawns a character, read from game
// data. Escape and death recovery read the same goal, so neither accepts a place the
// other waits past. node/server.js `respawn` sends a character to
// `G.maps[map].on_death`, then to the start map's `on_death`, then to Main spawn 0.
// A6 keeps the regroup in Main, so a respawn point on another map (the Crypt's Cave,
// the Spider Den's Gateway) gives way to Main's own respawn point.
export function deathGoal(maps: Partial<Record<string, RespawnMap>>, map: string | undefined): SafeGoal | null {
  const main = maps.main;
  if (!main) return null;
  const place = [map ? maps[map]?.on_death : undefined, main.on_death].find(entry => entry?.[0] === 'main') ?? ['main' as MapKey, 0];
  const index = main.spawns[place[1]] ? place[1] : 0, spawn = main.spawns[index];
  if (!spawn) return null;
  return { goal: 'death', map: 'main', x: spawn[0], y: spawn[1], spawn: index, radius: landingRadius(spawn) };
}

// transport_player_to scatters a landing by up to half the spawn's size on each axis.
function landingRadius(spawn: readonly number[]): number {
  const scatter = Number(spawn[3]) || 0;
  return Math.max(ARRIVAL_TOLERANCE, Math.hypot(scatter / 2, scatter / 2));
}

// The `town`, `map-exit` and `anniversary` rows of the safe table with queue A29
// applied: a finished Town cast lands on spawn 0 of the caster's map (node/server.js
// "town" condition end, `transport_player_to(player, player.in)`). Party Town and the
// anniversary ask for Main; the return exit cast asks for the current map.
export function townGoal(maps: Partial<Record<string, RespawnMap>>, map: string): SafeGoal | null {
  const spawn = maps[map]?.spawns[0];
  if (!spawn) return null;
  return { goal: 'town', map, x: spawn[0], y: spawn[1], spawn: 0, radius: landingRadius(spawn) };
}

export function isSafeAt(goal: SafeGoal, at: Pick<Point, 'map' | 'in' | 'x' | 'y'>): boolean {
  return at.map === goal.map && String(at.in ?? at.map) === goal.map &&
    Math.hypot(at.x - goal.x, at.y - goal.y) <= goal.radius;
}

// How far a member falls behind its leader, or under Follows me behind the character on Manual,
// before the follow walks it (followLeaderIfFar(150)).
export const FOLLOW_DISTANCE = 150;

// The follow's event rule (appendix A2 RANK `followLeavesCurrentEvent`): a follower that reached
// the active combat event's map before its leader stays for the fight, so the follow leaves that
// map only for its leader on the same map. `mapEvent` is the game's event name for `map`.
export function followLeavesCurrentEvent(event: { name: string } | null | undefined, destination: { map: string } | null | undefined,
  map: string, mapEvent: string | undefined): boolean {
  return !!(event && destination && destination.map !== map && mapEvent === event.name);
}

// A return's coordinator refusal (appendix A2 RANK `returnWorkflowSuperseded`): the coordinator
// refuses a superseded return's phase with 409 "return workflow superseded", and the Town return
// ends on that answer.
export function returnWorkflowSuperseded(error: unknown): boolean {
  const context = (error as { partyRequest?: { path?: string; status?: number; reason?: string } } | null)?.partyRequest;
  return !!context && context.path === "/return-progress" && context.status === 409 &&
    context.reason === "return workflow superseded";
}

// Event travel's hold (appendix A2 RANK `eventTravelAllowed`, `preemptConvoyForAnniversary`): the Hunt
// hand-in and a group walk the coordinator marked non-preemptible both outrank event travel, so
// neither travels on the events owner's admission nor gives way to an anniversary.
export function eventTravelHeld(handIn: boolean, walk: WalkFlags | null): boolean {
  return handIn || !preemptible(walk);
}

// The request table, who wins against a walk. The walk's request builder sets `navigationExempt` (franky-exit,
// escape-recovery, manual commands, shared-walk-return) and `nonPreemptible` (the Hunt's `returning` walk,
// hunting/coordinator/hunt.ts `configure`); these rules are the only places movement reads them (copy check
// R7).
export interface WalkFlags { navigationExempt?: unknown; nonPreemptible?: unknown; continuousReturn?: unknown; returnWalking?: unknown; purpose?: unknown;
  addonFlags?: AddonWalkFlags | null }
// P3 `walk.flags`: the add-ons' merged answer for a group walk, which the walk keeps from its start
// (movement/coordinator/walk.ts `formWalk`) and carries in each member's command.
export interface AddonWalkFlags { depart?: 'hold' | 'go'; defence?: 'pause' | 'walk-on' }
// Whether the character's walk holds its combat turn, which turns' the request table rows O6 and O16 read.
// `group` is a group walk that is not paused for a defence holding the turn: a continuous return,
// or a Hunt walk to its target. `walking` is any walk the character is on that holds it: a forced
// or Town walk, Town itself, a group walk that is not paused for a defence, or a follow.
export type CombatHold = 'group' | 'walking' | null;
export function combatHold(travel: { defensePaused?: unknown; continuousReturn?: unknown; purpose?: unknown; huntTarget?: unknown } | null | undefined,
  state: { forceTraveling?: unknown; townTraveling?: unknown; townActive?: unknown; following?: unknown }): CombatHold {
  const walk = !!travel && !travel.defensePaused;
  if (walk && (travel.continuousReturn === 1 || travel.purpose === 'monster-hunt' && !!travel.huntTarget)) return 'group';
  return walk || state.forceTraveling || state.townTraveling || state.townActive || state.following ? 'walking' : null;
}
// The player's cancel: a cancelled navigation intent ends every walk except an exempt one.
export function cancelEnds(walk: WalkFlags, intent: { cancelled?: unknown } | null | undefined): boolean {
  return !!intent?.cancelled && !walk.navigationExempt;
}
// A preempting request (a merchant interruption, event travel, an event's take-over): the Hunt's
// return walk outranks each of them.
export function preemptible(walk: WalkFlags | null | undefined): boolean {
  return !walk?.nonPreemptible;
}
// An event walk's take-over of a shared walk: neither an exempt walk nor the Hunt's return gives way.
export function eventMayTake(walk: WalkFlags): boolean {
  return !walk.navigationExempt && preemptible(walk);
}
// A local attacker pausing a walk for its defence: continuous returns and the purposes below walk
// on, and so does an exempt walk except the anniversary return (v1.5.0 shared.js
// `coldConvoyDefenseAllowed`, `interruptConvoyForDefense`). The rare and patrol walks are the
// hunting owner's (hunting/rules.ts RARE_WALK, PATROL_WALK), read at each call.
const unpaused = (purpose: unknown): boolean => ['escape-recovery', 'franky-exit', 'event-return', RARE_WALK, PATROL_WALK].includes(purpose as string);
// An exempt walk keeps walking through a defence, except the anniversary return.
export function exemptWalk(walk: WalkFlags): boolean {
  if (walk.addonFlags?.defence) return walk.addonFlags.defence === 'walk-on';
  return !!walk.navigationExempt && walk.purpose !== 'anniversary-return';
}
export function defensePauses(walk: WalkFlags): boolean {
  if (walk.addonFlags?.defence) return walk.addonFlags.defence === 'pause';
  if (walk.continuousReturn === 1 || walk.returnWalking) return false;
  if (exemptWalk(walk)) return false;
  return !unpaused(walk.purpose);
}

// The farm walk after a death (appendix A2 RANK `farmWalkHeld`, design 13.1 G11): a request other
// than the death recovery's own holds the character at a rank the farm walk does not take over, so
// the reunion leaves it alone. The convoy, the shared walk and the event return all hold ranked
// requests, so the live request stands for their flags.
const FARM_RETURN: Requester = { kind: 'task-walk', owner: 'reunion:after-death', tier: 'farming' };
export function farmWalkHeld(live: Requester | null | undefined, recoveryOwner: string): boolean {
  return !!live && live.owner !== recoveryOwner && decide(live, FARM_RETURN).decision !== 'granted';
}

// The request table's `departure` column for walk rows: every walk waits for its chests except the escape, which
// departs `now` with its fight and chests left. `loot` leaves the fight and waits for the chests: the
// Hunt's return and the other continuous returns (`continuousReturn`), the Hunt's travel to a target
// (`huntTarget`) and the event exit (`franky-exit` marked `navigationExempt` without the combat
// handoff). `after-loot` waits for both. `fight` waits for the fight and leaves the chests: an add-on's
// `walk.flags` `go`, which never leaves a member a monster is attacking. An add-on's `hold` waits for
// both. The step barrier, the executor's loot wait and the coordinator's readiness read it.
export type Departure = 'now' | 'loot' | 'after-loot' | 'fight';
export interface DepartureWalk { continuousReturn?: unknown; huntTarget?: unknown; purpose?: unknown; navigationExempt?: unknown; combatHandoffAllowed?: unknown;
  addonFlags?: AddonWalkFlags | null }
export function walkDeparture(walk: DepartureWalk): Departure {
  if (walk.purpose === 'escape-recovery') return 'now';
  if (walk.addonFlags?.depart) return walk.addonFlags.depart === 'hold' ? 'after-loot' : 'fight';
  if (walk.continuousReturn === 1 || walk.huntTarget) return 'loot';
  return walk.purpose === 'franky-exit' && walk.navigationExempt === true && walk.combatHandoffAllowed === false ? 'loot' : 'after-loot';
}

// The walk phase table `ready` (R2F2, Recheck 3 R3-S1): a member's departure waits on its fight and its
// loot. Progress is the summed HP of its attackers or its eligible chest count falling below the
// sample the wait judges from; a kill counts as a fall, and a new attacker's HP keeps the sample, so
// a farm that feeds attackers faster than the party kills them shows no fall. The wait stalls when
// its window passes with neither falling: the longer of the member's attack period from the game
// (`1000 / character.frequency`) and two of its report intervals, so a slow attacker is not judged
// between two of its hits. Coordinator and character judge with this one rule.
export interface DepartureSample { at: number; attackersHp: number; chests: number }
export type DepartureVerdict = 'clear' | 'progress' | 'waiting' | 'stalled';
// Whether a departure waits for the member's fight, and for its chests.
export const departureWaitsFight = (departure: Departure): boolean => departure === 'after-loot' || departure === 'fight';
export const departureWaitsLoot = (departure: Departure): boolean => departure === 'loot' || departure === 'after-loot';
export function departureWindow(attackPeriodMs: unknown, reportIntervalMs: unknown): number {
  return Math.max(Number(attackPeriodMs) || 0, 2 * (Number(reportIntervalMs) || 0));
}
export function departureStep(from: DepartureSample | undefined, sample: DepartureSample, windowMs: number):
  { from: DepartureSample | undefined; verdict: DepartureVerdict } {
  if (sample.attackersHp <= 0 && sample.chests <= 0) return { from: undefined, verdict: 'clear' };
  if (!from || sample.attackersHp < from.attackersHp || sample.chests < from.chests) return { from: sample, verdict: from ? 'progress' : 'waiting' };
  return { from, verdict: sample.at - from.at >= windowMs ? 'stalled' : 'waiting' };
}
// The summed HP of a member's attackers, from the game's monster entries (`hp`).
export function attackersHp(attackers: readonly { hp?: unknown }[] | null | undefined): number {
  return (attackers || []).reduce((sum, a) => sum + Math.max(0, Number(a.hp) || 0), 0);
}

// The game's slowest walk speed: the server raises every speed to it after the cruise cap
// (node/server.js:1794 at the pinned game, `round(max(5, player.speed))`).
export const GAME_MIN_SPEED = 5;
// The walk's cruise pace: a member is paced when the speed the game reports for it is the speed the
// game gives a walker capped at the pace. The server takes the cap as parseInt(speed) and reports
// round(max(5, min(speed, cap))) (node/server.js:5663:1793-1794 at an earlier build), so a capped
// member reports a whole number and a fractional pace reports below itself. A member above it (no
// cap yet) is not paced. The pace is the slowest member's base speed, which leaves out terrain, so a
// member below the cap with no speed condition on it (`slowed` false) runs at its own speed there
// (Winterland's snow) and is paced. A member a condition slows (Hard Shell, a slow) is not, so the
// walk waits for it; a caller that does not know reads it as slowed. Coordinator and character judge
// with this rule.
export function cruisePaced(speed: unknown, pace: number, slowed = true): boolean {
  if (!(pace > 0)) return false;
  const cap = Math.round(Math.max(GAME_MIN_SPEED, Math.trunc(pace))), reported = Number(speed);
  return reported === cap || !slowed && reported >= GAME_MIN_SPEED && reported < cap;
}
// Whether a member's report names a condition that changes its speed: the game data's `speed` or
// `set_speed` on the condition, or a live `speed` on its instance.
export function reportSlowed(conditions: readonly { definition?: { speed?: unknown; set_speed?: unknown } | null; live?: { speed?: unknown } | null }[] | null | undefined): boolean {
  return (conditions || []).some(c => !!(Number(c?.definition?.speed) || Number(c?.definition?.set_speed) || Number(c?.live?.speed)));
}

// Whether a group walk holds this member (appendix A2 RANK `convoyActive`): the member runs one,
// or the coordinator's status says one is active before the member has taken it.
export function groupWalkActive(walk: unknown, coordinatorActive: boolean): boolean {
  return !!walk || coordinatorActive;
}

// The card line's words for movement's requests. The walk phases in which the members gather
// before the walk leaves (coordinator/walk.ts).
const GATHERING = new Set(['assemble', 'rendezvous', 'shared-prepare', 'shared-hold', 'hold', 'communication-hold', 'observing']);
// The walk purpose table: whether a walk of the purpose takes the party to a farm, which the card's
// farm line names, and whether it hands combat over to farming on the way, which the travel defense,
// the walk client's handoff and targeting's hand-off check read, and whether the hunting owner's
// farm recovery takes a failed walk of the purpose up again (hunting/coordinator/farm.ts
// recoverFailed), and whether the player started it (`manual`): such a walk ranks at the manual tier
// (coordinator/walk.ts walkTier) and begins the leader's manual hold (tasks/coordinator/install.ts
// startWalk). A purpose with no row (rares, events, escapes) does none of these. The no-purpose walk
// is the farm walk.
const PURPOSES: Readonly<Record<string, { farm: boolean; handsCombat: boolean; recovers: boolean; manual?: true }>> = {
  '': { farm: true, handsCombat: true, recovers: true },
  'party-travel': { farm: false, handsCombat: true, recovers: false, manual: true },
  'party-force-travel': { farm: false, handsCombat: false, recovers: false, manual: true },
  'farm-relocation': { farm: true, handsCombat: true, recovers: true },
  'manual-monster-override': { farm: true, handsCombat: true, recovers: false, manual: true },
  'empty-spawn-recovery': { farm: true, handsCombat: true, recovers: true },
  'grouped-approach': { farm: true, handsCombat: false, recovers: false },
  'hunt-fallback': { farm: true, handsCombat: false, recovers: false },
  'monster-hunt': { farm: false, handsCombat: false, recovers: true },
};
const purposeRow = (purpose: string | null | undefined) => Object.hasOwn(PURPOSES, purpose ?? '') ? PURPOSES[purpose ?? ''] : undefined;
export const goesToFarm = (purpose: string | null | undefined): boolean => purposeRow(purpose)?.farm === true;
// An add-on's walk (`addon:<name>`) has no row: its `walk.request` answer's `handsCombat` decides.
// The walk carries that answer as `combatHandoffAllowed`, so a reader on the character hands it in
// as `addonHands`. The defence pause (`defensePauses`) stays core for every walk.
export const handsCombatOver = (purpose: string | null | undefined, addonHands?: boolean): boolean =>
  purpose?.startsWith('addon:') ? addonHands === true : purposeRow(purpose)?.handsCombat === true;
export const farmRecovers = (purpose: string | null | undefined): boolean => purposeRow(purpose)?.recovers === true;
export const playerWalk = (purpose: string | null | undefined): boolean => purposeRow(purpose)?.manual === true;
const PARTY_TRAVEL = new Set(['party-travel', 'party-force-travel']);
export interface CardWalk { phase: string; purpose: string | null; label?: string; location?: { label?: string }; requester?: { tier?: string; by?: string };
  walkingActivity?: string; ladderTrying?: string }
// The player's click: the countdown counts whole seconds left, and a click that broke the console's
// Town cast says the cast comes again (user, 2026-10-29).
export function clickLabel(click: { walking?: boolean; remainingMs?: number | null; town?: string }): string {
  return click.walking ? (click.town ? 'Your click - Town interrupted' : 'Your click')
    : `Your click - ${click.town ? 'casting Town again' : 'taking over'} in ${Math.ceil(Math.max(0, Number(click.remainingMs) || 0) / 1000)} s`;
}
// A climber reads "<activity> - <trying>" while it serves the walk.
export const climbLabel = (climb: { activity: string; trying?: string | null }): string =>
  climb.trying ? `${climb.activity} - ${climb.trying}` : climb.activity;
const CHARACTER_TRAVEL_LABEL = 'Character travel - Travelling to the chosen spot';
// A walk the player or an app gave the party, or null for a walk of a group task. The player's walk
// to a farm reads as the farm task's walk. An app's walk always names the app, its farm walk too
// (12 table K5: every change an app makes names the app).
export function partyTravelLabel(walk: CardWalk): string | null {
  const tier = walk.requester?.tier;
  if (!(PARTY_TRAVEL.has(walk.purpose ?? '') || tier === 'app' || tier === 'manual' && !goesToFarm(walk.purpose))) return null;
  const where = walk.location?.label || walk.label;
  // An app key's walk names the app.
  const travel = tier === 'app' ? `Party travel by ${appName(walk.requester?.by)}` : 'Party travel';
  return GATHERING.has(walk.phase) ? `${travel} - regrouping for travel to ${where}${walk.ladderTrying ? ` - ${walk.ladderTrying}` : ''}` : `${travel} - Travelling to ${where}`;
}
// The app's own name from a caller's `app:<name>`.
const appName = (by: string | undefined) => by?.startsWith('app:') ? by.slice(4) : 'an app';
const townLabel = (journey: boolean): string => journey ? 'Travelling to Main - Town' : 'Casting Town';
// The card words `movement.live()` carries for the request that holds movement (the status owner's
// table L8). Town reads its walk or its cast, the player's character travel reads while it walks,
// and any other request reads the label its requester gave it (the lifecycle owner's lifecycle
// walk).
export function heldLabel(held: { kind: string; label?: string; owner?: string }, journey: boolean): string | undefined {
  if (held.kind === 'town') return townLabel(journey);
  if (held.kind === 'manual') return journey ? CHARACTER_TRAVEL_LABEL : undefined;
  // An app key's character travel names the app; its owner is the app's caller.
  if (held.kind === 'app') return journey ? `${CHARACTER_TRAVEL_LABEL} by ${appName(held.owner)}` : undefined;
  return held.label;
}
// A task's walk: while its members gather it names what the walk tries after a failure.
export function walkLabel(walk: CardWalk | null, purpose: string, travelling: string): string {
  return walk && GATHERING.has(walk.phase) ? `Regrouping for travel - ${purpose}${walk.ladderTrying ? ` - ${walk.ladderTrying}` : ''}` : travelling;
}
// Whether the walk takes the party to a farm, which the farm task's line names.
export const farmWalk = (walk: CardWalk): boolean => goesToFarm(walk.purpose) || walk.walkingActivity === 'farm-recovery';
