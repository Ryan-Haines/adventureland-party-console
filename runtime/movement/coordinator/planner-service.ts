// The movement planner on the coordinator (as the "R5 correction" places it): the worker pool that
// plans routes, the game geometry it prepares, the unreachable-goal error, the game's monster and
// event tables read from the same data.js, and the planned route length. The worker's own code, the
// ALClient adapter and the corner detour, sits in planner-worker.ts, the worker's bundle entry.
import { Worker } from 'node:worker_threads';
import { geometryFingerprint, type GameData, type Geometry, type PlanRequest, type PlanResult, type Point } from '../geometry/contracts.ts';
import { partyHooks } from '../../hooks/index.ts';
// The planner's developer budgets, movement's hidden settings, read at each
// use so a write applies at the next plan.
import { hiddenValue } from '../../settings/coordinator/api.ts';
import { PLANNER_POOL_SIZE, PLANNER_QUEUE_CAP } from '../rules.ts';
import { boundFired } from '../../status/coordinator/api.ts';
import { UnreachableGoalError } from './planner-geometry.ts';
import type { ScopeHandle } from '../../lifecycle/api.ts';
// The planner's timers run on the movement owner's handle of the coordinator run scope (application.ts), so the
// shutdown's stop releases them with every other owner's.
type Timers = Pick<ScopeHandle, 'setTimeout' | 'clearTimeout'>;
type Timer = ReturnType<Timers['setTimeout']>;
interface Pending { resolve(result: PlanResult): void; reject(error: Error): void; timer: Timer }
interface Collision { data: string; common: string }
interface Instance {
  worker: Worker; version: number; fingerprint: string; key: string; ready: Promise<string | undefined>; pending: Map<string, Pending>; used: number;
  game: GameData; collision?: Collision; replacement: boolean; preparing?: Timer;
}
export function createPlannerService(workerFile: string, timers: Timers) {
  const instances = new Map<string, Instance>();
  const mode = process.env.PARTY_MOVEMENT_MODE || 'alclient';
  // A worker that retires on a failure (a plan timeout, its exit or error, or a preparation timeout)
  // starts one replacement for the same geometry at once, so ALClient planning comes back without
  // b9b5c91e's 5 s re-prepare loop (nav/planner-service.ts:53). A replacement that fails before it
  // answers its first plan starts none, so a geometry that crashes its worker stops until runtime.ts
  // `prepareMovement` delivers it again. Only the instance the pool still holds replaces itself, so
  // the exit that `terminate` raises after a retirement starts nothing. The instance holds both of
  // its timers (the preparation timeout and each plan's), so `retire` clears them, and `dispose`,
  // which the coordinator's closeStorage runs at stop (application.ts), retires every instance.
  function retire(instance: Instance, reason: string, failed = false) {
    const current = instances.get(instance.key) === instance;
    if (current) instances.delete(instance.key);
    timers.clearTimeout(instance.preparing);
    for (const p of instance.pending.values()) { timers.clearTimeout(p.timer); p.reject(Error(reason)); }
    instance.pending.clear(); void instance.worker.terminate();
    if (failed && current && !instance.replacement) start(instance.game, instance.version, instance.fingerprint, instance.collision, true);
  }
  /** `collision` holds the game's data.js and old_common_functions.js sources, so the worker can check edges with can_move (#147). */
  function prepare(game: GameData, version: number, collision?: Collision) {
    const fingerprint = geometryFingerprint(game), existing = instances.get(`${version}:${fingerprint}`);
    if (existing) return { fingerprint, ready: existing.ready };
    return { fingerprint, ready: start(game, version, fingerprint, collision, false).ready };
  }
  function start(game: GameData, version: number, fingerprint: string, collision: Collision | undefined, replacement: boolean): Instance {
    makeRoom();
    const key = `${version}:${fingerprint}`;
    const worker = new Worker(workerFile, { workerData: { game, version, fingerprint, collision } });
    const instance = { worker, version, fingerprint, key, pending: new Map<string, Pending>(), used: Date.now(), game, collision, replacement } as Instance;
    // `ready` answers the worker's collisionError: the reason it plans without the game's collision.
    instance.ready = new Promise<string | undefined>((resolve, reject) => {
      const prepareMs = hiddenValue('movementPlannerPrepareMs');
      instance.preparing = timers.setTimeout(() => {
        boundFired({ bound: 'movementPlannerPrepareMs', owner: '02', subject: key, state: { ms: prepareMs } });
        reject(Error('Planner preparation timed out')); retire(instance, 'Planner preparation timed out', true);
      }, prepareMs);
      worker.on('message', message => {
        if (message.ready) { timers.clearTimeout(instance.preparing); resolve(message.collisionError); return; }
        const p = instance.pending.get(message.id);
        if (!p) return;
        instance.pending.delete(message.id); timers.clearTimeout(p.timer);
        instance.replacement = false;
        if (message.error) {
          const verified = message.failure === 'unreachable' && message.version === instance.version && message.fingerprint === instance.fingerprint;
          p.reject(verified ? new UnreachableGoalError(message.error, message) : Error(message.error));
        } else p.resolve(message);
      });
      worker.once('error', error => { reject(error); retire(instance, error.message, true); });
      worker.once('exit', () => { reject(Error('Planner worker exited')); retire(instance, 'Planner worker exited', true); });
    });
    // Preparation is optional for game activation; errors are returned to callers as native fallback.
    void instance.ready.catch(() => {});
    worker.unref();
    instances.set(key, instance);
    return instance;
  }
  function makeRoom() {
    if (instances.size < PLANNER_POOL_SIZE) return;
    const oldest = [...instances.values()].filter(i => !i.pending.size).sort((a, b) => a.used - b.used)[0];
    if (!oldest) {
      boundFired({ bound: 'PLANNER_POOL_SIZE', owner: '02', subject: 'planner', state: { geometries: [...instances.keys()] } });
      throw Error('Planner geometry pool busy');
    }
    retire(oldest, 'Unused game geometry retired');
  }
  // Separate check B2: no plan request starts a Worker. A request for a geometry the pool does not
  // hold fails, and the member plans natively, until `retire` replaces the worker or runtime.ts
  // `prepareMovement` delivers the geometry again (the coordinator's start or a client update).
  async function plan(request: PlanRequest): Promise<PlanResult> {
    if (mode === 'native') throw Error('Native-only movement mode enabled');
    const instance = instances.get(`${request.version}:${request.fingerprint}`);
    if (!instance)
      throw Error(`No compatible game geometry prepared: requested ${request.version}:${request.fingerprint}; prepared ${[...instances.keys()].join(', ') || 'none'}`);
    await instance.ready;
    if (instance.pending.has(request.id)) throw Error('Planner duplicate request');
    if (instance.pending.size >= PLANNER_QUEUE_CAP) {
      boundFired({ bound: 'PLANNER_QUEUE_CAP', owner: '02', subject: instance.key, state: { pending: instance.pending.size } });
      throw Error('Planner queue full');
    }
    instance.used = Date.now();
    // `route.avoid`: the maps the add-ons name, and only those, travel with the request.
    const avoid = partyHooks().movement.avoidedMaps({ from: request.from, to: request.to });
    const sent: PlanRequest = { ...request, avoidMaps: avoid.length ? avoid : undefined };
    return new Promise((resolve, reject) => {
      const budget = hiddenValue('movementAlclientPlanMs');
      const timer = timers.setTimeout(() => {
        boundFired({ bound: 'movementAlclientPlanMs', owner: '02', subject: instance.key, state: { request: request.id, ms: budget } });
        retire(instance, 'ALClient planning timed out (' + budget / 1000 + ' seconds)', true);
      }, budget);
      instance.pending.set(request.id, { resolve, reject, timer }); instance.worker.postMessage(sent);
    });
  }
  return { prepare, plan, mode, dispose() { for (const instance of instances.values()) retire(instance, 'Coordinator stopped'); } };
}

// The game's monster table on the coordinator, read from the same data.js the movement planner prepares
// (runtime.ts `prepareMovement`). Movement reads these facts from it: which event bosses move (queue A26, the
// events owner's `eventBossMoves`) and the display names on the activity line
// (runtime/status/coordinator/line.ts), and a walk's fight judgement reads each attacker's attack, frequency
// and damage type (queue A4, protocol/hold-check.ts `fightWinnable`). Null until the game data loads. The
// targeting owner's reflect lists offer the monsters with `reflection` or `dreturn`.
export interface GameMonster { name?: string; respawn?: number; speed?: number; attack?: number; frequency?: number; damage_type?: string; reflection?: number; dreturn?: number }
let monsters: Readonly<Record<string, GameMonster | undefined>> | null = null;
export function setGameMonsters(table: Readonly<Record<string, GameMonster | undefined>> | null): void { monsters = table; }
export function gameMonsters(): Readonly<Record<string, GameMonster | undefined>> | null { return monsters; }
// The game's event table from the same data.js. An event with a `duration` (seconds) runs
// in a fixed window, which marks it short-window for queue A25 (walk.ts `eventFacts`).
export interface GameEvent { duration?: number }
let events: Readonly<Record<string, GameEvent | undefined>> | null = null;
export function setGameEvents(table: Readonly<Record<string, GameEvent | undefined>> | null): void { events = table; }
export function gameEvents(): Readonly<Record<string, GameEvent | undefined>> | null { return events; }

// The planned route length (from rare-route-distance.ts): the walking distance of the plot, with
// each map change counted as b9b5c91e's 400. A plan that ends short of `to` is no route. The Phoenix
// patrol (07) ranks its waiting regions by it through the `routeDistance` port, and the walk
// estimate times a group's walk by it.
// A plan whose plot ends short of its goal: no route, as an unreachable goal is.
export class IncompleteRouteError extends Error {}
function createRouteLength(plan: (request: PlanRequest) => Promise<PlanResult>, identity: () => { version: number; fingerprint: string }, purpose: string) {
  let serial = 0;
  return async (from: Point, to: Point, speed: number): Promise<number> => {
    const result = await plan({ ...identity(), id: `${purpose}-${Date.now()}-${++serial}`, from, to, speed, town: false });
    let previous = from, distance = 0;
    for (const step of result.plot) {
      distance += step.map === previous.map ? Math.hypot(step.x - previous.x, step.y - previous.y) : 400;
      previous = step;
    }
    if (previous.map !== to.map || Math.hypot(previous.x - to.x, previous.y - to.y) > 40) throw new IncompleteRouteError(`Incomplete ${purpose} route`);
    return distance;
  };
}
/** Route walking distance plus a fixed transition cost; failed plans are not reachable candidates. */
export function createRareRouteDistance(plan: (request: PlanRequest) => Promise<PlanResult>, identity: () => { version: number; fingerprint: string }) {
  const length = createRouteLength(plan, identity, 'phoenix-wait');
  return (from: Point, to: Point): Promise<number> => length(from, to, 60);
}
// The walk estimate's route time: the planned route at `speed`, in milliseconds.
export function createRouteTime(plan: (request: PlanRequest) => Promise<PlanResult>, identity: () => { version: number; fingerprint: string }) {
  const length = createRouteLength(plan, identity, 'walk-estimate');
  return async (from: Point, to: Point, speed: number): Promise<number> => await length(from, to, speed) / speed * 1000;
}
