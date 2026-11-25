// The idle-aggro cost of a route (step 6 correction 4). A walking segment that enters an idle
// aggressive monster's aggro block costs more than any walkable detour around the blocks, so the
// route takes the shortest such detour, and keeps its line only when none exists. The blocks are
// step safety's: the 3x3 cells of the server's 32-unit grid around each idle monster. The ALClient
// planner (alpathfinder 0.6) takes only a speed and maps to avoid, so the cost applies to the plot
// the planner returns, on the character, where the monsters are seen.
import { isTransition, type Point, type Step } from './contracts.ts';
import { aggroBlock, entersBlock, inBlock, type SafetyMonster, type SafetyPoint } from './step-safety.ts';

export interface RoutedPlot { plot: Step[]; detours: number; crossings: number }

const idle = (m: SafetyMonster) => !m.dead && m.visible !== false && !m.target && Number(m.aggro) > 0;
const length = (a: SafetyPoint, b: SafetyPoint) => Math.hypot(a.x - b.x, a.y - b.y);

// `map` is the map the monster list belongs to; segments elsewhere keep their line.
export function routeAroundIdleAggro(plot: Step[], monsters: SafetyMonster[], walkable: (from: Point, to: Point) => boolean, map?: string): RoutedPlot {
  const pack = monsters.filter(idle);
  if (!pack.length || plot.length < 2) return { plot, detours: 0, crossings: 0 };
  // A segment is clean when the game lets the character walk it and it enters no block it
  // did not start in (step safety's rule for a step out of a block).
  const clean = (a: Point, b: Point) => walkable(a, b) && pack.every(m => inBlock(a, m) || !entersBlock(a, b, m));
  // Detour points sit one unit outside each block's corners; a block's far edges already
  // belong to the next cell.
  const corners = pack.flatMap(m => {
    const box = aggroBlock(m);
    return [[box.x0 - 1, box.y0 - 1], [box.x1, box.y0 - 1], [box.x0 - 1, box.y1], [box.x1, box.y1]].map(([x, y]) => ({ x, y }));
  });
  const routed: Step[] = [plot[0]];
  let detours = 0, crossings = 0;
  for (let i = 1; i < plot.length; i++) {
    const a = plot[i - 1], b = plot[i];
    const walking = !isTransition(a) && !isTransition(b) && a.map === b.map && (!map || a.map === map);
    const blocked = walking && pack.some(m => !inBlock(a, m) && !inBlock(b, m) && entersBlock(a, b, m));
    if (!blocked) { routed.push(b); continue; }
    const at = (p: SafetyPoint): Point => ({ map: a.map, ...(a.in === undefined ? {} : { in: a.in }), x: p.x, y: p.y });
    let best: { cost: number; points: Point[] } | undefined;
    for (const p of corners) {
      const point = at(p), cost = length(a, p) + length(p, b);
      if ((!best || cost < best.cost) && clean(a, point) && clean(point, b)) best = { cost, points: [point] };
    }
    if (!best) for (const p of corners) for (const q of corners) {
      if (p === q) continue;
      const cost = length(a, p) + length(p, q) + length(q, b);
      if (best && cost >= best.cost) continue;
      const first = at(p), second = at(q);
      if (clean(a, first) && clean(first, second) && clean(second, b)) best = { cost, points: [first, second] };
    }
    if (best) { routed.push(...best.points, b); detours++; } else { routed.push(b); crossings++; }
  }
  return { plot: routed, detours, crossings };
}
