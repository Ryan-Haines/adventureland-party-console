// The farm areas of the spawn catalog. The dashboard imports this file and
// zones.ts directly: api.ts carries the coordinator and character types, which the dashboard's
// typecheck must not follow.
import * as zones from './zones.ts';
import type { Area, Catalog, Zone } from './zones.ts';
export type FarmingArea = Zone & { id: string };

interface Spawn { type?: string; count?: number; position?: number[]; boundary?: number[]; boundaries?: unknown[][]; polygon?: number[][] }
interface GameMap { name?: string; monsters?: (Spawn | null)[]; ignore?: unknown; instance?: unknown; irregular?: unknown }
interface Game { monsters: Record<string, { name?: string; skin?: string }>; maps: Record<string, GameMap | undefined> }
export interface SpawnRecord extends Partial<Area> { sourceMap: string; count?: number; restrictions: string[]; boundary?: number[] }
export interface SpawnChoice { id: string; name: string; sprite?: unknown; locations: Area[]; spawnRecords: SpawnRecord[] }

// A map flag that keeps a spawn out of the farm locations (the restriction keeps its record).
const FLAGS = ['ignore', 'instance', 'irregular'] as const;

/**
 * The spawn catalog from game data (`G.maps` spawns): each monster type's farm locations, and every
 * spawn record with the restrictions that keep it out of them. `sprite` names the monster's sprite for
 * the dashboard; `onlyType` builds one type's entry (`monsterChoices(onlyType)`).
 */
export function spawnCatalog(game: Game, sprite?: (skin: string | undefined) => unknown, onlyType?: string): SpawnChoice[] {
  const ids = onlyType ? (game.monsters[onlyType] ? [onlyType] : []) : Object.keys(game.monsters);
  return ids.map(id => {
    const locations: Area[] = [], spawnRecords: SpawnRecord[] = [];
    for (const [mapId, map] of Object.entries(game.maps)) {
      if (!map || !Array.isArray(map.monsters)) continue;
      for (const spawn of map.monsters) {
        if (!spawn || spawn.type !== id) continue;
        let recorded = false;
        const add = (at: string, box: number[] | null, position: number[] | null) => {
          const target = game.maps[at], restrictions: string[] = FLAGS.filter(flag => map[flag] || target?.[flag]);
          if (spawn.count === 0) restrictions.push('zero-count');
          if (!target) restrictions.push('missing-map');
          const x = position ? position[0]! : box ? (box[0]! + box[2]!) / 2 : NaN, y = position ? position[1]! : box ? (box[1]! + box[3]!) / 2 : NaN;
          const valid = Number.isFinite(x) && Number.isFinite(y) && (!box || box.every(Number.isFinite));
          if (!valid) restrictions.push('invalid-geometry');
          const location = { map: at, mapName: target?.name || at, x: valid ? Math.round(x) : undefined, y: valid ? Math.round(y) : undefined,
            boundary: box || undefined, polygon: spawn.polygon || undefined };
          spawnRecords.push({ sourceMap: mapId, count: spawn.count, restrictions, ...location });
          recorded = true;
          if (!restrictions.length) locations.push(location as Area);
        };
        if (Array.isArray(spawn.position)) add(mapId, null, spawn.position);
        if (Array.isArray(spawn.boundary) && spawn.boundary.length >= 4) add(mapId, spawn.boundary.slice(0, 4), null);
        for (const box of Array.isArray(spawn.boundaries) ? spawn.boundaries : [])
          if (Array.isArray(box) && box.length >= 5) add(String(box[0]), box.slice(1, 5) as number[], null);
        if (!recorded) add(mapId, null, null);
      }
    }
    return { id, name: game.monsters[id]!.name || id, sprite: sprite?.(game.monsters[id]!.skin), locations, spawnRecords };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** A spawn's key for the preferred spawn setting: its map and center, so it holds across catalog order. */
export function huntSpawnKey(location: { map: string; x: unknown; y: unknown }): string {
  return JSON.stringify([location.map, Number(location.x), Number(location.y)]);
}
// The Phoenix patrol's default order holds every region the catalog lists for the Phoenix, so the
// region count is the game's. The five anchors rank the regions they
// fall in, independent of catalog order and rounded labels; any other region follows by map and position.
const phoenixAnchors = [
  {map: 'main', x: 641, y: 1803}, {map: 'cave', x: -180, y: -1164},
  {map: 'main', x: -1184, y: 781}, {map: 'main', x: 1188, y: -193},
  {map: 'halloween', x: 8, y: 631},
];
export function defaultPhoenixOrder(areas: Area[]): string[] {
  const rank = (a: Area) => {
    const i = phoenixAnchors.findIndex(p => a.map === p.map && zones.contains(a, p, 0, 1));
    return i < 0 ? phoenixAnchors.length : i;
  };
  return [...areas].sort((a, b) => rank(a) - rank(b) || a.map.localeCompare(b.map) || a.x - b.x || a.y - b.y)
    .flatMap(a => a.id ? [a.id] : []);
}
const key = (a: Area) =>
  JSON.stringify([a.map, a.shapes || a.boundary || [a.x, a.y]]);
export function farmingAreas(catalog: Catalog, ids: string[]): FarmingArea[] {
  const regions = new Map<string, Zone>();
  for (const a of zones.zones(catalog, ids)) {
    const k = key(a),
      existing = regions.get(k);
    if (existing)
      existing.monsterIds = [
        ...new Set([...existing.monsterIds, ...a.monsterIds]),
      ];
    else regions.set(k, a);
  }
  // Closure of rectangular intersections includes regions shared by 3+ types.
  const queue = [...regions.values()];
  for (let i = 0; i < queue.length; i++) {
    const a = queue[i];
    for (let j = 0; j < i; j++) {
      const b = queue[j];
      if (a.map !== b.map || !a.boundary || !b.boundary) continue;
      const members = [...new Set([...a.monsterIds, ...b.monsterIds])].sort();
      if (members.length <= Math.max(a.monsterIds.length, b.monsterIds.length))
        continue;
      const box = [
        Math.max(a.boundary[0], b.boundary[0]),
        Math.max(a.boundary[1], b.boundary[1]),
        Math.min(a.boundary[2], b.boundary[2]),
        Math.min(a.boundary[3], b.boundary[3]),
      ];
      if (box[0] >= box[2] || box[1] >= box[3]) continue;
      const region = {
        map: a.map,
        mapName: a.mapName,
        boundary: box,
        x: Math.round((box[0] + box[2]) / 2),
        y: Math.round((box[1] + box[3]) / 2),
        monsterIds: members,
        allOf: [...(a.allOf || [a]), ...(b.allOf || [b])],
      };
      if (!zones.contains(region, region)) {
        const point = zones
          .searchPoints(region)
          .find((p) => zones.contains(region, p));
        if (!point) continue;
        region.x = point.x;
        region.y = point.y;
      }
      const k = key(region),
        existing = regions.get(k);
      if (!existing) {
        regions.set(k, region);
        queue.push(region);
      } else {
        const union = [...new Set([...existing.monsterIds, ...members])].sort();
        if (union.length > existing.monsterIds.length) {
          const updated = { ...existing, monsterIds: union };
          regions.set(k, updated);
          queue.push(updated);
        }
      }
    }
  }
  return [...regions.values()]
    .map((a) => ({ ...a, id: key(a), monsterIds: a.monsterIds.sort() }))
    .sort(
      (a, b) =>
        b.monsterIds.length - a.monsterIds.length ||
        a.monsterIds.join(',').localeCompare(b.monsterIds.join(',')) ||
        a.map.localeCompare(b.map) ||
        a.x - b.x ||
        a.y - b.y,
    );
}
export function validFarmingLocation(
  catalog: Catalog,
  ids: unknown,
  candidate: unknown,
): FarmingArea | null {
  if (!validMonsterIds(catalog,ids)) return null;
  // Preserve the existing raw equality checks, including inherited properties.
  const location=candidate as {map?:unknown;x?:unknown;y?:unknown}|null|undefined;
  return (
    farmingAreas(catalog, ids).find(
      (a) =>
        location &&
        a.map === location.map &&
        a.x === location.x &&
        a.y === location.y,
    ) || null
  );
}
function validMonsterIds(catalog:Catalog,ids:unknown):ids is string[] {
  return !(
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some(
      (id) => typeof id !== 'string' || !catalog.some((m) => m.id === id),
    )
  );
}
