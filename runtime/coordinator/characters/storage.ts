import type { StorageMessage } from "./messages.ts";
import type { WorkerStore } from "./types.ts";

interface StoragePorts {
  local: WorkerStore;
  session: WorkerStore;
  reply(message: object): void;
  broadcast(message: object): void;
}

export function synchronizeStorage(message: StorageMessage, ports: StoragePorts): void {
  const store = message.ident === "ls" ? ports.local : ports.session;
  if (message.op === "init") {
    ports.reply({
      type: "stor",
      op: "set",
      ident: message.ident,
      data: Object.fromEntries(store.entries()),
    });
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
  ports.broadcast(message);
}
