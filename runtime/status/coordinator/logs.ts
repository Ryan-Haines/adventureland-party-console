// The logs: each character's combat log, its game log lines, the merchant
// and anniversary activity, and the history the coordinator starts with. The combat logs and the
// activity are saved in the history document, newest the settings owner's `historyKept` each;
// game logs stay in memory. Moved from runtime/coordinator/telemetry/combat-log.ts,
// game-logs.ts, activity.ts, activity-service.ts and initial-history.ts.
import { requestObject, requestText, type HttpRequest, type HttpResponse, type HttpRouter } from "../../lifecycle/api.ts";
import { classifyGameLog, type GameLog } from "../game-log.ts";
import { hiddenValue } from "../../settings/coordinator/api.ts";
import { played } from "../../settings/api.ts";
import { COMBAT_LOG_BATCH, STATUS_PICKS, COMBAT_TYPE_CHARS, GAME_LOG_BATCH, GAME_LOG_COLOR_CHARS, GAME_LOG_SESSION_CHARS } from "../rules.ts";
import type { ActivityEntry, CombatLogEntry, StoredCombatLogEntry } from "../api.ts";
import { capReached } from "./bounds.ts";

// A text cut to its cap counts under the cap's name.
const CUT_CAPS = { COMBAT_TYPE_CHARS, GAME_LOG_SESSION_CHARS, GAME_LOG_COLOR_CHARS };
function cut(text: string, cap: keyof typeof CUT_CAPS): string {
  if (text.length > CUT_CAPS[cap]) capReached(cap, "12");
  return text.slice(0, CUT_CAPS[cap]);
}

const fields = STATUS_PICKS;
// The history document's bound: the in-memory lists keep what it saves. The combat log reads it
// through `played`, so an add-on's overlay sets how many lines it keeps.
const kept = () => played({ historyKept: hiddenValue("historyKept") }, "historyKept");
// A line already kept is not kept twice: a batch the character sends again after a lost answer
// carries the same ids (the line's own id, as game logs use).
const lineId = (entry: { session?: unknown; seq?: unknown }) =>
  typeof entry.session === "string" && Number.isSafeInteger(entry.seq) ? entry.session + ":" + entry.seq : null;

interface CombatLogPorts {
  owned(name: string): boolean;
  now(): number;
  persist(): void;
  /** Saves at once, so a cleared log stays cleared after a crash. */
  persistNow?(): void;
}

function logEntry(value: unknown, now: () => number): CombatLogEntry | null {
  const entry = requestObject(value);
  if (!entry.message) return null;
  const id = lineId(entry);
  return {
    at: Number(entry.at) || now(),
    type: cut(requestText(entry.type || "event"), "COMBAT_TYPE_CHARS"),
    message: requestText(entry.message).slice(0, entry.type === "navigation" ? fields.navigationLineChars : fields.combatLineChars),
    details: entry.details || null,
    ...(id ? { session: entry.session as string, seq: entry.seq as number } : {}),
  };
}

// The one append for a character's combat log: every coordinator writer calls it, and the list
// keeps the history document's bound in memory, so the log shows what the save keeps.
export function appendCombatLog<E>(logs: Record<string, E[] | undefined> | undefined, name: string, entry: E): void {
  if (!logs) return;
  const entries = logs[name] ||= [];
  entries.push(entry);
  if (entries.length > kept()) entries.splice(0, entries.length - kept());
}

/** The combat log and game log routes; each character's list keeps the history document's bound. */
export function createCombatLogRoutes(logs: Record<string, StoredCombatLogEntry[]>, ports: CombatLogPorts) {
  function append(request: HttpRequest, response: HttpResponse): unknown {
    const body = requestObject(request.body),
      name = requestText(body.character || "");
    if (!ports.owned(name)) return response.status(400).json({ error: "unknown character" });
    // A post keeps its newest COMBAT_LOG_BATCH lines, as v1.5.0's
    // route did.
    if (Array.isArray(body.events) && body.events.length > COMBAT_LOG_BATCH) capReached("COMBAT_LOG_BATCH", "12");
    const incoming: unknown[] = Array.isArray(body.events) ? body.events.slice(-COMBAT_LOG_BATCH) : [];
    const entries = logs[name] || (logs[name] = []);
    const ids = new Set(entries.map(lineId).filter(Boolean));
    for (const value of incoming) {
      const entry = logEntry(value, () => ports.now()), id = entry && lineId(entry);
      if (!entry || id && ids.has(id)) continue;
      entries.push(entry);
      if (id) ids.add(id);
    }
    if (entries.length > kept()) entries.splice(0, entries.length - kept());
    ports.persist();
    return response.json({ ok: true, count: entries.length });
  }

  function clear(request: HttpRequest, response: HttpResponse): unknown {
    const name = request.params.character;
    if (!ports.owned(name)) return response.status(400).json({ error: "unknown character" });
    logs[name] = [];
    (ports.persistNow || ports.persist)();
    return response.json({ ok: true });
  }

  function install(router: HttpRouter): void {
    router.post("/party-api/game-logs", (req, res) => appendGameLogs(req, res, name => ports.owned(name)));
    router.post("/party-api/combat-log", append);
    router.post("/party-api/combat-log/:character/clear", clear);
  }

  return { install };
}

// The game log lines each character echoes, in memory only.
export const gameLogs: Record<string, GameLog[]> = {};
export function appendGameLogs(req: HttpRequest, res: HttpResponse, owned: (name: string) => boolean) {
  const body = requestObject(req.body), name = requestText(body.character);
  if (!owned(name)) return res.status(400).json({ error: "Unknown character" });
  const entries = gameLogs[name] ||= [], keys = new Set(entries.map(e => e.session + ":" + e.seq));
  // A post takes its first GAME_LOG_BATCH lines, which is what the character sends (telemetry.ts
  // `pulseGameLogs`).
  if (Array.isArray(body.events) && body.events.length > GAME_LOG_BATCH) capReached("GAME_LOG_BATCH", "12");
  const incoming = Array.isArray(body.events) ? body.events.slice(0, GAME_LOG_BATCH) : [];
  for (const value of incoming) {
    const e = requestObject(value), session = cut(requestText(e.session), "GAME_LOG_SESSION_CHARS"), seq = Number(e.seq);
    if (!session || !Number.isSafeInteger(seq) || keys.has(session + ":" + seq)) continue;
    const message = requestText(e.message).slice(0, fields.gameLineChars);
    entries.push({ session, seq, at: Number(e.at) || Date.now(), message, color: cut(requestText(e.color), "GAME_LOG_COLOR_CHARS"), category: classifyGameLog(message) });
    keys.add(session + ":" + seq);
  }
  if (entries.length > fields.gameLogLines) entries.splice(0, entries.length - fields.gameLogLines);
  return res.json({ ok: true });
}

export function appendActivity(entries: ActivityEntry[], message: string, level: unknown, details: unknown, now: () => number): void {
  entries.push({ at: now(), level, message, details: details || null });
  if (entries.length > kept()) entries.splice(0, entries.length - kept());
}

interface ActivityState {
  merchantActivity: ActivityEntry[];
  anniversary: { activity: ActivityEntry[] };
}
/** The merchant and anniversary activity; a merchant line saves the history document. The merchant job owner writes
 *  the gathering cooldown notice once per cooldown, so every line is kept. */
export function createCoordinatorActivity(state: ActivityState, ports: { now: () => number; persistHistory: () => void }) {
  function merchant(message: string, level: unknown = "info", details?: unknown): void {
    appendActivity(state.merchantActivity, message, level, details, ports.now);
    ports.persistHistory();
  }
  function anniversary(message: string, level: unknown = "info", details?: unknown): void {
    appendActivity(state.anniversary.activity, message, level, details, ports.now);
  }
  return { merchant, anniversary };
}

interface SavedLog {
  [key: string]: unknown;
  message?: string;
  type?: string;
  at?: unknown;
  session?: string;
  seq?: number;
  details?: { xp?: unknown } | null;
}
interface HistorySource {
  merchantActivity?: unknown;
  combatLogs?: Record<string, unknown>;
}

// Saved lines from before the combat log dropped potion lines and kills without their XP.
function visible(entry: SavedLog | null): entry is SavedLog {
  return (
    !!entry &&
    entry.message !== "Used HP potion" &&
    entry.message !== "Used MP potion" &&
    !(entry.type === "kill" && !(entry.details && Number.isFinite(Number(entry.details.xp))))
  );
}
// A saved line from an earlier build carries no id. The value is part of that saved-history format:
// v1.5.0's load (runtime/coordinator/telemetry/initial-history.ts `repeatedSkill`)
// folded a skill line repeated within 1 s, so a history it saved reads back with the same fold.
const LEGACY_SKILL_REPEAT_MS = 1000;
const repeatedSkill = (entry: SavedLog, previous: SavedLog | undefined) => entry.type === "skill" && previous?.type === "skill" &&
  previous.message === entry.message && Math.abs(Number(entry.at) - Number(previous.at)) < LEGACY_SKILL_REPEAT_MS;
function cleanLogs(entries: unknown): SavedLog[] {
  if (!Array.isArray(entries)) return [];
  const cleaned: SavedLog[] = [], ids = new Set<string>();
  for (const entry of (entries as (SavedLog | null)[]).filter(visible)) {
    const id = lineId(entry);
    if (id ? ids.has(id) : repeatedSkill(entry, cleaned[cleaned.length - 1])) continue;
    if (id) ids.add(id);
    cleaned.push(entry);
  }
  return cleaned.slice(-kept());
}

/** The history document wins over the settings document's older copy; each list keeps its newest
 *  `historyKept`. */
export function initialCoordinatorHistory(history: HistorySource, settings: HistorySource) {
  const activity = history.merchantActivity || settings.merchantActivity;
  const combatLogs: Record<string, SavedLog[]> = {};
  for (const [name, entries] of Object.entries(history.combatLogs || settings.combatLogs || {}))
    combatLogs[name] = cleanLogs(entries);
  return { merchantActivity: Array.isArray(activity) ? activity.slice(-kept()) : [], combatLogs };
}
