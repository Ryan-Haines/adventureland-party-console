interface Deploy {
  type: "deploy";
  character?: string;
  realm?: string;
  script?: string;
  version?: number;
}
export type StorageMessage =
  | { type: "stor"; ident: string; op: "set"; data: Record<string, unknown> }
  | { type: "stor"; ident: string; op: "del"; data: string[] }
  | { type: "stor"; ident: string; op: "clear" | "init" };
export type WorkerMessage =
  | { type: "client_update"; event: "welcome" | "reloaded" }
  | Deploy
  | StorageMessage
  | { type: "process_ready" | "initialized" | "bootstrap_failed" | "connected" }
  | { type: "shutdown"; character?: string }
  | { type: "cm"; to: string | string[]; data: unknown };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const string = (value: unknown) => (typeof value === "string" ? value : undefined);

function deployment(value: Record<string, unknown>): Deploy {
  return {
    type: "deploy",
    character: string(value.character),
    realm: string(value.realm),
    script: string(value.script),
    version: typeof value.version === "number" ? value.version : undefined,
  };
}

function storage(value: Record<string, unknown>): StorageMessage | null {
  const ident = string(value.ident) || "";
  if (value.op === "init" || value.op === "clear") return { type: "stor", ident, op: value.op };
  if (value.op === "set" && record(value.data))
    return { type: "stor", ident, op: "set", data: value.data };
  if (
    value.op === "del" &&
    Array.isArray(value.data) &&
    value.data.every((item) => typeof item === "string")
  ) {
    return { type: "stor", ident, op: "del", data: value.data };
  }
  return null;
}

function characterMessage(value: Record<string, unknown>): WorkerMessage | null {
  if (value.type === "deploy") return deployment(value);
  if (value.type === "shutdown") return { type: "shutdown", character: string(value.character) };
  if (value.type !== "cm") return null;
  const to = value.to;
  if (typeof to === "string" || (Array.isArray(to) && to.every((name) => typeof name === "string")))
    return { type: "cm", to, data: value.data };
  return null;
}

/** IPC payloads cross a process boundary; unrecognized messages remain ignored. */
export function workerMessage(value: unknown): WorkerMessage | null {
  if (!record(value)) return null;
  const type = value.type;
  if (type === "client_update" && (value.event === "welcome" || value.event === "reloaded")) return {type, event: value.event};
  if (
    type === "process_ready" ||
    type === "initialized" ||
    type === "bootstrap_failed" ||
    type === "connected"
  )
    return { type };
  if (type === "stor") return storage(value);
  return characterMessage(value);
}
