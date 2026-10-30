import { randomUUID } from "node:crypto";
import {
  requestObject,
  type HttpRequest,
  type HttpResponse,
  type HttpRouter,
} from "../http/contracts.ts";
import type { PresentationStatus } from "./public-state-types.ts";
import { compactEntry } from "./public-state-characters.ts";

export const liveFields = [
  "hp",
  "mp",
  "max_hp",
  "max_mp",
  "cc",
  "x",
  "y",
  "map",
  "in",
  "xp",
  "max_xp",
  "gold",
  "rip",
  "target",
  "standOpen",
  "conditions",
  "inventorySize",
  "upgradeInventoryBusy",
] as const;
type RecordValue = Record<string, unknown>;
export interface LiveRecord {
  generation: string;
  sample: number;
  sampledAt: number;
  vitals: RecordValue;
  items: RecordValue;
  slots: RecordValue;
}
interface Ports<Timer> {
  now(): number;
  statuses(): Record<string, PresentationStatus>;
  active(name: string): boolean;
  every(callback: () => void, ms: number): Timer;
  cancel(timer: Timer): void;
  /** merchantCatalog, which supplies the per-type meta reports leave out. */
  catalog?(): unknown;
}
function entries(value: unknown): RecordValue {
  return Object.fromEntries(
    Object.entries(requestObject(value)).filter(([key]) => key !== "__proto__"),
  );
}
// jsonEqual answers "is JSON.stringify(a) === JSON.stringify(b)" by walking
// both values and stopping at the first difference. Status records and
// samples come from parsed request JSON, which the walk covers. A toJSON
// method, a non-plain object (Map, Date, boxed primitive), a bigint or a 65th
// level sends the whole field to JSON.stringify, so a cycle repeated on both
// sides still throws there. Identical references compare equal without a walk.
const FALLBACK = Symbol("fallback");
type Equal = boolean | typeof FALLBACK;
const absent = (value: unknown) =>
  value === undefined || typeof value === "function" || typeof value === "symbol";
function plain(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null || Array.isArray(value);
}
// One JSON token kind per value: "absent" is what JSON.stringify drops from an
// object or writes as null in an array.
function kind(value: unknown): string {
  if (value === null || typeof value === "number" && !Number.isFinite(value)) return "null";
  if (absent(value)) return "absent";
  return typeof value;
}
function arrayEqual(a: unknown[], b: unknown[], depth: number): Equal {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const left = absent(a[index]) ? null : a[index], right = absent(b[index]) ? null : b[index];
    const equal = valueEqual(left, right, depth + 1);
    if (equal !== true) return equal;
  }
  return true;
}
// A toJSON can drop its own key, so keys() hands the field to JSON.stringify
// when any entry has one.
function opaque(value: unknown): boolean {
  return typeof value === "bigint" || typeof value === "object" && value !== null &&
    (typeof (value as { toJSON?: unknown }).toJSON === "function" || !plain(value));
}
function keys(value: RecordValue): string[] | typeof FALLBACK {
  const result: string[] = [];
  for (const key of Object.keys(value)) {
    const entry = value[key];
    if (opaque(entry)) return FALLBACK;
    if (!absent(entry)) result.push(key);
  }
  return result;
}
function objectEqual(a: RecordValue, b: RecordValue, depth: number): Equal {
  const left = keys(a), right = keys(b);
  if (left === FALLBACK || right === FALLBACK) return FALLBACK;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
    const equal = valueEqual(a[left[index]], b[left[index]], depth + 1);
    if (equal !== true) return equal;
  }
  return true;
}
function primitiveEqual(a: unknown, b: unknown): boolean {
  const kindA = kind(a);
  return kindA === kind(b) && (kindA === "null" || kindA === "absent");
}
function structureEqual(a: unknown, b: unknown, depth: number): Equal {
  const objectA = typeof a === "object" && a !== null, objectB = typeof b === "object" && b !== null;
  if (objectA !== objectB) return false;
  if (!objectA) return primitiveEqual(a, b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  return Array.isArray(a) ? arrayEqual(a, b as unknown[], depth) : objectEqual(a as RecordValue, b as RecordValue, depth);
}
function valueEqual(a: unknown, b: unknown, depth: number): Equal {
  if (a === b && typeof a !== "bigint") return true;
  if (depth > 64 || opaque(a) || opaque(b)) return FALLBACK;
  return structureEqual(a, b, depth);
}
function jsonEqual(a: unknown, b: unknown): boolean {
  const equal = valueEqual(a, b, 0);
  return equal === FALLBACK ? JSON.stringify(a) === JSON.stringify(b) : equal;
}
/** Fields whose JSON text changed, in the order of before's keys, then after's new keys. */
export function difference(before: RecordValue, after: RecordValue): RecordValue {
  const result: RecordValue = {};
  for (const key of Object.keys(before))
    if (!jsonEqual(before[key], after[key])) result[key] = after[key] ?? null;
  for (const key of Object.keys(after))
    if (!Object.prototype.propertyIsEnumerable.call(before, key) && !jsonEqual(undefined, after[key]))
      result[key] = after[key] ?? null;
  return result;
}
function pickVitals(status: RecordValue): RecordValue {
  return displayVitals(Object.fromEntries(liveFields.map((field) => [field, status[field] ?? null])));
}
/** Display precision only. Never modify the authoritative status or incoming sample. */
function displayVitals(vitals: RecordValue): RecordValue {
  if (!Array.isArray(vitals.conditions)) return vitals;
  const rounded = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.ceil(value / 1000) * 1000 : value;
  return { ...vitals, conditions: vitals.conditions.map(value => {
    const condition = requestObject(value);
    const live = requestObject(condition.live);
    return { ...condition,
      ...('remainingMs' in condition ? { remainingMs: rounded(condition.remainingMs) } : {}),
      ...('ms' in live ? { live: { ...live, ms: rounded(live.ms) } } : {}),
    };
  }) };
}
function bag(status: PresentationStatus, catalog: unknown): RecordValue {
  return Object.fromEntries(
    (status.items || []).map((value, index) => [String(index), compactEntry(value, catalog)]),
  );
}
function compactSlots(value: unknown, catalog: unknown): RecordValue {
  return Object.fromEntries(
    Object.entries(entries(value)).map(([key, entry]) => [
      key,
      entry ? compactEntry(requestObject(entry), catalog) : null,
    ]),
  );
}

/** A display-only store. No automation, roster, ownership, or command ports are available here. */
export function createDashboardStream<Timer>(ports: Ports<Timer>) {
  const epoch = randomUUID();
  let sequence = 0;
  const records = new Map<string, LiveRecord>();
  const joinedCatalogs = new Map<string, unknown>();
  const sessions = new Map<
    string,
    { runtime: string; generation: string; retired: Set<string>; sample: number }
  >();
  const clients = new Map<HttpResponse, Timer>();
  const stalled = new Map<HttpResponse, Timer>();
  const metrics = { accepted: 0, rejected: 0, bytes: 0, slowClients: 0 };
  function sessionFor(name: string, runtime: string) {
    let session = sessions.get(name);
    if (session?.retired.has(runtime)) return;
    if (session?.runtime === runtime) return session;
    const retired = session?.retired || new Set<string>();
    if (session) retired.add(session.runtime);
    session = { runtime, generation: randomUUID(), retired, sample: 0 };
    sessions.set(name, session);
    records.delete(name);
    return session;
  }
  function disconnect(client: HttpResponse) {
    const timer = clients.get(client);
    if (timer !== undefined) ports.cancel(timer);
    clients.delete(client);
    const stall = stalled.get(client);
    if (stall !== undefined) ports.cancel(stall);
    stalled.delete(client);
    client.end();
  }
  function backpressure(client: HttpResponse) {
    if (!client.once) {
      metrics.slowClients++;
      disconnect(client);
      return;
    }
    stalled.set(
      client,
      ports.every(() => {
        metrics.slowClients++;
        disconnect(client);
      }, 1000),
    );
    client.once("drain", () => {
      const timer = stalled.get(client);
      if (timer !== undefined) ports.cancel(timer);
      stalled.delete(client);
    });
  }
  function send(client: HttpResponse, type: string, data: unknown) {
    if (stalled.has(client)) {
      metrics.slowClients++;
      disconnect(client);
      return;
    }
    const message =
      "data: " + JSON.stringify({ epoch, sequence, type, ...requestObject(data) }) + "\n\n";
    metrics.bytes += Buffer.byteLength(message);
    try {
      if (client.write(message) === false) backpressure(client);
    } catch {
      disconnect(client);
    }
  }
  function publish(name: string, next: LiveRecord) {
    const previous = records.get(name);
    records.set(name, next);
    const changed =
      !previous || previous.generation !== next.generation
        ? next
        : {
            ...next,
            vitals: difference(previous.vitals, next.vitals),
            items: difference(previous.items, next.items),
            slots: difference(previous.slots, next.slots),
          };
    if (
      previous &&
      previous.generation === next.generation &&
      !Object.keys(changed.vitals).length &&
      !Object.keys(changed.items).length &&
      !Object.keys(changed.slots).length
    )
      return;
    sequence++;
    for (const client of clients.keys()) send(client, "delta", { characters: { [name]: changed } });
  }
  function observe(name: string) {
    const status = ports.statuses()[name];
    if (!status || !ports.active(name)) return;
    const runtime =
      typeof status.dashboardRuntime === "string" ? status.dashboardRuntime : "legacy";
    const session = sessionFor(name, runtime);
    if (!session) return;
    // Once fast telemetry is accepted, ordinary status owns diagnostics only.
    if (session.sample > 0) return;
    joinedCatalogs.set(name, ports.catalog?.());
    publish(name, {
      generation: session.generation,
      sample: 0,
      sampledAt: ports.now(),
      vitals: pickVitals(status),
      items: bag(status, ports.catalog?.()),
      slots: compactSlots(status.slots, ports.catalog?.()),
    });
  }
  function reconcile() {
    for (const name of records.keys()) {
      if (ports.active(name) && ports.statuses()[name]) continue;
      records.delete(name);
      sessions.delete(name);
      sequence++;
      for (const client of clients.keys()) send(client, "delta", { characters: { [name]: null } });
    }
  }
  function lease(name: string) {
    observe(name);
    return { epoch, generation: sessions.get(name)?.generation, duration: clients.size ? 3000 : 0 };
  }
  function stream(request: HttpRequest, response: HttpResponse) {
    reconcile();
    for (const name of Object.keys(ports.statuses())) observe(name);
    response.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    response.flushHeaders?.();
    const timer = ports.every(() => {
      reconcile();
      send(response, "heartbeat", { at: ports.now() });
    }, 5000);
    clients.set(response, timer);
    request.on("close", () => disconnect(response));
    send(response, "snapshot", { characters: Object.fromEntries(records) });
  }
  function validSample(name: string, body: RecordValue) {
    const session = sessions.get(name);
    return (
      !!session &&
      ports.active(name) &&
      body.epoch === epoch &&
      body.generation === session.generation &&
      body.runtime === session.runtime &&
      ports.statuses()[name]?.dashboardRuntime === session.runtime &&
      Number.isSafeInteger(body.sample) &&
      Number(body.sample) > session.sample
    );
  }
  function receive(request: HttpRequest, response: HttpResponse) {
    const body = requestObject(request.body);
    const name = typeof body.name === "string" ? body.name : "";
    if (!validSample(name, body)) {
      metrics.rejected++;
      return response.status(409).json({ error: "outdated telemetry" });
    }
    const session = sessions.get(name)!;
    if (!clients.size) return response.json({ accepted: false });
    const current = records.get(name)!;
    const data = requestObject(body.data);
    const catalog = ports.catalog?.();
    const itemChanges = compactSlots(data.items, catalog),
      slotChanges = compactSlots(data.slots, catalog);
    if (Object.keys(itemChanges).length > 256 || Object.keys(slotChanges).length > 128)
      return response.status(400).json({ error: "oversized telemetry" });
    session.sample = Number(body.sample);
    metrics.accepted++;
    publish(name, {
      generation: session.generation,
      sample: session.sample,
      sampledAt: Number(body.sampledAt) || ports.now(),
      vitals: { ...current.vitals, ...displayVitals(entries(data.vitals)) },
      // A record published before the catalog arrived gains its per-type
      // meta here, because telemetry only resends the cells that changed.
      items: { ...rejoined(name, current.items, catalog), ...itemChanges },
      slots: { ...rejoined(name, current.slots, catalog), ...slotChanges },
    });
    joinedCatalogs.set(name, catalog);
    return response.json({ accepted: true });
  }
  function rejoined(name: string, cells: RecordValue, catalog: unknown): RecordValue {
    return joinedCatalogs.get(name) === catalog ? cells : compactSlots(cells, catalog);
  }
  function install(router: HttpRouter) {
    router.get("/party-api/dashboard-stream", stream);
    router.post("/party-api/dashboard-telemetry", receive);
  }
  return { install, lease, observe, metrics, count: () => clients.size };
}
