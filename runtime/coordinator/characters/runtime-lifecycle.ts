import type { ChildProcess } from "node:child_process";
import type { watchGenerations } from "../../lifecycle/generations.ts";

type GenerationPorts = Parameters<typeof watchGenerations>[0];
interface WorkerBlock {
  enabled?: boolean;
  instance?: ChildProcess | null;
  script?: string;
}
interface LifecyclePorts<Block> {
  owned: (name: string) => { type?: string };
  stop: (block: Block, reason: string) => Promise<unknown>;
  report: (message: string, details?: unknown) => void;
}

/** Resolve live worker identities at every callback so replaced processes cannot receive stale reloads. */
export function coordinatorGenerationPorts<Block extends WorkerBlock>(
  workers: Record<string, Block>,
  ports: LifecyclePorts<Block>,
): GenerationPorts {
  return {
    directory: "./CODE/adventure_land",
    workers: () =>
      Object.entries(workers)
        .filter(([, block]) => block.enabled && block.instance)
        .map(([name, block]) => ({
          name,
          className: ports.owned(name).type,
          process: block.instance!,
          script: block.script,
        })),
    current: (worker) =>
      workers[worker.name].enabled && workers[worker.name].instance === worker.process,
    activated: (worker, script) => {
      workers[worker.name].script = script;
    },
    restart: async (worker, script, reason) => {
      const block = workers[worker.name];
      block.script = script;
      await ports.stop(block, reason);
    },
    report: ports.report,
  };
}

interface ProcessEvents {
  on: (event: string, listener: (message?: unknown) => void) => unknown;
}

export function installCoordinatorShutdownSignals(
  events: ProcessEvents,
  shutdown: (reason: string) => Promise<unknown>,
): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGQUIT"])
    events.on(signal, () => {
      void shutdown(signal);
    });
  events.on("message", (message) => {
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "coordinator_shutdown"
    )
      void shutdown("coordinator reload request");
  });
}
