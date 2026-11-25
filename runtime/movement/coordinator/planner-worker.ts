// The planner worker ("R5 correction"): the file a worker thread runs, so it is its own bundle
// entry (tools/build-runtime.mts, movement-planner.cjs). It holds the code only the worker runs:
// the ALClient adapter, which loads alpathfinder in the worker and never in the coordinator's
// process, and the corner detour.
import { parentPort, workerData } from 'node:worker_threads';
import * as pathfinder from 'alpathfinder';
import type { GData, MapKey } from 'typed-adventureland';
import { RESTRICTED_TRANSIT, UnreachableGoalError, avoidedMaps, loadCoordinatorGeometry } from './planner-geometry.ts';
import type { GameData, Geometry, PlanRequest, Point, Step } from '../geometry/contracts.ts';

// The ALClient adapter (from alclient-adapter.ts).
/** Adapted from earthiverse/ALClient (MIT), Pathfinder.ts at
 * 853cf80279b761ecbea238c4b3acd9caab102e11, SHA256
 * 1415e92d71d93e5321992b38da9ca65c37d758f1ffdbd73bd90fbfea0bd73996.
 * Only prepare/getPath are needed. No cheat edges; no Character/socket client.
 */
let preparedGame: GameData;
let preparedMaps = new Set<string>();
// Route-cost estimate only; actual movement and town authorization are separate.
const PLANNER_SPEED = 200;
// alpathfinder 0.6 exposes cost speed and avoidMaps, but no Town prohibition.
// Bias toward walking, then reject any residual Town edge before publishing it.
const WALK_PLANNER_SPEED = 1_000_000;
function prepare(g: GameData): void {
  preparedGame = g;
  const maps = new Set(['main']);
  for (const map of maps) for (const door of g.maps[map]?.doors || []) maps.add(String(door[4]));
  for (const map of Object.keys(g.npcs.transporter?.places || {})) maps.add(map);
  for (const map of ['abtesting', 'goobrawl', 'jail']) maps.add(map);
  pathfinder.prepare(g as unknown as GData, Object.keys(g.maps).filter(m => !maps.has(m)) as MapKey[]);
  preparedMaps = new Set([...maps].filter(map => !!g.maps[map] && typeof g.geometry === 'object' && g.geometry !== null && Object.hasOwn(g.geometry,map)));
}
function getPath(request: PlanRequest): Step[] {
  const { from, to } = request;
  const raw = request.avoidLeave ? withoutLeave(request) : findPath(from, to, request.town, false, request.avoidMaps);
  if (!raw?.length) noRoute(request);
  if (!request.town && raw.some(p => p.method === 'town')) throw Error('ALClient found no route without Town');
  const plot: Step[] = transporterApproaches(raw, from, request.town).map(p => ({ map: p.map, x: p.x, y: p.y, method: p.method,
    ...(p.method === 'town' ? { town: true } : {}),
    ...(['door', 'transport', 'enter'].includes(p.method) ? { transport: true, s: p.spawn ?? 0 } : {}),
    ...(p.key ? { key: p.key } : {}) }));
  if (plot[0].map !== from.map || plot[0].x !== from.x || plot[0].y !== from.y) plot.unshift({ ...from });
  return plot;
}

function noRoute(request: PlanRequest): never {
  if (preparedContext(request.from) && preparedContext(request.to)) throw new UnreachableGoalError('ALClient found no route');
  throw Error('ALClient found no route with unprepared map or instance geometry');
}

function preparedContext(point: Step): boolean {
  return preparedMaps.has(point.map) && (point.in === undefined || String(point.in) === point.map);
}

function findPath(from: Step, to: Step, town: boolean, avoidLeave = false, avoid?: readonly string[]): pathfinder.PathNode[] | null {
  return pathfinder.getPath(from.map as MapKey, from.x, from.y, to.map as MapKey, to.x, to.y, {
    speed: town ? PLANNER_SPEED : WALK_PLANNER_SPEED,
    avoidMaps: avoidedMaps(from, to, avoidLeave, avoid) as MapKey[] | undefined,
  });
}

function withoutLeave(request: PlanRequest): pathfinder.PathNode[] | null {
  const {from, to} = request;
  if (!RESTRICTED_TRANSIT.includes(from.map))
    return findPath(from, to, request.town, true, request.avoidMaps);
  const door = preparedGame.maps[from.map]?.doors?.find(d => d[4] === 'main' && !d[7] && !d[8]);
  if (!door) throw Error('Leave recovery unavailable: no ordinary exit');
  const spawn = Number(door[5] || 0), xy = preparedGame.maps.main.spawns[spawn];
  const approach = findPath(from, {map:from.map,x:Number(door[0]),y:Number(door[1])}, request.town, true, request.avoidMaps);
  const rest = findPath({map:'main',x:xy[0],y:xy[1]}, to, request.town, true, request.avoidMaps);
  if (!approach || !rest || approach.some(p => p.map !== from.map || p.method === 'leave')) throw Error('Leave recovery unavailable: ordinary exit inaccessible');
  return [...approach, {map: 'main', x: xy[0], y: xy[1], method: 'door', spawn}, ...rest];
}

function transporterApproaches(raw: pathfinder.PathNode[], origin: Step, town: boolean): pathfinder.PathNode[] {
  const result: pathfinder.PathNode[] = [];
  let previous: Step = origin;
  for (const step of raw) {
    if (step.method === 'transport') {
      const npc = preparedGame.maps[previous.map]?.npcs?.find(n => n.id === 'transporter')?.position;
      if (npc && Math.hypot(previous.x - npc[0], previous.y - npc[1]) >= 75) {
        const approach = transporterApproach(previous, npc, town);
        if (approach) result.push(...approach);
      }
    }
    result.push(step); previous = step;
  }
  return result;
}

function transporterApproach(from: Step, npc: number[], town: boolean): pathfinder.PathNode[] | undefined {
  const points = Array.from({length: 16}, (_, i) => ({map: from.map as MapKey,
    x: npc[0] + 60 * Math.cos(i * Math.PI / 8), y: npc[1] + 60 * Math.sin(i * Math.PI / 8), method: 'move' as const}));
  points.sort((a,b) => Math.hypot(a.x-from.x,a.y-from.y)-Math.hypot(b.x-from.x,b.y-from.y));
  for (const p of points) {
    if(pathfinder.canWalkPath(p.map,from.x,from.y,p.x,p.y))return [p];
    const path=findPath(from,p,town);
    if(path?.length && path.every(step=>step.map===from.map && step.method==='move')) {
      // Stop at the first graph node in interaction range. The library's final
      // exact-point connector can cut through a corner near the transporter.
      const arrived=path.findIndex(step=>Math.hypot(step.x-npc[0],step.y-npc[1])<70);
      if(arrived>=0)return path.slice(0,arrived+1);
    }
  }
  return undefined;
}

// The corner detour (from corner-edges.ts).
type Base = Geometry;
type Walk = (from: Point, to: Point, base: Base) => boolean;

/**
 * alpathfinder accepts some walking edges that cut a wall corner the game's
 * can_move rejects (#147). Replace each rejected same-map edge with one detour
 * point that passes both legs; an edge without one is left for the client's
 * bounded repair. Valid edges and transitions are never changed.
 */
function detourRejectedEdges(plot: Step[], base: Base, walk: Walk): { plot: Step[]; detoured: number; unresolved: [Step, Step][]; error?: string } {
  let detoured = 0;
  const unresolved: [Step, Step][] = [], result: Step[] = [];
  try {
    for (let i = 0; i < plot.length; i++) {
      const next = plot[i], previous = result.at(-1);
      if (previous && walkingEdge(previous, next) && !walk(previous, next, base)) {
        const via = detourPoint(previous, next, base, walk);
        if (via) { result.push(via); detoured++; } else unresolved.push([previous, next]);
      }
      result.push(next);
    }
  } catch (error) { return { plot, detoured: 0, unresolved: [], error: String(error) }; }
  return { plot: detoured ? result : plot, detoured, unresolved };
}

function walkingEdge(from: Step, to: Step): boolean {
  return from.map === to.map && (from.in === undefined || to.in === undefined || String(from.in) === String(to.in)) &&
    !to.transport && !to.town && (to.method === undefined || to.method === 'move');
}

/** The shortest single point near the edge's elbows or midpoint that both legs can walk. */
function detourPoint(from: Step, to: Step, base: Base, walk: Walk): Step | null {
  const candidates: { x: number; y: number }[] = [];
  const offsets = [0, 4, 8, 12, 16, 24, 32];
  for (const [x, y] of [[from.x, to.y], [to.x, from.y]])
    for (const dx of offsets) for (const dy of offsets)
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) candidates.push({ x: x + sx * dx, y: y + sy * dy });
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const nx = -(to.y - from.y) / length, ny = (to.x - from.x) / length;
  for (const along of [0.25, 0.5, 0.75]) for (const side of [-64, -48, -32, -24, -16, -8, 8, 16, 24, 32, 48, 64])
    candidates.push({ x: from.x + (to.x - from.x) * along + nx * side, y: from.y + (to.y - from.y) * along + ny * side });
  let best: Step | null = null, bestLength = Infinity;
  for (const c of candidates) {
    const total = Math.hypot(c.x - from.x, c.y - from.y) + Math.hypot(to.x - c.x, to.y - c.y);
    if (total >= bestLength) continue;
    const point: Step = { map: from.map, ...(from.in === undefined ? {} : {in:from.in}), x: Math.round(c.x), y: Math.round(c.y), method: 'move' };
    if (walk(from, point, base) && walk(point, to, base)) { best = point; bestLength = total; }
  }
  return best;
}

// The worker (from planner-worker.ts).
const data = workerData as { game: GameData; fingerprint: string; version: number; collision?: {data: string; common: string} };
prepare(data.game);
// The game's own collision, when its sources were provided; otherwise plan as before (#147). A load
// failure travels in the ready message and in every plan answer as `collisionError`.
let collision: ReturnType<typeof loadCoordinatorGeometry> | null = null, collisionError: string | undefined;
try { if (data.collision) collision = loadCoordinatorGeometry(data.collision.data, data.collision.common); } catch (error) { collisionError = 'collision did not load: ' + String(error); }
parentPort!.postMessage({ ready: true, collisionError });
parentPort!.on('message', (request: PlanRequest) => {
  const start = performance.now();
  try {
    const raw = getPath(request);
    const detour = collision ? detourRejectedEdges(raw, request.base || {h:8,v:7,vn:2}, (a, b, base) => collision!.canMove(a, b, base)) : undefined;
    const failed = collisionError ?? (detour?.error && 'corner detour failed: ' + detour.error);
    parentPort!.postMessage({ id: request.id, plot: detour?.plot ?? raw, fingerprint: data.fingerprint, version: data.version, ms: performance.now() - start, collisionError: failed });
  } catch (error) {
    parentPort!.postMessage({ id: request.id, error: String(error),
      ...(error instanceof UnreachableGoalError ? {failure:'unreachable',plot:[],fingerprint:data.fingerprint,version:data.version,ms:performance.now()-start} : {}) });
  }
});
