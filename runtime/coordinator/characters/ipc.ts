import { workerMessage, type WorkerMessage } from "./messages.ts";
import { sendWorker } from "./processes.ts";
import { synchronizeStorage } from "./storage.ts";
import type {
  CharacterBlock,
  Lifecycle,
  Worker,
  WorkerArguments,
  WorkerLog,
  WorkerStore,
} from "./types.ts";

export interface IPCPorts {
  blocks: Record<string, CharacterBlock>;
  local: WorkerStore;
  session: WorkerStore;
  log: WorkerLog;
  repair(): Promise<unknown>;
  clientUpdate?(event: "welcome" | "reloaded"): void;
  lifecycle(name: string, lifecycle: Lifecycle): void;
  siblings(): void;
  start(name: string): void;
  stop(block: CharacterBlock, reason?: string): Promise<void>;
}

function deploy(
  name: string,
  block: CharacterBlock,
  message: Extract<WorkerMessage, { type: "deploy" }>,
  ports: IPCPorts,
): void {
  const target = message.character || name;
  const candidate = ports.blocks[target] || (ports.blocks[target] = {});
  candidate.enabled = true;
  candidate.realm = message.realm || block.realm;
  candidate.typescript = block.typescript?.length ? message.script || block.typescript : null;
  candidate.script = message.script || block.script;
  candidate.version = message.version || block.version;
  if (candidate.instance) {
    void ports.stop(candidate, "game requested redeploy");
    candidate.connected = false;
  } else {
    candidate.connected = false;
    ports.start(target);
  }
}

function shutdown(
  name: string,
  block: CharacterBlock,
  character: string | undefined,
  ports: IPCPorts,
): void {
  const candidate = character ? ports.blocks[character] || {} : block;
  ports.log.log(
    character
      ? `shutdown requested for ${character} from ${name}`
      : "shutdown requested from " + name,
  );
  candidate.enabled = false;
  void ports.stop(candidate);
}

function characterMessage(
  name: string,
  block: CharacterBlock,
  message: Extract<WorkerMessage, { type: "cm" }>,
  ports: IPCPorts,
): void {
  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  const local = recipients.filter((target) => ports.blocks[target]?.connected);
  const remote = recipients.filter((target) => !ports.blocks[target]?.connected);
  if (remote.length)
    sendWorker(block.instance, { type: "send_cm", to: remote, data: message.data });
  for (const target of local)
    sendWorker(ports.blocks[target].instance, { type: "receive_cm", name, data: message.data });
}

function broadcast(message: object, ports: IPCPorts): void {
  for (const block of Object.values(ports.blocks)) sendWorker(block.instance, message);
}

export function receiveWorkerMessage(
  name: string,
  block: CharacterBlock,
  worker: Worker,
  args: WorkerArguments,
  value: unknown,
  ports: IPCPorts,
): void {
  if (block.instance !== worker) return;
  const message = workerMessage(value);
  if (!message) return;
  const handlers: Record<WorkerMessage["type"], () => void> = {
    client_update: () => { if (message.type === "client_update" && !block.version) ports.clientUpdate?.(message.event); },
    process_ready: () => sendWorker(worker, { type: "process_args", arguments: args }),
    initialized: () => {},
    bootstrap_failed: () => {
      ports.lifecycle(name, "repairing");
      ports.log.warn(`bootstrap failed for ${name}; refreshing cached game files`);
      block.bootstrapRepair = ports.repair();
    },
    connected: () => {
      block.connected = true;
      ports.lifecycle(name, "online");
      ports.siblings();
    },
    deploy: () => {
      if (message.type === "deploy") deploy(name, block, message, ports);
    },
    shutdown: () => {
      if (message.type === "shutdown") shutdown(name, block, message.character, ports);
    },
    cm: () => {
      if (message.type === "cm") characterMessage(name, block, message, ports);
    },
    stor: () => {
      if (message.type !== "stor") return;
      synchronizeStorage(message, {
        local: ports.local,
        session: ports.session,
        reply: (reply) => sendWorker(block.instance, reply),
        broadcast: (value) => broadcast(value, ports),
      });
    },
  };
  handlers[message.type]();
}
