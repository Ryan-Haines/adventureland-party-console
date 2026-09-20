import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import { createHuntMode, type HuntModeState, type HuntModePorts } from "../hunt/mode.ts";
import type { ReturnLocation } from "../events/return-types.ts";

interface ModePorts extends HuntModePorts {
  waypoint(name: string | null): ReturnLocation | null;
  validLocation(focus: string[], location: unknown): ReturnLocation | null;
  persist(): void;
}
interface Backup {
  monsterFocus: string[];
  location: unknown;
}
function backupValue(value: unknown): Backup | null {
  const body = requestObject(value);
  if (
    !Array.isArray(body.monsterFocus) ||
    !body.monsterFocus.length ||
    body.monsterFocus.includes("all")
  )
    return null;
  return { monsterFocus: body.monsterFocus as string[], location: body.location };
}

export function createHuntModeRoute(state: HuntModeState, ports: ModePorts) {
  const modes = createHuntMode(state, ports);
  function returnLocation(): ReturnLocation | null {
    return state.farmingPolicy === "hunt"
      ? state.monsterHunt?.returnLocation || null
      : ports.waypoint(state.leader);
  }
  function availableHunt(): string | null {
    const names = ports.participants();
    if (!state.leader || !names.length) return "an online non-merchant party leader is required";
    if (
      !state.monsterHunterLocation &&
      !names.some((name) => {
        const quest = state.statuses[name]?.monsterHunt;
        return quest && quest.count > 0 && quest.remainingMs > 0;
      })
    )
      return "Daisy's location is not available yet; wait for the character catalog";
    return null;
  }
  function apply(
    mode: string,
    location: ReturnLocation | null,
    backup: Backup | null,
    supplied: boolean,
    res: HttpResponse,
  ): unknown {
    if (
      mode === "hunt" &&
      (!location || !(backup?.monsterFocus || state.monsterFocus || []).some((id) => id !== "all"))
    )
      return res
        .status(409)
        .json({
          error: "Choose a backup farming location before starting Hunt",
          code: "backup_required",
        });
    modes.select(mode, location, backup?.monsterFocus, supplied);
    ports.persist();
    return res.json({
      ok: true,
      farmingPolicy: state.farmingPolicy,
      monsterHunt: state.monsterHunt,
    });
  }
  return function farmingMode(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      mode = requestText(body.mode);
    if (!["auto", "default", "scatter", "hunt"].includes(mode))
      return res.status(400).json({ error: "invalid farming mode" });
    const unavailable = mode === "hunt" ? availableHunt() : null;
    if (unavailable) return res.status(409).json({ error: unavailable });
    let location = returnLocation();
    let backup: Backup | null = null;
    if (mode === "hunt" && body.backup !== undefined) {
      backup = backupValue(body.backup);
      if (!backup || !ports.validLocation(backup.monsterFocus, backup.location))
        return res.status(400).json({ error: "Select valid backup farming monsters and an area" });
      location = ports.validLocation(backup.monsterFocus, backup.location);
    }
    return apply(mode, location, backup, body.backup !== undefined, res);
  };
}
