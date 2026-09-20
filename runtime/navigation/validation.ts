import { distance, isPoint, type GameData, type Point, type Step, type Issue } from './contracts.ts';
export interface ValidationPorts {
  game: GameData;
  walk(from: Point, to: Point): boolean;
  door(from: Point, door: unknown[]): boolean;
  hasKey(key: string): boolean;
}
function atSpawn(g: GameData, p: Point, spawn: number): boolean {
  const xy = g.maps[p.map]?.spawns[spawn];
  return !!xy && Math.hypot(p.x - xy[0], p.y - xy[1]) <= 1;
}
function doorAllowed(ports: ValidationPorts, from: Point, to: Step): boolean {
  const key = to.key || ({ bank_b: 'bkey', bank_u: 'ukey' } as Record<string, string>)[to.map];
  return !!ports.game.maps[from.map]?.doors?.some(d => d[4] === to.map && Number(d[5] || 0) === to.s &&
    d[8] !== 'complicated' && (d[7] !== 'key' || !!key && ports.hasKey(key)) && ports.door(from, d));
}
function transporterAllowed(g: GameData, from: Point, to: Step): boolean {
  if (g.npcs.transporter?.places[to.map] !== to.s) return false;
  return !!g.maps[from.map]?.npcs?.some(n => n.id === 'transporter' && n.position && Math.hypot(from.x - n.position[0], from.y - n.position[1]) < 75);
}
export function stepIssue(ports: ValidationPorts, from: Point, to: Step, town: boolean): string | null {
  if (!isPoint(to) || !ports.game.maps[to.map]) return 'invalid waypoint';
  if (to.method && !['move', 'door', 'transport', 'town', 'leave'].includes(to.method)) return `unsupported transition ${to.method}`;
  if (to.method === "leave") return leaveIssue(ports.game, from, to);
  if (to.town) return townIssue(ports.game, from, to, town);
  if (!to.transport) return from.map === to.map && ports.walk(from, to) ? null : 'collisions detected';
  return transportIssue(ports, from, to);
}
function townIssue(game: GameData, from: Point, to: Step, allowed: boolean): string | null {
  return allowed && to.map === from.map && atSpawn(game, to, 0) ? null : 'town warp prohibited or invalid spawn';
}
function transportIssue(ports: ValidationPorts, from: Point, to: Step): string | null {
  if (ports.game.maps[to.map].instance || ports.game.maps[to.map].event) return 'instance/event transition requires its workflow';
  if (!Number.isInteger(to.s) || !atSpawn(ports.game, to, to.s!)) return 'invalid destination spawn';
  return doorAllowed(ports, from, to) || transporterAllowed(ports.game, from, to) ? null : 'door/transporter approach or access invalid';
}
export function validateRoute(ports: ValidationPorts, from: Point, destination: Point, plot: Step[], town: boolean, tolerance = 20): Issue | null {
  if (!Array.isArray(plot) || plot.length > 10000) return { reason: 'invalid route size', from, to: destination };
  let previous = from;
  for (const next of plot) {
    const reason = stepIssue(ports, previous, next, town);
    if (reason) return { reason, from: previous, to: next };
    previous = next;
  }
  return distance(previous, destination) <= tolerance ? null : { reason: 'route misses destination', from: previous, to: destination };
}

function leaveIssue(game: GameData, from: Point, to: Step): string | null {
  if (to.town || to.transport || to.s !== undefined || to.key) return 'conflicting leave metadata';
  return ['cyberland', 'jail'].includes(from.map) && to.map === 'main' &&
    (to.in === undefined || to.in === 'main') && atSpawn(game, to, 0) ? null : 'invalid leave exit';
}
