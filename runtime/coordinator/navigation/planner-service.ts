import { Worker } from 'node:worker_threads';
import { geometryFingerprint, type GameData, type PlanRequest, type PlanResult } from '../../navigation/contracts.ts';
interface Pending { resolve(result: PlanResult): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
interface Instance { worker: Worker; version: number; fingerprint: string; key: string; ready: Promise<void>; pending: Map<string, Pending>; used: number }
export function createPlannerService(workerFile: string) {
  const instances = new Map<string, Instance>();
  const preparedData = new Map<string, {game: GameData; version: number; attempted: number}>();
  const mode = process.env.PARTY_MOVEMENT_MODE || 'alclient';
  function retire(instance: Instance, reason: string) {
    if (instances.get(instance.key) === instance) instances.delete(instance.key);
    for (const p of instance.pending.values()) { clearTimeout(p.timer); p.reject(Error(reason)); }
    instance.pending.clear(); void instance.worker.terminate();
  }
  function prepare(game: GameData, version: number) {
    const fingerprint = geometryFingerprint(game), key = `${version}:${fingerprint}`, existing = instances.get(key);
    if (existing) return { fingerprint, ready: existing.ready };
    preparedData.set(key, {game, version, attempted: Date.now()});
    while (preparedData.size > 3) preparedData.delete(preparedData.keys().next().value!);
    makeRoom();
    const worker = new Worker(workerFile, { workerData: { game, version, fingerprint } });
    const instance = { worker, version, fingerprint, key, pending: new Map<string, Pending>(), used: Date.now() } as Instance;
    instance.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(Error('Planner preparation timed out')); retire(instance, 'Planner preparation timed out'); }, 10000);
      worker.on('message', message => {
        if (message.ready) { clearTimeout(timer); resolve(); return; }
        const p = instance.pending.get(message.id);
        if (!p) return;
        instance.pending.delete(message.id); clearTimeout(p.timer);
        if (message.error) p.reject(Error(message.error)); else p.resolve(message);
      });
      worker.once('error', error => { clearTimeout(timer); reject(error); retire(instance, error.message); });
      worker.once('exit', () => { clearTimeout(timer); reject(Error('Planner worker exited')); retire(instance, 'Planner worker exited'); });
    });
    // Preparation is optional for game activation; errors are returned to callers as native fallback.
    void instance.ready.catch(() => {});
    worker.unref();
    instances.set(key, instance);
    return { fingerprint, ready: instance.ready };
  }
  function makeRoom() {
    if (instances.size < 3) return;
    const oldest = [...instances.values()].filter(i => !i.pending.size).sort((a, b) => a.used - b.used)[0];
    if (!oldest) throw Error('Planner geometry pool busy');
    retire(oldest, 'Unused game geometry retired');
  }
  function find(request: PlanRequest) {
    const key = `${request.version}:${request.fingerprint}`, saved = preparedData.get(key);
    if (!instances.has(key) && saved && Date.now() - saved.attempted >= 5000) prepare(saved.game, saved.version);
    return instances.get(key);
  }
  async function plan(request: PlanRequest): Promise<PlanResult> {
    if (mode === 'native') throw Error('Native-only movement mode enabled');
    const instance = find(request);
    if (!instance || instance.version !== request.version)
      throw Error(`No compatible game geometry prepared: requested ${request.version}:${request.fingerprint}; retained ${[...preparedData.keys()].join(', ') || 'none'}`);
    await instance.ready;
    if (instance.pending.size >= 32 || instance.pending.has(request.id)) throw Error('Planner queue full or duplicate request');
    instance.used = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => retire(instance, 'ALClient planning timed out (2 seconds)'), 2000);
      instance.pending.set(request.id, { resolve, reject, timer }); instance.worker.postMessage(request);
    });
  }
  return { prepare, plan, mode, dispose() { preparedData.clear(); for (const instance of instances.values()) retire(instance, 'Coordinator stopped'); } };
}
