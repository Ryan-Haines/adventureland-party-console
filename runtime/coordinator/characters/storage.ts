import { metricOutboxOwner } from "../../metrics/contracts.ts";
import type { StorageMessage } from "./messages.ts";
import type { WorkerStore } from "./types.ts";

interface StoragePorts {
  local: WorkerStore;
  session: WorkerStore;
  /** The character whose worker sent the message. */
  owner: string;
  reply(message: object): void;
  broadcast(message: object): void;
}

// Each character's metrics outbox (runtime/characters/metrics.ts) writes a header and a
// frame every second. local_cm_logic in every game CODE runner walks all localStorage keys
// every 16 ms, so synchronizeStorage keeps outbox keys in the journal and sends them only
// to their owner: at init, and never in a broadcast.
const shared = (ident: string, key: string) => ident !== "ls" || metricOutboxOwner(key) === undefined;

function initial(message: StorageMessage, store: WorkerStore, owner: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of store.entries()) {
    if (shared(message.ident, key) || metricOutboxOwner(key) === owner) data[key] = value;
  }
  return data;
}

function broadcastable(message: StorageMessage): StorageMessage | null {
  if (message.op === "set") {
    const data = Object.fromEntries(Object.entries(message.data).filter(([key]) => shared(message.ident, key)));
    return Object.keys(data).length ? { ...message, data } : null;
  }
  if (message.op === "del") {
    const data = message.data.filter((key) => shared(message.ident, key));
    return data.length ? { ...message, data } : null;
  }
  return message;
}

export function synchronizeStorage(message: StorageMessage, ports: StoragePorts): void {
  const store = message.ident === "ls" ? ports.local : ports.session;
  if (message.op === "init") {
    ports.reply({ type: "stor", op: "set", ident: message.ident, data: initial(message, store, ports.owner) });
    return;
  }
  switch (message.op) {
    case "set":
      for (const key in message.data) store.set(key, message.data[key]);
      break;
    case "del":
      for (const key of message.data) store.delete(key);
      break;
    case "clear":
      for (const [key] of store.entries()) store.delete(key);
      break;
  }
  const others = broadcastable(message);
  if (others) ports.broadcast(others);
}
