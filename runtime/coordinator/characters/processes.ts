import type { CharacterBlock, Lifecycle, Worker, WorkerClock, WorkerLog } from "./types.ts";

export function sendWorker(worker: Worker | null | undefined, message: object): void {
  // IPC may close before the exit callback. The existing protocol ignores that send error.
  if (worker) worker.send(message, () => {});
}

export async function stopWorker(
  block: CharacterBlock,
  reason: string,
  clock: WorkerClock,
  log: WorkerLog,
): Promise<void> {
  const worker = block.instance;
  block.instance = null;
  if (!worker) return;
  worker.partyStopReason = reason;
  if (block.connected) {
    log.log("telling client to self-terminate");
    sendWorker(worker, { type: "closing_client" });
    const exited = new Promise<boolean>((resolve) =>
      worker.on("exit", () => {
        log.log("Client terminated gracefully");
        resolve(true);
      }),
    );
    if (await Promise.race([clock.sleep(500), exited])) return;
  }
  log.log("Hard-terminating client");
  worker.kill("SIGKILL");
}

interface ExitPorts {
  clock: WorkerClock;
  log: WorkerLog;
  lifecycle(name: string, lifecycle: Lifecycle): void;
  start(name: string): void;
}

function restartAfterRepair(name: string, block: CharacterBlock, ports: ExitPorts): void {
  ports.lifecycle(name, "failed");
  ports.clock.cancel(block.restart_timeout);
  void Promise.resolve(block.bootstrapRepair)
    .catch((error) => {
      ports.log.warn(`game cache repair failed for ${name}`, error);
    })
    .finally(() => {
      block.bootstrapRepair = null;
      block.restart_timeout = ports.clock.later(() => {
        if (block.enabled && !block.instance) ports.start(name);
      }, 1500);
    });
}

export function workerExited(
  name: string,
  block: CharacterBlock,
  worker: Worker,
  code: number | null,
  signal: string | null,
  ports: ExitPorts,
): void {
  const exit = {
    at: ports.clock.now(),
    code,
    signal,
    reason: worker.partyStopReason || "unexpected worker exit",
  };
  ports.log.log(`[worker-exit] ${name}: ${JSON.stringify(exit)}`);
  // A retired worker cannot clear the connection or monitor of its replacement.
  if (block.instance && block.instance !== worker) return;
  block.lastExit = exit;
  if (block.monitor) {
    block.monitor.destroy();
    block.monitor = null;
  }
  block.connected = false;
  block.instance = null;
  if (block.clientUpdating) return;
  if (block.enabled) restartAfterRepair(name, block, ports);
  else ports.lifecycle(name, "offline");
}
