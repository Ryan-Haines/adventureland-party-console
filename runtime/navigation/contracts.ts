import type { GEvent, GMap, ICoord } from 'typed-adventureland';

/** Shared wire contract. Instances and geometry identities are never inferred from map names. */
export interface Point extends ICoord { map: string; in?: string | number }
export interface Step extends Point { town?: boolean; transport?: boolean; s?: number; method?: string; key?: string }
// Processed movement geometry requires a numeric v; the game also permits null.
export type Geometry = Omit<(typeof character)['base'], 'v'> & { v: NonNullable<(typeof character)['base']['v']> };
// Wire data can contain new IDs and partial arrays, unlike the complete game catalog.
interface NavigationMap extends Pick<GMap, 'instance'> {
  spawns: number[][];
  doors?: unknown[][];
  npcs?: { id: string; position?: number[] }[];
  event?: string;
  monsters?: { type: string; boundary?: number[]; boundaries?: (string | number)[][] }[];
}
export interface GameData {
  maps: Record<string, NavigationMap>;
  geometry: unknown;
  npcs: { transporter?: { places: Record<string, number> } };
  events?: Record<string, Pick<GEvent, 'join'>>;
}
export const isTransition = (step: Step): boolean => !!(step.town || step.transport || step.method === "leave");
export interface PlanRequest { base?: Geometry; avoidLeave?: boolean; id: string; from: Point; to: Point; speed: number; town: boolean; fingerprint: string; version: number }
export interface PlanResult { id: string; plot: Step[]; fingerprint: string; version: number; ms: number; error?: string; failure?: 'unreachable' }
export interface Issue { reason: string; from: Point; to: Point }
export const point = (p: Point): Point => ({ map: p.map, x: p.x, y: p.y, ...(p.in === undefined ? {} : { in: p.in }) });
export const distance = (a: Point, b: Point): number => a.map === b.map && (a.in === undefined || b.in === undefined || a.in === b.in) ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
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
