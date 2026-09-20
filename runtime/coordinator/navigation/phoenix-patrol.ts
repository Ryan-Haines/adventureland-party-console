import * as zones from "../../../dashboard/lib/farming-zones.ts";
import type { Area, Checkpoint, Owner, Patrol, Point, Status } from "./rare-types.ts";

export function samples(area: Area): Point[] {
  const [x1, y1, x2, y2] = area.boundary!;
  const nx = Math.max(1, Math.ceil((x2 - x1) / 60)),
    ny = Math.max(1, Math.ceil((y2 - y1) / 60));
  const result: Point[] = [];
  for (let x = 0; x <= nx; x++)
    for (let y = 0; y <= ny; y++)
      result.push({ map: area.map, x: x1 + ((x2 - x1) * x) / nx, y: y1 + ((y2 - y1) * y) / ny });
  return result;
}
const distance = (a: Point, b: Point) =>
  a.map === b.map ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
function axis(a: number, b: number, half: number, current: number): number[] {
  if (b - a <= half * 2)
    return [Math.max(Math.max(a, b - half), Math.min(Math.min(b, a + half), current))];
  const count = Math.ceil((b - a - half * 2) / (half * 1.7));
  return Array.from({ length: count + 1 }, (_, i) => a + half + ((b - a - half * 2) * i) / count);
}
export function scanPoints(area: Area, from: Point): Point[] {
  const [x1, y1, x2, y2] = area.boundary!;
  const origin = from.map === area.map ? from : area;
  const xs = axis(x1, x2, 550, origin.x),
    ys = axis(y1, y2, 350, origin.y);
  const points = ys.flatMap((y, i) =>
    (i % 2 ? xs.slice().reverse() : xs).map((x) => ({ map: area.map, x, y })),
  );
  if (distance(from, points.at(-1)!) < distance(from, points[0])) points.reverse();
  return points;
}
export function newPatrol(owner: Owner, id: string): Patrol {
  return {
    ...owner,
    id,
    index: 0,
    area: null,
    readyAt: 0,
    incomplete: [],
    stage: "travel",
    failures: {},
    points: [],
    remaining: [],
    point: 0,
    arrivedAt: 0,
    fallbacks: 0,
  };
}
export function patrolCheckpoint(p: Patrol, order: string[]): Checkpoint {
  return {
    leader: p.leader,
    realm: p.realm,
    focus: p.focus,
    policy: p.policy,
    revisions: { ...p.revisions },
    regionId: order[p.index],
    readyAt: p.readyAt,
  };
}
interface Ports {
  now: number;
  leader: Status;
  statuses: Status[];
  areas: Area[];
  order: string[];
  convoy: { purpose?: string; phase: string; failureCode?: string } | null | undefined;
  cancel(): void;
  travel(destination: Point): void;
  save(): void;
  stop(reason: string): void;
}
export function patrolControlId(p: Patrol): string {
  return `${p.id}-${p.index}-${p.point}-${p.retry || 0}`;
}
function enter(p: Patrol, ports: Ports): boolean {
  if (p.area) return true;
  p.area = ports.areas.find((a) => a.id === ports.order[p.index]) || null;
  if (!p.area?.boundary) {
    ports.stop("Phoenix spawn catalog changed; choose the route again");
    return false;
  }
  p.points = scanPoints(p.area, ports.leader);
  p.remaining = samples(p.area);
  p.point = 0;
  p.arrivedAt = 0;
  p.failures = {};
  p.fallbacks = 0;
  p.progressAt = ports.now;
  p.progressPosition = undefined;
  p.progressPoint = undefined;
  p.retryReason = undefined;
  return true;
}
function next(p: Patrol, ports: Ports, incomplete: boolean): void {
  ports.cancel();
  const id = p.area!.id!;
  if (incomplete && !p.incomplete.includes(id)) p.incomplete.push(id);
  if (!incomplete) p.incomplete = p.incomplete.filter((value) => value !== id);
  if (p.incomplete.length === 5) {
    p.paused = true;
    p.message = "All Phoenix regions unreachable; restart the route to retry";
    ports.save();
    return;
  }
  p.index = (p.index + 1) % 5;
  p.area = null;
  p.readyAt = 0;
  p.waitingRegion = false;
  ports.save();
}
function coverage(p: Patrol, ports: Ports): void {
  if (ports.now < p.readyAt) return;
  for (const s of ports.statuses) {
    if (!observes(s, p, ports.now)) continue;
    const observation = s.rareObservation!;
    p.remaining = p.remaining.filter(
      (point) => Math.abs(point.x - observation.x) > 570 || Math.abs(point.y - observation.y) > 370,
    );
  }
}
function observes(s: Status, p: Patrol, now: number): boolean {
  if (!s || s.seenAt < now - 3000 || s.rip || s.hp === 0) return false;
  return freshObservation(s,p,now);
}
function freshObservation(s: Status, p: Patrol, now: number): boolean {
  const o = s.rareObservation;
  if (!o || o.runtimeId !== s.combatSelection?.runtimeId || o.at < Math.max(now - 3000,p.readyAt) || o.at > now + 1000) return false;
  return (
    o.map === p.area!.map && o.in === p.area!.map &&
    `${s.region || ""}:${o.server}` === p.realm
  );
}
function stalled(p: Patrol, ports: Ports, destination: Point): boolean {
  const id = patrolControlId(p),
    position = p.progressPosition;
  if (p.progressPoint !== id || !position || distance(position, ports.leader) >= 10) {
    p.progressPoint = id;
    p.progressPosition = { map: ports.leader.map, x: ports.leader.x, y: ports.leader.y };
    p.progressAt = ports.now;
  }
  if (distance(ports.leader, destination) <= 40) {
    p.progressAt = ports.now;
    return false;
  }
  return ports.now - (p.progressAt || ports.now) >= 30000;
}
function failure(p: Patrol, ports: Ports, destination: Point, reason: string): void {
  ports.cancel();
  p.retryReason = reason;
  p.arrivedAt = 0;
  const attempts = (p.failures[p.point] = (p.failures[p.point] || 0) + 1);
  p.retry = (p.retry || 0) + 1;
  p.progressAt = ports.now;
  if (attempts <= 1) return;
  if (p.fallbacks >= 4) {
    next(p, ports, true);
    return;
  }
  const remaining = p.remaining[0] || destination;
  const [dx, dy] = [
    [-200, 0],
    [200, 0],
    [0, -200],
    [0, 200],
  ][p.fallbacks++];
  const [x1,y1,x2,y2]=p.area!.boundary!;
  p.points[++p.point] = { map: remaining.map,
    x: Math.max(x1,Math.min(x2,remaining.x+dx)), y: Math.max(y1,Math.min(y2,remaining.y+dy)) };
}
function arrived(p: Patrol, ports: Ports): void {
  if (ports.convoy?.purpose === "phoenix-patrol") return; // Let every member acknowledge this generation first.
  ports.cancel();
  // An observation before the respawn deadline cannot finish the post-respawn scan.
  if (ports.now < p.readyAt) {
    p.arrivedAt = 0;
    return;
  }
  p.arrivedAt ||= ports.now;
  if (ports.now - p.arrivedAt < 1000) return;
  if (!p.remaining.length) {
    next(p, ports, false);
    return;
  }
  p.point++;
  p.arrivedAt = 0;
  if (p.point === p.points.length && p.fallbacks++ < 4) p.points.push({ ...p.remaining[0] });
}
export function stepPatrol(p: Patrol, ports: Ports): void {
  if (!canScan(p, ports)) return;
  const destination = p.points[p.point];
  if (!destination) {
    next(p, ports, p.remaining.length > 0);
    return;
  }
  scanMessage(p, ports.now);
  coverage(p, ports);
  const reason = movementFailure(p, ports, destination);
  if (reason) {
    failure(p, ports, destination, reason);
    return;
  }
  if (distance(ports.leader, destination) <= 40) {
    arrived(p, ports);
    return;
  }
  p.arrivedAt = 0;
  // Every scan leg has one owner, including the final short approach.
  if (!ports.convoy) ports.travel(destination);
}
function canScan(p: Patrol, ports: Ports): boolean {
  return !p.paused && !p.choosing && enter(p,ports) && !reconnecting(p,ports);
}
function reconnecting(p: Patrol, ports: Ports): boolean {
  const c=ports.convoy;
  if (c?.purpose==='phoenix-patrol' && c.phase==='failed' && ['runtime-lost','unavailable'].includes(c.failureCode || '')) {
    ports.cancel(); p.retryAt=ports.now+5000; p.retry=(p.retry || 0)+1;
    p.progressPosition=undefined; p.retryReason='Party runtime reloaded; retrying the same scan point';
  }
  if (ports.now >= (p.retryAt || 0)) return false;
  p.progressAt=ports.now; p.message='Waiting for party runtimes before resuming the scan';
  return true;
}
function movementFailure(p: Patrol, ports: Ports, destination: Point): string | null {
  if (ports.convoy?.purpose === "phoenix-patrol" && ports.convoy.phase === "failed")
    return "Scan convoy failed";
  return stalled(p, ports, destination) ? "No scan movement progress for 30 seconds" : null;
}

/** Current region wins. Otherwise compare successful planner routes, preserving saved-order ties. */
export async function waitingRegion(
  areas: Area[],
  from: Point,
  routeDistance?: (from: Point, to: Point) => Promise<number>,
): Promise<Area | null> {
  const current = areas.find((a) => a.map === from.map && zones.contains(a, from, 0, 1));
  if (current) return current;
  if (!routeDistance) return null;
  const scored = await Promise.all(
    areas.map(async (area) => {
      try {
        return { area, distance: await routeDistance(from, scanPoints(area, from)[0]) };
      } catch {
        return { area, distance: Infinity };
      }
    }),
  );
  return (
    scored.filter((s) => Number.isFinite(s.distance)).sort((a, b) => a.distance - b.distance)[0]
      ?.area || null
  );
}

function scanMessage(p: Patrol, now: number) {
  p.stage = now < p.readyAt ? "respawn" : "scanning";
  const activity =
    p.stage === "respawn"
      ? `Waiting for respawn (${Math.ceil((p.readyAt - now) / 1000)}s)`
      : "Scanning";
  p.message = `${activity} · region ${p.index + 1}/5 · ${p.area!.map}`;
}
