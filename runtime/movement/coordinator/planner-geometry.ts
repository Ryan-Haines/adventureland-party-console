// The planner's game geometry and its unreachable goal (planner-error.ts): the code the planner
// worker and the coordinator both run. It imports no hook, so the worker's bundle
// (planner-worker.ts, movement-planner.cjs) carries none of the hook registry.
import { createContext, runInContext } from 'node:vm';
import type { GameData, Geometry, PlanResult, Point } from '../geometry/contracts.ts';
// The unreachable goal (from planner-error.ts).
/** Empty-path rejection; service callers still reject, HTTP may publish verified worker identity. */
export class UnreachableGoalError extends Error {
  readonly result?: PlanResult;
  constructor(message: string, result?: PlanResult) { super(message); this.result = result; }
}

// The game geometry (from planner-geometry.ts).
// The maps one path search leaves out: the leave recovery's restricted maps, and the maps
// `route.avoid` named. A route's own start and end map stay in, since no route can skip them;
// with neither list the search runs as before, with no avoid list.
export const RESTRICTED_TRANSIT = ['cyberland', 'jail'];
export function avoidedMaps(from: { map: string }, to: { map: string }, avoidLeave: boolean, named: readonly string[] | undefined): string[] | undefined {
  const maps = [...(avoidLeave ? RESTRICTED_TRANSIT : []), ...(named ?? [])].filter(map => map !== from.map && map !== to.map);
  return avoidLeave || maps.length ? [...new Set(maps)] : undefined;
}
// The load runs the game's own initialization before anything hashes or prepares the collision
// geometry. Each game file evaluates within GAME_FILE_EVAL_MS, v1.5.0's 10 s
// (its coordinator/navigation/planner-geometry.ts:15): a bound against a game file that
// never finishes. A cut evaluation throws an error that names the bound, which the thread that
// loaded it reports (runtime.ts `prepareMovement`, `evalBoundFired`); a planner worker's load
// reaches the coordinator thread as its `collisionError` text. `evalMs` is the bound; the unit row
// passes a short one.
export const GAME_FILE_EVAL_MS = 10000;
export const evalBoundFired = (text: unknown) => String(text).includes('GAME_FILE_EVAL_MS');
export function loadCoordinatorGeometry(dataSource: string, commonSource: string, evalMs = GAME_FILE_EVAL_MS) {
  const context = createContext({ Place: 'client' }, { codeGeneration: { strings: false, wasm: false } });
  for (const [filename, source] of [
    ['data.js', dataSource],
    ['old_common_functions.js', commonSource],
    ['prepare-movement.js', 'process_game_data();'],
  ]) {
    try { runInContext(source, context, { filename, timeout: evalMs }); }
    catch (error) {
      if ((error as { code?: string })?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT')
        throw Error(`${filename} did not evaluate within GAME_FILE_EVAL_MS (${evalMs} ms)`);
      throw error;
    }
  }
  if (!context.G?.maps || !context.G?.geometry) throw Error('Missing processed movement geometry');
  return {
    game: context.G as GameData,
    canStand(x: number, y: number): boolean {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !context.G.geometry.main) return false;
      // Native rectangular collision checks include lines crossing the footprint.
      // These are the game's ordinary human movement-base dimensions.
      return context.can_move({map:'main',x,y,going_x:x,going_y:y,base:{h:8,v:7,vn:2}}) === true;
    },
    /** The game's own straight-line collision for a walking edge (#147). */
    canMove(from: Point, to: Point, base: Geometry): boolean {
      if (from.map !== to.map || !context.G.geometry[from.map]) return false;
      return context.can_move({map:from.map,x:from.x,y:from.y,going_x:to.x,going_y:to.y,base}) === true;
    },
  };
}
