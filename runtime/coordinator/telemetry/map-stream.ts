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
}

function frame(value: unknown): MapFrame | null {
  const candidate = requestObject(value);
  if (typeof candidate.name !== "string" || !candidate.map || !Array.isArray(candidate.entities))
    return null;
  return candidate as MapFrame;
}

/** Owns live map subscriptions and their heartbeats independently of party status. */
export function createMapStreams<Timer>(ports: MapStreamPorts<Timer>) {
  const subscribers = new Map<string, Set<HttpResponse>>();
  const latest = new Map<string, MapFrame>();

  function subscribe(name: string, request: HttpRequest, response: HttpResponse): void {
    let clients = subscribers.get(name);
    if (!clients) subscribers.set(name, (clients = new Set()));
    clients.add(response);
    const current = latest.get(name);
    if (current) response.write("data: " + JSON.stringify(current) + "\n\n");
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
    latest.set(current.name, current);
    const clients = subscribers.get(current.name);
    if (clients) {
      const message = "data: " + JSON.stringify(current) + "\n\n";
      clients.forEach((client) => client.write(message));
    }
    return response.sendStatus(204);
  }

  function definition(request: HttpRequest, response: HttpResponse): unknown {
    const value = ports.definition(request.params.map);
    if (!value) return response.status(404).json({ error: "unknown map" });
    response.set("Cache-Control", "public, max-age=3600");
    return response.json(value);
  }

  function install(router: HttpRouter): void {
    router.get("/party-api/maps/:map", definition);
    router.get("/party-api/map-stream/:character", stream);
    router.post("/party-api/map-frame", receive);
  }

  return { install, count: (name: string) => subscribers.get(name)?.size || 0 };
}
