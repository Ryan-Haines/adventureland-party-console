// Movement's wire contracts ("wire contracts"): the point, step and geometry shapes both runtimes
// and the planner worker share, the plan request and answer, the geometry fingerprint, and the
// formation recovery and independent approach shapes the targeting steps report.
import type { GameData, Geometry, NavigationMap, Point, Step } from '../../protocol/walk.ts';
import { samePlace } from '../../protocol/place.ts';

// The point, the step, the geometry and the game data's walk part are protocol's
// (runtime/protocol/walk.ts), since protocol's records carry them.
export type { GameData, Geometry, Point, Step } from '../../protocol/walk.ts';
export const isTransition = (step: Step): boolean => !!(step.town || step.transport || step.method === "leave");
// `avoidMaps` holds the maps the add-ons' `route.avoid` answers named; the planner service sets it.
export interface PlanRequest { base?: Geometry; avoidLeave?: boolean; avoidMaps?: string[]; id: string; from: Point; to: Point; speed: number; town: boolean; fingerprint: string; version: number }
// `collisionError` names why the plan ran without the game's collision check (#147): its sources
// failed to load in the worker, or the corner detour threw on this plot.
export interface PlanResult { id: string; plot: Step[]; fingerprint: string; version: number; ms: number; error?: string; failure?: 'unreachable'; collisionError?: string }
// The terrain recovery's report and round. Targeting's
// group record and the members' status reports carry them, so they are wire shapes every owner reads.
export interface RecoveryPoint {x:number;y:number}
export interface FormationRecoveryReport {
  target:string; at:number; goals?:RecoveryPoint[]; ack?:string;
  attempt?:number; outcome?:'arrived'|'failed'; reason?:string;
  remaining?:number;
  approachReady?:boolean;
  /** Exact stopped healing-coverage gate, not generic route planning. */
  coverageBlocked?:boolean;
  /** Actual bounded follower search outcome for this acknowledged attempt. */
  followerRoute?:'planning'|'routing'|'arrived'|'unreachable';
}
// The recovery climbs the movement owner's progress ladder (runtime/protocol/ladder.ts): each staging goal is one rung.
// A try fails when its route fails or the mover makes no progress; a failure that left the mover closer to the target
// starts the round again with every goal but the one that failed, and one that did not moves on to the next
// untried goal. With no untried goal left the recovery fails, and the queue picks another target (queue.ts), which is
// the round's last rung. `attempt` names the try for acknowledgements; no count ends the climb.
export interface FormationRecovery {
  id:string; key:string; target:string; mover:string; goals:RecoveryPoint[];
  phase:'pausing'|'routing'|'retry'|'regrouping'|'failed';
  attempt:number; startedAt:number; phaseAt:number; coveredAt?:number;
  reason?:string;
  goal?:RecoveryPoint; failedGoals?:RecoveryPoint[]; resumeSince?:number;
  // The mover's nearest distance to the target in this round, and when the current try last
  // made progress (the mover toward its goal, or the members toward the anchor).
  nearest?:number; progressAt?:number; closest?:number;
  // What the recovery is trying now, in plain words, for the navigation log.
  trying?:string;
}
// The independent approach's readiness report and confirmation round, carried by the members'
// reports and targeting's group record.
export interface IndependentReady {selection:string;target:string;at:number;ready:boolean;confirmation?:string}
export interface IndependentConfirmation {id:string;selection:string;target:string;startedAt:number;expiresAt:number}
export interface Issue { reason: string; from: Point; to: Point }
export const point = (p: Point): Point => ({ map: p.map, x: p.x, y: p.y, ...(p.in === undefined ? {} : { in: p.in }) });
export const distance = (a: Point, b: Point): number => a.map === b.map && (a.in === undefined || b.in === undefined || a.in === b.in) ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
// Whether every point stands on `from`'s map and instance; a point with no `in` takes `from`'s, as a
// planned step carries none. The walking repairs bound their searches with it.
// A plotted step carries no `in`, so it sits in the origin's instance; protocol/place.ts decides
// the rest.
export function sameContext(from: Point, ...points: Point[]): boolean {
  return points.every(p => samePlace(from, { map: p.map, in: p.in ?? from.in }));
}
export function isPoint(p: unknown): p is Point {
  if (!p || typeof p !== 'object') return false;
  const v = p as Point;
  return typeof v.map === 'string' && /^[\w-]+$/.test(v.map) && Number.isFinite(v.x) && Number.isFinite(v.y);
}
// A generated Cave floor never changes for its zone_<run>_<floor> key, and no
// route crosses floors. Clients hold different sets of them (the client prunes
// on new_map), which made the leader's and a follower's identities differ by
// one floor's collision lines (live Cave run 1feaf7322872ef6d694d0026).
const generatedFloor = (name: string) => /^zone_[a-f0-9]+_\d+$/.test(name);
/** Stable, synchronous browser/Node geometry identity; catches same-version data changes. */
export function geometryFingerprint(g: GameData): string {
  const geometry = g.geometry as Record<string, { x_lines?: number[][]; y_lines?: number[][] }>;
  const maps = Object.keys(g.maps).filter(name => !generatedFloor(name)).sort().map(name => {
    const m = g.maps[name], collision = geometry?.[name];
    const transporters = (m.npcs || []).filter(n => n.id === 'transporter').map(n => n.position);
    return [name, collision?.x_lines || [], collision?.y_lines || [], m.spawns, m.doors || [], transporters, !!m.instance, m.event || null];
  });
  // Rendering caches, map.data aliases and NPC cosmetics are client-owned and do
  // not identify route geometry. Only collision lines and transition data do.
  const value = JSON.stringify([maps, g.npcs.transporter?.places]);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
  return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}-${value.length}`;
}
type CollisionLines = { x_lines?: number[][]; y_lines?: number[][] };
const sized = (value: unknown[] | undefined): unknown[] => [value, value?.length];
function mapInputs(name: string, m: NavigationMap, collision: CollisionLines | undefined): unknown[] {
  return [name, m, collision, ...sized(collision?.x_lines), ...sized(collision?.y_lines),
    ...sized(m.spawns), ...sized(m.doors), ...sized(m.npcs), m.instance, m.event];
}
/**
 * Objects, arrays and array lengths that geometryFingerprint reads. Replacing
 * any input or adding to an array changes this list; renderer fields do not.
 */
function geometryInputs(g: GameData): unknown[] {
  const geometry = g.geometry as Record<string, CollisionLines> | undefined;
  const places = g.npcs.transporter?.places;
  const inputs: unknown[] = [g.geometry, g.maps, g.npcs, places, places && Object.keys(places).length];
  for (const name in g.maps) if (!generatedFloor(name)) inputs.push(...mapInputs(name, g.maps[name], geometry?.[name]));
  return inputs;
}
const fingerprints = new WeakMap<object, { inputs: unknown[]; value: string }>();
/**
 * geometryFingerprint for callers that check the same G many times, like
 * movement on every move. It serializes all collision lines again only when an
 * input from geometryInputs changes.
 */
export function cachedGeometryFingerprint(g: GameData): string {
  const inputs = geometryInputs(g), cached = fingerprints.get(g);
  if (cached && cached.inputs.length === inputs.length && cached.inputs.every((input, index) => input === inputs[index])) return cached.value;
  const value = geometryFingerprint(g);
  fingerprints.set(g, { inputs, value });
  return value;
}
