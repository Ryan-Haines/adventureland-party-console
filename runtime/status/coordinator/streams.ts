// The dashboard's live streams: the map
// definitions, the map stream and the dashboard stream. Moved from runtime/coordinator/telemetry/
// maps.ts, map-stream.ts and dashboard-stream.ts. The stream's vitals are table F's `streamFields`.
import { randomUUID } from "node:crypto";
import type { GData } from "typed-adventureland";
import {
  requestObject,
  type HttpRequest,
  type HttpResponse,
  type HttpRouter,
} from "../../lifecycle/api.ts";
import { STATUS_PICKS, streamFields } from "../rules.ts";
import { partyHooks } from "../../hooks/index.ts";
import { createCombatLogRoutes } from "./logs.ts";
import type { StoredCombatLogEntry } from "../api.ts";

import { compactEntry, type PresentationStatus } from "./state.ts";
import { activeCoordinatorNames } from "../../events/coordinator/api.ts";
import { fresh } from "../../protocol/reports.ts";

// The map definitions.
type Animatable = NonNullable<NonNullable<GData['maps']['main']['animatables']>['the_door']>;
export interface MapGeometry {
  min_x?: number;
  min_y?: number;
  max_x?: number;
  max_y?: number;
  default?: number;
  tiles?: readonly (readonly (string | number)[] | null)[];
  placements?: readonly unknown[];
  groups?: readonly unknown[];
}

export interface MapCatalog {
  // typed-adventureland 0.0.57 names only door/lever; native maps also contain
  // dreams_gate. Keep the upstream entry shape while allowing new identifiers.
  maps?: Readonly<Record<string, { animatables?: Readonly<Record<string, Animatable>> }>>;
  geometry?: Readonly<Record<string, MapGeometry | undefined>>;
  tilesets?: Readonly<Record<string, { file?: string } | undefined>>;
}

export interface MapDefinition {
  name: string;
  min_x?: number;
  min_y?: number;
  max_x?: number;
  max_y?: number;
  default: number | null;
  tiles: NonNullable<MapGeometry["tiles"]>;
  placements: readonly unknown[];
  groups: readonly unknown[];
  tilesets: Record<string, { file: string }>;
  decorations?: { kind: 'dreams_gate'; x: number; y: number }[];
}

function tilesetsFor(geometry: MapGeometry, catalog: MapCatalog, extra: string[]): MapDefinition["tilesets"] {
  const used = new Set([...extra, ...(geometry.tiles || []).map((tile) => tile?.[0]).filter(Boolean)]);
  const tilesets: MapDefinition["tilesets"] = {};
  for (const id of used) {
    const definition = catalog.tilesets?.[String(id)];
    if (definition?.file)
      tilesets[String(id)] = { file: "https://adventure.land" + definition.file };
  }
  return tilesets;
}

function describeMap(name: string, geometry: MapGeometry, catalog: MapCatalog): MapDefinition {
  const gate = catalog.maps?.[name]?.animatables?.dreams_gate;
  return {
    name,
    min_x: geometry.min_x,
    min_y: geometry.min_y,
    max_x: geometry.max_x,
    max_y: geometry.max_y,
    default: Number.isInteger(geometry.default) ? Number(geometry.default) : null,
    tiles: geometry.tiles || [],
    placements: geometry.placements || [],
    groups: geometry.groups || [],
    tilesets: tilesetsFor(geometry, catalog, gate ? ['dungeon', 'outside', 'custom_a'] : []),
    decorations: gate ? [{ kind: 'dreams_gate', x: gate.x, y: gate.y }] : [],
  };
}

interface DataPorts {
  read(path: string): string;
  evaluate(source: string, context: object, filename?: string): unknown;
}
/** Cache successful loads, including an empty catalog; failed reads/evaluations remain retryable. */
export function createCoordinatorGameData(
  directory: string,
  version: string | number,
  ports: DataPorts,
) {
  let data: MapCatalog | null = null;
  function load(): MapCatalog {
    if (data) return data;
    const source = ports.read(directory + "/../game_files/" + version + "/data.js");
    const sandbox: { G?: MapCatalog } = {};
    ports.evaluate(source, sandbox, "game_files/" + version + "/data.js");
    data = sandbox.G || {};
    return data;
  }
  return { load };
}

/** Each map of the loaded catalog is described once: the catalog's maps bound the cache, and a new
 *  catalog (a game update) clears it. */
export function createMapDefinitions(load: () => MapCatalog) {
  const cache = new Map<string, MapDefinition>();
  let described: MapCatalog | undefined;
  return {
    get(name: string): MapDefinition | null {
      const catalog = load();
      if (catalog !== described) { cache.clear(); described = catalog; }
      const cached = cache.get(name);
      if (cached) return cached;
      const geometry = catalog.geometry?.[name];
      if (!geometry) return null;
      const result = describeMap(name, geometry, catalog);
      cache.set(name, result);
      return result;
    },
  };
}

// The map stream.
interface MapFrame {
  name: string;
  map: unknown;
  entities: unknown[];
  [field: string]: unknown;
}
interface MapStreamPorts<Timer> {
  owned(name: string): boolean;
  definition(name: string): MapDefinition | null;
  every(callback: () => void, ms: number): Timer;
  cancel(timer: Timer): void;
  /** Maps the characters' latest status reports name. */
  activeMaps?(): Iterable<unknown>;
  /** The party's leader and the map a character's latest report names. */
  leader?(): string | null;
  reportMap?(name: string): unknown;
}

function frame(value: unknown): MapFrame | null {
  const candidate = requestObject(value);
  if (typeof candidate.name !== "string" || !candidate.map || !Array.isArray(candidate.entities))
    return null;
  return candidate as MapFrame;
}

function hasMapTiles(supplied: Record<string, unknown>): boolean {
  return Array.isArray(supplied.tiles) && !!supplied.tiles.length && Array.isArray(supplied.placements) && Array.isArray(supplied.groups) &&
    !!(supplied.placements.length || supplied.groups.length);
}

function generatedDefinition(value: unknown, map: unknown): MapDefinition | null {
  const supplied = requestObject(value);
  if (typeof map !== 'string' || supplied.name !== map || !/^zone_[a-f0-9]+_\d+$/.test(map) ||
    !hasMapTiles(supplied) || !Array.isArray(supplied.tiles) || !Array.isArray(supplied.placements) || !Array.isArray(supplied.groups)) return null;
  const tilesets: MapDefinition['tilesets'] = {};
  for (const [id, value] of Object.entries(requestObject(supplied.tilesets))) {
    const entry = requestObject(value);
    if (typeof entry.file === 'string') tilesets[id] = { file: entry.file };
  }
  const bound = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const defaultTile = (value: unknown) => typeof value === 'number' && Number.isInteger(value) ? value : null;
  return { name: map, min_x: bound(supplied.min_x), min_y: bound(supplied.min_y),
    max_x: bound(supplied.max_x), max_y: bound(supplied.max_y),
    default: defaultTile(supplied.default),
    tiles: supplied.tiles.map(tile => Array.isArray(tile) && tile.every(value => typeof value === 'number' || typeof value === 'string') ? tile : null),
    placements: supplied.placements, groups: supplied.groups, tilesets };
}

const generatedMap = (map: unknown): map is string => typeof map === "string" && /^zone_[a-f0-9]+_\d+$/.test(map);
const generatedRun = (map: string) => map.split("_")[1];

/** Owns live map subscriptions and their heartbeats independently of party status. */
export function createMapStreams<Timer>(ports: MapStreamPorts<Timer>) {
  const subscribers = new Map<string, Set<HttpResponse>>();
  const latest = new Map<string, MapFrame>();
  // Generated Cave floors, keyed zone_<run>_<floor>. A floor stays while a
  // latest frame is on it, and only the newest run's floors stay.
  const generated = new Map<string, MapDefinition>();
  // Each subscriber receives a floor definition once, not on every 10 Hz frame.
  const delivered = new WeakMap<HttpResponse, MapDefinition>();

  function message(current: MapFrame, response: HttpResponse): string {
    const { definition: _supplied, ...rest } = current;
    const definition = generated.get(String(current.map));
    if (!definition || delivered.get(response) === definition) return "data: " + JSON.stringify(rest) + "\n\n";
    delivered.set(response, definition);
    return "data: " + JSON.stringify({ ...rest, definition }) + "\n\n";
  }
  // Status reports keep a floor while a character is on it. The leader's
  // map frames stop once nobody watches it, so its last Cave frame would keep
  // the floor after the run ends.
  function prune(framed?: string): void {
    // A frame can name a new floor before that character's status does.
    const active = new Set([framed, ...[...(ports.activeMaps?.() || [...latest.values()].map((value) => value.map))].map(String)]);
    for (const name of generated.keys()) if (!active.has(name)) generated.delete(name);
  }
  function store(supplied: MapDefinition): void {
    const run = generatedRun(supplied.name);
    for (const name of generated.keys()) if (generatedRun(name) !== run) generated.delete(name);
    if (!generated.has(supplied.name)) generated.set(supplied.name, supplied);
  }

  function subscribe(name: string, request: HttpRequest, response: HttpResponse): void {
    let clients = subscribers.get(name);
    if (!clients) subscribers.set(name, (clients = new Set()));
    clients.add(response);
    const current = latest.get(name);
    if (current) response.write(message(current, response));
    const heartbeat = ports.every(() => response.write(": keepalive\n\n"), STATUS_PICKS.streamHeartbeatMs);
    request.on("close", () => {
      ports.cancel(heartbeat);
      clients.delete(response);
      if (!clients.size) subscribers.delete(name);
    });
  }

  function stream(request: HttpRequest, response: HttpResponse): unknown {
    const name = request.params.character;
    if (!ports.owned(name)) return response.status(404).end();
    response.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    if (typeof response.flushHeaders === "function") response.flushHeaders();
    subscribe(name, request, response);
  }

  function receive(request: HttpRequest, response: HttpResponse): unknown {
    const current = frame(request.body);
    if (!current || !ports.owned(current.name))
      return response.status(400).json({ error: "invalid map frame" });
    // Only the leader's worker receives full floors from the game, so a
    // stripped or missing definition never replaces the one it supplied.
    const supplied = generatedDefinition(current.definition, current.map);
    if (supplied) store(supplied);
    delete current.definition;
    latest.set(current.name, current);
    prune(String(current.map));
    subscribers.get(current.name)?.forEach((client) => client.write(message(current, client)));
    // The supplier sends a floor again only when the coordinator lacks it,
    // as after a coordinator restart.
    if (generatedMap(current.map) && !generated.has(current.map))
      return response.status(200).json({ definition: "needed" });
    return response.sendStatus(204);
  }

  function definition(request: HttpRequest, response: HttpResponse): unknown {
    prune();
    const value = generated.get(request.params.map) || ports.definition(request.params.map);
    if (!value) return response.status(404).json({ error: "unknown map" });
    // A catalog map revalidates by its ETag, so the browser keeps it until the game data changes it.
    response.set("Cache-Control", generated.has(request.params.map) ? "no-store" : "no-cache");
    return response.json(value);
  }

  function install(router: HttpRouter): void {
    router.get("/party-api/maps/:map", definition);
    router.get("/party-api/map-stream/:character", stream);
    router.post("/party-api/map-frame", receive);
  }

  /** A subscriber watches a Cave floor whose definition the coordinator lacks. */
  function floorWanted(map: unknown): boolean {
    if (!generatedMap(map) || generated.has(map)) return false;
    return [...subscribers.keys()].some((name) => latest.get(name)?.map === map);
  }

  // The streams a character's telemetry serves: its own subscribers, and one more for the leader while
  // a watched Cave floor lacks its definition, since only the leader's worker receives full floors
  // (runtime/lifecycle/character/host.ts).
  function count(name: string): number {
    const supplier = name === ports.leader?.() && floorWanted(ports.reportMap?.(name));
    return (subscribers.get(name)?.size || 0) + (supplier ? 1 : 0);
  }
  return { install, count };
}

// The market watch: a dashboard viewer holds this stream while its market or stand panel is open,
// so the stream count says whether anyone watches the market. A closed panel, a closed tab or a lost
// connection closes the stream, and the heartbeat keeps an idle one open through proxies. The market
// feeds refresh for a watcher (items/coordinator/market.ts `wanted`).
export function createMarketWatch<Timer>(ports: Pick<MapStreamPorts<Timer>, "every" | "cancel">) {
  const watchers = new Set<HttpResponse>();
  function stream(request: HttpRequest, response: HttpResponse): void {
    response.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    if (typeof response.flushHeaders === "function") response.flushHeaders();
    watchers.add(response);
    const heartbeat = ports.every(() => response.write(": keepalive\n\n"), STATUS_PICKS.streamHeartbeatMs);
    request.on("close", () => {
      ports.cancel(heartbeat);
      watchers.delete(response);
    });
  }
  function install(router: HttpRouter): void {
    router.get("/party-api/market-watch", stream);
  }
  return { install, watched: () => watchers.size > 0 };
}

// The dashboard stream.
type RecordValue = Record<string, unknown>;
export interface LiveRecord {
  generation: string;
  sample: number;
  vitals: RecordValue;
  items: RecordValue;
  slots: RecordValue;
}
interface Ports<Timer> {
  now(): number;
  statuses(): Record<string, PresentationStatus>;
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
  return displayVitals(Object.fromEntries(streamFields.map((field) => [field, status[field] ?? null])));
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
  // Each blocked client, and whether a heartbeat has passed since its buffer filled.
  const stalled = new Map<HttpResponse, boolean>();
  const metrics = { accepted: 0, rejected: 0, bytes: 0, slowClients: 0 };
  // A character streams while it is one of the coordinator's active names (the events owner's A/B Testing rule)
  // and its own report is present (protocol/reports.ts `fresh`, 'presence').
  function active(name: string): boolean {
    const statuses = ports.statuses(), now = ports.now();
    return activeCoordinatorNames(statuses as Record<string, { name: string; seenAt: number }>, now).includes(name) &&
      fresh(statuses[name]?.seenAt, now, 'presence', 0, true);
  }
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
    if (clients.delete(client)) partyHooks().notify('dashboard.closed', { clients: clients.size, by: 'core:status' });
    stalled.delete(client);
    client.end();
  }
  // A blocked client: its write buffer is full until Node's `drain`. A client whose buffer has not
  // drained across one heartbeat is dropped at the next, so one slow tab never holds the
  // others; a response with no `drain` event never drains.
  function backpressure(client: HttpResponse) {
    if (stalled.has(client)) return;
    stalled.set(client, false);
    client.once?.("drain", () => stalled.delete(client));
  }
  // heartbeat marks a client still blocked after its own write, so a block that starts inside this
  // heartbeat counts and the next heartbeat drops the client.
  function heartbeat(client: HttpResponse) {
    if (stalled.get(client)) {
      metrics.slowClients++;
      disconnect(client);
      return;
    }
    reconcile();
    send(client, "heartbeat", { at: ports.now(), heartbeatMs: STATUS_PICKS.streamHeartbeatMs });
    if (stalled.has(client)) stalled.set(client, true);
  }
  function send(client: HttpResponse, type: string, data: unknown) {
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
    if (!status || !active(name)) return;
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
      vitals: pickVitals(status),
      items: bag(status, ports.catalog?.()),
      slots: compactSlots(status.slots, ports.catalog?.()),
    });
  }
  function reconcile() {
    for (const name of records.keys()) {
      if (active(name) && ports.statuses()[name]) continue;
      records.delete(name);
      sessions.delete(name);
      sequence++;
      for (const client of clients.keys()) send(client, "delta", { characters: { [name]: null } });
    }
  }
  // Each reply says whether a dashboard watches. The character samples while its last reply said
  // so; once the last client leaves, the telemetry route answers `accepted: false` and the next
  // reply says no, either of which ends the character's sampling (character/telemetry.ts).
  function lease(name: string) {
    observe(name);
    return { epoch, generation: sessions.get(name)?.generation, watched: clients.size > 0 };
  }
  // Table R's `dashboard-lease` section: a member whose report names a dashboard runtime gets its
  // lease, and any other member none. Every member's report still reaches `observe`, since a report
  // with no dashboard runtime is the stream's only source of that member's vitals and bag.
  function replyLease(name: string) {
    const granted = lease(name);
    return ports.statuses()[name]?.dashboardRuntime ? granted : undefined;
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
    const timer = ports.every(() => heartbeat(response), STATUS_PICKS.streamHeartbeatMs);
    clients.set(response, timer);
    partyHooks().notify('dashboard.opened', { clients: clients.size, by: 'core:status' });
    request.on("close", () => disconnect(response));
    send(response, "snapshot", { characters: Object.fromEntries(records), heartbeatMs: STATUS_PICKS.streamHeartbeatMs });
  }
  function validSample(name: string, body: RecordValue) {
    const session = sessions.get(name);
    return (
      !!session &&
      active(name) &&
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
    // A change names a bag cell or an equipment slot of the character's last report: the game's bag
    // size and slots bound it, so any other key is no telemetry change.
    const reported = ports.statuses()[name], cells = Array.isArray(reported?.items) ? reported.items.length : 0, slots = requestObject(reported?.slots);
    if (Object.keys(itemChanges).some(key => !(/^\d+$/.test(key) && Number(key) < cells)) || Object.keys(slotChanges).some(key => !Object.hasOwn(slots, key)))
      return response.status(400).json({ error: "oversized telemetry" });
    session.sample = Number(body.sample);
    metrics.accepted++;
    publish(name, {
      generation: session.generation,
      sample: session.sample,
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
  return { install, lease, replyLease, observe, metrics, count: () => clients.size };
}

// The map stream, its definitions over the game data and the combat log routes, which share the
// ownership check; the game data loads once per version, and a new version swaps both together.
// Moved from runtime/coordinator/telemetry/composition.ts.
interface TelemetryPorts<Timer> {
  owned: (name: string) => unknown;
  now: () => number;
  persistHistory: () => void;
  persistHistoryNow?: () => void;
  every: (callback: () => void, milliseconds: number) => Timer;
  cancel: (timer: Timer) => void;
  data: Parameters<typeof createCoordinatorGameData>[2];
  activeMaps?: () => Iterable<unknown>;
  leader?: () => string | null;
  reportMap?: (name: string) => unknown;
}
export function createCoordinatorTelemetry<Timer>(
  directory: string,
  version: string | number,
  logs: Record<string, StoredCombatLogEntry[]>,
  ports: TelemetryPorts<Timer>,
) {
  const owned = (name: string) => !!ports.owned(name);
  const maps = createMapStreams({
    owned,
    definition: (name) => definitions.get(name),
    every: ports.every,
    cancel: ports.cancel,
    activeMaps: ports.activeMaps,
    leader: ports.leader,
    reportMap: ports.reportMap,
  });
  const market = createMarketWatch({ every: ports.every, cancel: ports.cancel });
  const combat = createCombatLogRoutes(logs, {
    owned,
    now: ports.now,
    persist: ports.persistHistory,
    persistNow: ports.persistHistoryNow,
  });
  let definitions = createMapDefinitions(() => data.load());
  let data = createCoordinatorGameData(directory, version, ports.data);
  function prepareVersion(next: number) {
    const candidate = createCoordinatorGameData(directory, next, ports.data);
    const catalog = candidate.load();
    if (!catalog.geometry) throw Error('Candidate game data has no geometry');
    const nextDefinitions = createMapDefinitions(() => candidate.load());
    return () => { data = candidate; definitions = nextDefinitions; };
  }
  return { maps, market, combat, prepareVersion };
}
