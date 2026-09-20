import { parentPort, workerData } from 'node:worker_threads';
import { prepare, getPath } from './alclient-adapter.ts';
import type { GameData, PlanRequest } from '../../navigation/contracts.ts';
const data = workerData as { game: GameData; fingerprint: string; version: number };
prepare(data.game);
parentPort!.postMessage({ ready: true });
parentPort!.on('message', (request: PlanRequest) => {
  const start = performance.now();
  try {
    const plot = getPath(request);
    parentPort!.postMessage({ id: request.id, plot, fingerprint: data.fingerprint, version: data.version, ms: performance.now() - start });
  } catch (error) { parentPort!.postMessage({ id: request.id, error: String(error) }); }
});
