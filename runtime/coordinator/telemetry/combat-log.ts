import { appendGameLogs } from "./game-logs.ts";
import {
  requestObject,
  requestText,
  type HttpRequest,
  type HttpResponse,
  type HttpRouter,
} from "../http/contracts.ts";

export interface CombatLogEntry {
  at: number;
  type: string;
  message: string;
  details: unknown;
}
/** Older retained logs are not normalized by the append endpoint. */
export interface StoredCombatLogEntry {
  at?: unknown;
  type?: string;
  message?: string;
  details?: unknown;
}
interface CombatLogPorts {
  owned(name: string): boolean;
  now(): number;
  persist(): void;
}

function logEntry(value: unknown, now: () => number): CombatLogEntry | null {
  const entry = requestObject(value);
  if (!entry.message) return null;
  return {
    at: Number(entry.at) || now(),
    type: requestText(entry.type || "event").slice(0, 24),
    message: requestText(entry.message).slice(0, entry.type === 'navigation' ? 1200 : 240),
    details: entry.details || null,
  };
}

/** Limits each incoming batch and each character's retained stream independently. */
export function createCombatLogRoutes(
  logs: Record<string, StoredCombatLogEntry[]>,
  ports: CombatLogPorts,
) {
  function append(request: HttpRequest, response: HttpResponse): unknown {
    const body = requestObject(request.body),
      name = requestText(body.character || "");
    if (!ports.owned(name)) return response.status(400).json({ error: "unknown character" });
    const incoming: unknown[] = Array.isArray(body.events) ? body.events : [];
    const entries = logs[name] || (logs[name] = []);
    incoming.slice(-20).forEach((value) => {
      const entry = logEntry(value, () => ports.now());
      if (entry) entries.push(entry);
    });
    if (entries.length > 500) entries.splice(0, entries.length - 500);
    ports.persist();
    return response.json({ ok: true, count: entries.length });
  }

  function clear(request: HttpRequest, response: HttpResponse): unknown {
    const name = request.params.character;
    if (!ports.owned(name)) return response.status(400).json({ error: "unknown character" });
    logs[name] = [];
    ports.persist();
    return response.json({ ok: true });
  }

  function install(router: HttpRouter): void {
    router.post("/party-api/game-logs", (req, res) => appendGameLogs(req, res, name => ports.owned(name)));
    router.post("/party-api/combat-log", append);
    router.post("/party-api/combat-log/:character/clear", clear);
  }

  return { install };
}
