// The door detour ("door approach and detour"): doorDetour searches a small grid from a blocked
// point to the nearest candidate the game's line check reaches, for the door approach and the
// walking endpoint and interior repairs. It never transports or relaxes door access.
import { stepIssue, type ValidationPorts } from "./validation.ts";
import { distance, type Point, type Step } from "./contracts.ts";
import { boundFired } from "../../status/api.ts";
import { DOOR_DETOUR_EXPANSIONS } from "../rules.ts";

interface Node { p: Point; cost: number; score: number; parent?: Node }
const GRID = 8, EXTENT = 28;
function key(from: Point, p: Point): string {
  return Math.round((p.x - from.x) / GRID) + "," + Math.round((p.y - from.y) / GRID);
}
function takeNext(open: Node[]): Node {
  let index = 0;
  for (let i = 1; i < open.length; i++) if (open[i].score < open[index].score) index = i;
  return open.splice(index, 1)[0];
}
function neighbors(from: Point, p: Point): Point[] {
  const result: Point[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (!dx && !dy) continue;
    const next = {map: from.map, x:p.x + dx * GRID, y:p.y + dy * GRID};
    if (Math.abs(next.x - from.x) <= EXTENT * GRID && Math.abs(next.y - from.y) <= EXTENT * GRID) result.push(next);
  }
  return result;
}
function simplify(ports: ValidationPorts, from: Point, node: Node): Point[] {
  const path: Point[] = [], result: Point[] = [];
  for (let current: Node | undefined = node; current?.parent; current = current.parent) path.unshift(current.p);
  let previous = from;
  for (let i = 0; i < path.length; i++) {
    let end = path.length - 1;
    while (end > i && !ports.walk(previous, path[end])) end--;
    result.push(path[end]); previous = path[end]; i = end;
  }
  return result;
}
/** Small native-validated walking search; never transports or relaxes door access. */
export function doorDetour(ports: ValidationPorts, from: Point, to: Step, candidates: Point[]): Point[] | undefined {
  const targets = candidates.filter(p => !stepIssue(ports, p, to, true));
  if (!targets.length || Math.min(...targets.map(p => distance(from, p))) > 160) return;
  const heuristic = (p: Point) => Math.min(...targets.map(t => distance(p, t)));
  const open: Node[] = [{p: from, cost: 0, score: heuristic(from)}];
  const best = new Map<string, number>([[key(from, from), 0]]);
  for (let count = 0; open.length; count++) {
    if (count === DOOR_DETOUR_EXPANSIONS) {
      boundFired({ bound: 'DOOR_DETOUR_EXPANSIONS', owner: '02', state: { from, to: { map: to.map, x: to.x, y: to.y }, open: open.length } });
      return;
    }
    const node = takeNext(open);
    if (node.cost !== best.get(key(from, node.p))) continue;
    if (!stepIssue(ports, node.p, to, true)) return simplify(ports, from, node);
    expand(ports, from, node, best, open, heuristic);
  }
}
function expand(ports: ValidationPorts, from: Point, node: Node, best: Map<string, number>, open: Node[], heuristic: (p: Point) => number): void {
  for (const p of neighbors(from, node.p)) {
    const id = key(from, p), cost = node.cost + distance(node.p, p);
    if (cost >= (best.get(id) ?? Infinity) || !ports.walk(node.p, p)) continue;
    best.set(id, cost); open.push({p, cost, score: cost + heuristic(p), parent: node});
  }
}
