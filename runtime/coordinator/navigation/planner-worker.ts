import { parentPort, workerData } from 'node:worker_threads';
import { prepare, getPath } from './alclient-adapter.ts';
import {UnreachableGoalError} from './planner-error.ts';
import { loadCoordinatorGeometry } from './planner-geometry.ts';
import { detourRejectedEdges } from './corner-edges.ts';
import type { GameData, PlanRequest } from '../../navigation/contracts.ts';
const data = workerData as { game: GameData; fingerprint: string; version: number; collision?: {data: string; common: string} };
prepare(data.game);
// The game's own collision, when its sources were provided; otherwise plan as before (#147).
let collision: ReturnType<typeof loadCoordinatorGeometry> | null = null;
try { if (data.collision) collision = loadCoordinatorGeometry(data.collision.data, data.collision.common); } catch { collision = null; }
parentPort!.postMessage({ ready: true });
parentPort!.on('message', (request: PlanRequest) => {
  const start = performance.now();
  try {
    const raw = getPath(request);
    const plot = collision ? detourRejectedEdges(raw, request.base || {h:8,v:7,vn:2}, (a, b, base) => collision!.canMove(a, b, base)).plot : raw;
    parentPort!.postMessage({ id: request.id, plot, fingerprint: data.fingerprint, version: data.version, ms: performance.now() - start });
  } catch (error) {
    parentPort!.postMessage({ id: request.id, error: String(error),
      ...(error instanceof UnreachableGoalError ? {failure:'unreachable',plot:[],fingerprint:data.fingerprint,version:data.version,ms:performance.now()-start} : {}) });
  }
});
