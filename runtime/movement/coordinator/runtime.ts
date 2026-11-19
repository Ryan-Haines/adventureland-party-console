// The movement module's install on the coordinator (R1.1 runtime.ts): the farming route's
// authorization, the travel clock, the game geometry the planner prepares for each game version,
// and the step of every group's walk. Moved here from coordinator/navigation/runtime.ts;
// `prepareMovement` and `stepWalks` come out of application.ts's closures and take what they read
// as ports. `core:movement` answers `walks.request`, `walks.end`, `member.holder`,
// `walks.estimate`, `movement.reply`, `movement.gameMonsters` and `movement.formationRecovery` on
// the coordinator.
import type { ConvoyNavigationPlatform } from './route-store.ts';
import type { CoordinatorLogging } from '../../lifecycle/coordinator/api.ts';
import { gameMonsters, setGameEvents, setGameMonsters, type createPlannerService } from './planner-service.ts';
import { GAME_FILE_EVAL_MS, UnreachableGoalError, evalBoundFired, loadCoordinatorGeometry } from './planner-geometry.ts';
import { boundFired } from '../../status/coordinator/api.ts';
import { IncompleteRouteError } from './planner-service.ts';
import { setGameItems } from '../../protocol/game-items.ts';
import { setGameMaps } from '../../protocol/game-npcs.ts';
import type { HookRegistry, MemberHold, MemberHoldAsk, Registration, WalkAsk, WalkEndCode, WalkNotice } from '../../hooks/registry.ts';
import { heartbeatMovement } from './routes.ts';
import { deathGoal, townGoal, type SafeGoal } from '../rules.ts';
import { walkPace } from './walk.ts';
import { tasks } from '../../tasks/api.ts';
import { clearSpotRecovery } from '../../hunting/coordinator/api.ts';
import { formationRecovery } from './recovery.ts';

/** Release Escape before resetting the current farming recovery and authorizing the requested route. */
export function authorizeCoordinatorFarmingRoute<Location>(
  state: Parameters<typeof clearSpotRecovery>[0],
  names: string[],
  destination: Location,
  shared: boolean,
  ports: {
    release: () => void;
    authorize: (names: string[], destination: Location, shared: boolean) => void;
  },
): void {
  ports.release();
  clearSpotRecovery(state);
  ports.authorize(names, destination, shared);
}

interface TravelClockPorts {
  convoyStep: () => unknown;
  persist: () => void;
  every: (callback: () => void, milliseconds: number) => unknown;
}

// Movement's travel clock steps every group's walk. The other owners' coordinator ticks register
// their own intervals at the root (application.ts), each with today's period. The 250 ms period
// is v1.5.0's (navigation/runtime.ts), kept: no game fact gives it.
export function createCoordinatorTravelClock(ports: TravelClockPorts) {
  function startTravel(): void {
    ports.every(() => { if (ports.convoyStep()) ports.persist(); }, 250);
  }
  return { startTravel };
}

interface MovementPreparePorts {
  read: (path: string) => string;
  planner: Pick<ReturnType<typeof createPlannerService>, 'prepare'>;
  log: CoordinatorLogging['log'];
}
// The last prepared geometry, which the merchant's stand location (`canStand`) and the survival home
// goal (`homeGoal`, rules.ts T3) read. Before the first geometry loads nothing can stand and there is
// no home goal.
let geometry: ReturnType<typeof loadCoordinatorGeometry> | null = null;
// Each prepared game version's planner fingerprint, which the route time and the rare route distance
// send with each plan so the planner refuses a plan for other geometry; empty until it prepares.
const fingerprints = new Map<number, string>();
export function movementFingerprint(gameVersion: number): string { return fingerprints.get(gameVersion) || ''; }
export function canStand(x: number, y: number): boolean { return geometry ? geometry.canStand(x, y) : false; }
export function homeGoal(map: string | undefined): SafeGoal | null { return geometry ? deathGoal(geometry.game.maps, map) : null; }
// The landing spread of `map`'s town transport (rules.ts `townGoal`) from the loaded game data; null
// until it loads. The events owner's "in Main Town" reads it.
export function townLanding(map: string): SafeGoal | null { return geometry ? townGoal(geometry.game.maps, map) : null; }
/** Loads the game version's geometry for the planner; a failure leaves native movement to plan alone. */
export async function prepareMovement(gameVersion: number, ports: MovementPreparePorts) {
  try {
    const directory = './game_files/' + gameVersion + '/';
    const data = ports.read(directory + 'data.js');
    const common = ports.read(directory + 'old_common_functions.js');
    const loaded = loadCoordinatorGeometry(data, common);
    geometry = loaded;
    setGameMonsters((loaded.game as { monsters?: Parameters<typeof setGameMonsters>[0] }).monsters ?? null);
    setGameEvents((loaded.game as { events?: Parameters<typeof setGameEvents>[0] }).events ?? null);
    setGameItems((loaded.game as { items?: Parameters<typeof setGameItems>[0] }).items ?? null);
    setGameMaps((loaded.game as { maps?: Parameters<typeof setGameMaps>[0] }).maps ?? null);
    const prepared = ports.planner.prepare(loaded.game, gameVersion, {data, common});
    const collisionError = await prepared.ready;
    if (evalBoundFired(collisionError)) boundFired({ bound: 'GAME_FILE_EVAL_MS', owner: '02', subject: 'planner', state: { version: gameVersion, worker: true, ms: GAME_FILE_EVAL_MS } });
    fingerprints.set(gameVersion, prepared.fingerprint);
    if (collisionError) ports.log.warn({ version: gameVersion, fingerprint: prepared.fingerprint, collisionError }, 'ALClient movement geometry ready without the game collision check');
    else ports.log.info({ version: gameVersion, fingerprint: prepared.fingerprint }, 'ALClient movement geometry ready');
    return prepared;
  } catch (error) {
    if (evalBoundFired(error)) boundFired({ bound: 'GAME_FILE_EVAL_MS', owner: '02', subject: 'planner', state: { version: gameVersion, ms: GAME_FILE_EVAL_MS } });
    ports.log.warn({error}, 'Could not prepare ALClient; native movement fallback enabled'); return null;
  }
}

// The walk history's reason for each end code; the realm switch's is the text its cancel wrote, and a
// takeover's is its code, as the task owner's cancel wrote it.
const END_REASONS: Record<'realm-switch' | 'membership', string> = { 'realm-switch': 'party departed for another realm', membership: "a member left the walk's group" };
const endReason = (code: WalkEndCode) => code.startsWith('replaced:') ? code : END_REASONS[code as keyof typeof END_REASONS];
// The member facts `member.holder` reads from the member's own report.
interface HeldStatus { consoleMaintenance?: unknown;
  movementLive?: { kind?: string } | null; movementClick?: unknown;
  // What holds a member that has the walk's command and does not follow it (walk-client.ts
  // `commandHold`).
  commandHold?: { owner: MemberHold['owner']; reason: string } | null }
interface WalkGroup { partyConvoys: { cancel(reason: string, code: string): void; leave(member: string, reason: string, code: string): boolean;
  start(input: WalkAsk['destination'], label?: string, names?: string[], purpose?: string | null, cause?: 'farming-conflict', named?: WalkAsk['tier'], by?: string): boolean };
  state: { activeConvoy?: unknown; leader?: string | null; statuses?: Record<string, object | undefined> } }
// What the walk estimate reads: the planner's route time at a speed (planner-service.ts
// `createRouteTime`) and every member's report.
export interface WalkEstimatePorts {
  time(from: { map: string; x: number; y: number }, to: { map: string; x: number; y: number }, speed: number): Promise<number>;
  statuses(): Readonly<Record<string, { map?: string; x?: number; y?: number; baseSpeed?: number | null } | undefined>>;
}
// The install's lookup of a group's walk by its group id (application.ts).
type WalkLookup = (group: string) => WalkGroup | undefined;
// The registry's read of which owners answer `member.holder` themselves.
type Holders = Pick<HookRegistry['walks'], 'answersFor'>;
// `walks.request`: starts, keeps or retargets the named group's walk at the asker's tier through
// the walk machine's own start, which ranks it against the live walk and answers false when
// the live walk holds.
export function requestWalk(lookup: WalkLookup, group: string, ask: WalkAsk): boolean {
  const walks = lookup(group);
  return !!walks && walks.partyConvoys.start(ask.destination, ask.label, ask.members, ask.kind, undefined, ask.tier, ask.by);
}
// `walks.end`: ends the named group's walk with its end code, which `walk.ended` carries
// (walk.ts `walkEnds`). An ask that names a member takes only that member off the walk (walk.ts
// `leave`), and the walk goes on for the rest unless that member leads it.
export function endWalk(lookup: WalkLookup, group: string, code: WalkEndCode, member?: string): boolean {
  const walks = lookup(group);
  if (!walks?.state.activeConvoy) return false;
  if (member) return walks.partyConvoys.leave(member, endReason(code), code);
  walks.partyConvoys.cancel(endReason(code), code);
  return true;
}
// `walks.estimate`: the planned time of the group's walk to `destination`, a read that starts no
// walk. The group's members are its live task's (the tasks owner's `tasks().live`). It plans from
// the walk's start member (the walk's leader, else the first member, as the walk picks its leader)
// at the walk's own pace, the slowest member's base speed (`walkPace`), with the planner the
// walk's members route by. When the group gives no answer (no live task, or its start member has
// no position), it plans from `member`'s reported position at its own base speed. Undefined when
// neither has a position and a speed, or the planner gives no route (an unreachable goal or a
// route that ends short). Any other planner error rejects the estimate, so the asker sees it.
export async function estimateWalk(lookup: WalkLookup, ports: WalkEstimatePorts, group: string, destination: WalkAsk['destination'], member?: string): Promise<number | undefined> {
  const members = tasks().live(group)?.members ?? [];
  const statuses = ports.statuses();
  const route = async (from: typeof statuses[string], speed: number): Promise<number | undefined> => {
    if (!from?.map || !Number.isFinite(from.x) || !Number.isFinite(from.y) || !speed) return undefined;
    try { return await ports.time({ map: from.map, x: Number(from.x), y: Number(from.y) }, destination, speed); }
    catch (error) { if (error instanceof UnreachableGoalError || error instanceof IncompleteRouteError) return undefined; throw error; }
  };
  if (members.length) {
    const leader = lookup(group)?.state.leader, start = members.find(name => name === leader) ?? members[0]!;
    const planned = await route(statuses[start], walkPace(statuses, members, null).slowestSpeed);
    if (planned !== undefined) return planned;
  }
  return member ? route(statuses[member], walkPace(statuses, [member], null).slowestSpeed) : undefined;
}
// `member.holder`: movement holds a member under the player's manual control (a live `manual` request
// or a click) until `journey.ended`. Survival answers the dead, reviving and escaping members itself
// (runtime/coordinator/survival/install.ts `survivalHolds`), and events the members its attendance or
// return holds (runtime/events/coordinator/source.ts `eventHolds`), and lifecycle the paused, loading
// and runtime-lost members (runtime/lifecycle/coordinator/lease.ts `memberHolds`).
export function memberHolds(lookup: WalkLookup, holders: Holders, { group, member }: MemberHoldAsk): MemberHold[] {
  const s = lookup(group ?? '')?.state.statuses?.[member] as HeldStatus | undefined;
  if (!s) return [];
  const holds: MemberHold[] = [];
  if (s.movementLive?.kind === 'manual' || s.movementClick)
    holds.push({ owner: '02', reason: 'manual control', coming: true, endsOn: 'journey.ended' });
  // A member that has the walk's command and does not follow it names what holds it in its own report
  // (`commandHold`). An owner whose registration speaks for it as `holder` answers for its members
  // itself on every walk, so movement adds the report's row only for an owner none speaks for.
  const named = s.commandHold;
  if (named && !holders.answersFor(named.owner) && !holds.some(hold => hold.owner === named.owner))
    holds.push({ owner: named.owner, reason: named.reason, coming: true, endsOn: 'report' });
  return holds;
}
// core:movement's registration, built for one install so each answer closes over that install's
// walk lookup and estimate reads: two coordinators in one process answer from their own.
export const coordinatorMovementRegistration = (lookup: WalkLookup, estimate: WalkEstimatePorts, holders: Holders): Registration => ({
  name: 'core:movement', folder: 'core', author: 'adventureland-party-console', holder: '02',
  summary: 'Starts and ends a group walk for its asker, such as the realm switch, times a walk a group would take, names who holds a walk member that is not walking, answers the movement part of the status reply and the monster table of game data, and runs the terrain recovery round of a group fight.',
  hooks: { 'walks.request': (group, ask) => requestWalk(lookup, group, ask), 'walks.end': (group, code, member) => endWalk(lookup, group, code, member),
    'walks.estimate': (group, destination, member) => estimateWalk(lookup, estimate, group, destination, member),
    'member.holder': ask => memberHolds(lookup, holders, ask), 'movement.reply': heartbeatMovement, 'movement.gameMonsters': gameMonsters,
    'movement.formationRecovery': formationRecovery },
});
interface Hooks { register(registration: Registration): { ok: boolean; message?: string }; map(): { registrations: { name: string }[] };
  walks: Holders }
// The application installs it with the lookup of a group's walk by its group id and the walk
// estimate's reads.
export function installCoordinatorMovement(hooks: Hooks, walks: WalkLookup, estimate: WalkEstimatePorts): void {
  const registration = coordinatorMovementRegistration(walks, estimate, hooks.walks);
  if (!hooks.map().registrations.some(r => r.name === registration.name)) {
    const result = hooks.register(registration);
    if (!result.ok) throw Error(`The movement owner's core:movement did not load: ${result.message}`);
  }
}

/** Steps the walk of every combat group, the party's and each solo member's, after its restart recovery. */
export function stepWalks(groups: { state: Parameters<ConvoyNavigationPlatform['step']>[0]; partyConvoys: { recoverRestart(): void; addonWalk(): void } }[],
  navigation: Pick<ConvoyNavigationPlatform, 'step'>): boolean {
  let changed = false;
  for (const group of groups) {
    group.partyConvoys.recoverRestart();
    group.partyConvoys.addonWalk();
    changed = navigation.step(group.state) || changed;
  }
  return changed;
}
