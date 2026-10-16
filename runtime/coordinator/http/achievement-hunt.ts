import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import { validAchievementHuntSettings, type AchievementHuntSettings } from "../hunt/achievement-settings.ts";
import type { AchievementHuntState } from "../hunt/achievement-hunt.ts";

interface Ports {
  now(): number;
  /** Monster ids Achievement Hunt can target (they have achievements and a route). */
  known(): Set<string>;
  reset(): void;
  persist(): void;
}

/**
 * POST /party-api/achievement-hunt
 *   { settings?: Partial<AchievementHuntSettings>, blacklist?: { action: "add"|"remove"|"clear", monsterId? } }
 */
export function createAchievementHuntRoute(state: AchievementHuntState, ports: Ports) {
  /** Applies a settings patch; returns an error to report, or null. */
  function applySettings(value: unknown, known: Set<string>): [number, string] | null {
    if (!validAchievementHuntSettings(value)) return [400, "Invalid Achievement Hunt settings"];
    const patch = value as Partial<AchievementHuntSettings>;
    if (patch.monsters?.some((id) => !known.has(id))) return [400, "Unknown monster, or one Achievement Hunt cannot target"];
    state.achievementHunt = {
      ...state.achievementHunt,
      ...patch,
      monsters: patch.monsters ? [...new Set(patch.monsters)] : state.achievementHunt.monsters,
    };
    ports.reset();
    return null;
  }
  /** Applies a blacklist change; returns false when the change is invalid. */
  function applyBlacklist(value: unknown, known: Set<string>): boolean {
    const change = requestObject(value),
      action = requestText(change.action),
      id = requestText(change.monsterId);
    if (action === "clear") state.achievementBlacklist = {};
    else if (action === "remove" && id) delete state.achievementBlacklist[id];
    else if (action === "add" && known.has(id)) {
      // The next tick moves on from a blacklisted target and restores its priorities.
      state.achievementBlacklist[id] = { monsterId: id, at: ports.now(), reason: "Manually blacklisted" };
    } else return false;
    return true;
  }
  return function achievementHunt(req: HttpRequest, res: HttpResponse): unknown {
    const request = requestObject(req.body),
      known = ports.known();
    const failure = request.settings !== undefined ? applySettings(request.settings, known) : null;
    if (failure) return res.status(failure[0]).json({ error: failure[1] });
    if (request.blacklist !== undefined && !applyBlacklist(request.blacklist, known))
      return res.status(400).json({ error: "Invalid blacklist change" });
    ports.persist();
    return res.json({
      ok: true,
      achievementHunt: state.achievementHunt,
      achievementBlacklist: state.achievementBlacklist,
      achievementTarget: state.achievementTarget,
      achievementMessage: state.achievementMessage,
    });
  };
}
