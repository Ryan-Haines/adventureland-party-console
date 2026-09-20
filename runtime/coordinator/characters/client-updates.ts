import type { CharacterBlock, Worker } from './types.ts';
export interface ClientRevision { version: number; revision: string }
export interface ClientUpdateStatus { phase: string; version: number; target?: number; character?: string; error?: string }
interface Ports<Data> {
  current(): ClientRevision;
  refresh(force: boolean): Promise<ClientRevision>;
  prepare(candidate: ClientRevision): Data | Promise<Data>;
  activate(candidate: ClientRevision, data: Data): void;
  blocks: Record<string, CharacterBlock>;
  stop(block: CharacterBlock, reason: string): Promise<void>;
  start(name: string): Worker | undefined;
  healthy(name: string, worker: Worker, candidate: ClientRevision): boolean;
  now(): number;
  sleep(ms: number): Promise<unknown>;
  cancel(timer: ReturnType<typeof setTimeout> | undefined): void;
  status(value: ClientUpdateStatus): void;
}
/** Event-driven single-flight refresh. No periodic discovery; heartbeat waits only during activation. */
export function createClientUpdates<Data>(ports: Ports<Data>) {
  let running: Promise<void> | null = null;
  let reloadAgain = false;
  const pending = new Set<string>();
  const eligible = (block: CharacterBlock) => !!block.enabled && !block.version;
  function report(phase: string, candidate?: ClientRevision, character?: string, error?: unknown) {
    ports.status({phase, version: ports.current().version, target: candidate?.version, character,
      ...(error ? {error: error instanceof Error ? error.message : JSON.stringify(error)} : {})});
  }
  async function restart(name: string, candidate: ClientRevision): Promise<void> {
    const block = ports.blocks[name];
    if (!eligible(block)) return;
    report('restarting', candidate, name);
    block.clientUpdating = true;
    ports.cancel(block.restart_timeout);
    try { await ports.stop(block, 'activating game client ' + candidate.version); }
    finally { block.clientUpdating = false; }
    if (!eligible(block)) return;
    const worker = ports.start(name);
    if (!worker) throw Error('Could not start ' + name);
    const deadline = ports.now() + 60000;
    while (ports.now() < deadline) {
      if (!eligible(block)) return;
      if (block.instance !== worker) throw Error(name + ' exited during client activation');
      if (ports.healthy(name, worker, candidate)) return;
      await ports.sleep(250);
    }
    throw Error('No fresh heartbeat from ' + name + ' after client activation');
  }
  async function update(force: boolean): Promise<void> {
    const before = ports.current();
    report('checking');
    const candidate = await ports.refresh(force);
    if (candidate.version < before.version) throw Error('Official client version is older than the active client');
    if (candidate.version !== before.version || candidate.revision !== before.revision) {
      const data = await ports.prepare(candidate);
      ports.activate(candidate, data);
      for (const [name, block] of Object.entries(ports.blocks)) if (eligible(block)) pending.add(name);
    }
    for (const name of pending) { await restart(name, candidate); pending.delete(name); }
    report('ready', candidate);
  }
  function request(event: 'welcome' | 'reloaded' | 'repair'): Promise<void> {
    if (running) { if (event === 'reloaded') reloadAgain = true; return running; }
    running = (async () => {
      try {
        await update(event !== 'welcome');
        while (reloadAgain) { reloadAgain = false; await update(true); }
      } catch (error) { report('failed', undefined, undefined, error); }
      finally { running = null; }
    })();
    return running;
  }
  return {request};
}
