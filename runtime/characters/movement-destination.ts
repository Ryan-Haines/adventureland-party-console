import { isPoint, type Point } from '../navigation/contracts.ts';
import type { MovementHost } from './movement-host.ts';
export function resolveDestination(host: MovementHost, input: unknown): Point {
  if (input && typeof input === 'object') {
    const p = { map: host.character.map, ...input };
    if (isPoint(p)) return p;
  }
  return resolveName(host, destinationName(input));
}
function destinationName(input: unknown): string {
  if (typeof input === 'string') return input;
  const p = input as {to?: string; map?: string} | null;
  return String(p?.to || p?.map || '');
}
function resolveName(host: MovementHost, value: string): Point {
  const name = value === 'town' ? 'main' : value;
  const map = host.G.maps[name];
  if (map?.event) throw Error(`Event ${map.event} requires the event joining workflow`);
  if (map?.spawns[0]) return { map: name, x: map.spawns[0][0], y: map.spawns[0][1] };
  const npc = host.find_npc(name);
  if (npc) return { ...npc, y: npc.y + 15 };
  const aliases: Record<string, Point> = { upgrade: { map: 'main', x: -204, y: -129 }, compound: { map: 'main', x: -204, y: -129 }, exchange: { map: 'main', x: -26, y: -432 }, scrolls: { map: 'main', x: -465, y: -71 } };
  if (name === 'potions') return potions(host.character.map);
  if (aliases[name]) return aliases[name];
  throw Error(`Unknown movement destination ${name}`);
}
function potions(map: string): Point {
  if (map === 'halloween') return { map, x: 149, y: -182 };
  if (['winterland', 'winter_inn', 'winter_cave'].includes(map)) return { map: 'winter_inn', x: -84, y: -173 };
  return { map: 'main', x: 56, y: -122 };
}
