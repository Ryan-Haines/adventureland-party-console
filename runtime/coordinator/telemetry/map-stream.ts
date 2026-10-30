import {
  requestObject,
  type HttpRequest,
  type HttpResponse,
  type HttpRouter,
} from "../http/contracts.ts";
import type { MapDefinition } from "./maps.ts";

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
    const heartbeat = ports.every(() => response.write(": keepalive\n\n"), 15_000);
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
    response.set("Cache-Control", generated.has(request.params.map) ? "no-store" : "public, max-age=3600");
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

  return { install, floorWanted, count: (name: string) => subscribers.get(name)?.size || 0 };
}
