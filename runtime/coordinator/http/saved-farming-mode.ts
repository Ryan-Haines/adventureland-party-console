import { requestObject, type HttpHandler } from "./contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";

/** Save a follower's future preferences without invoking any active controller. */
export function createSavedFarmingModeRoute(ports: {
  profile(name: string): Record<string, unknown>;
  validLocation(focus: string[], location: unknown): ReturnLocation | null;
  persist(): void;
}): HttpHandler {
  return (req, res) => {
    const body = requestObject(req.body), mode = body.mode;
    if (typeof mode !== "string" || !["auto", "default", "scatter", "hunt"].includes(mode))
      return res.status(400).json({ error: "invalid farming mode" });
    const profile = ports.profile(String(body.character));
    const backup = requestObject(body.backup);
    const focus = body.backup === undefined ? profile.monsterFocus : backup.monsterFocus;
    const location = body.backup === undefined ? profile.location : backup.location;
    let destination: ReturnLocation | null = null;
    if (mode === "hunt") {
      destination = validFocus(focus)
        ? ports.validLocation(focus, location) : null;
      if (!destination) return res.status(body.backup === undefined ? 409 : 400).json({
        code: "backup_required", error: "Choose valid backup farming monsters and a location before saving Hunt",
      });
    }
    if (destination) {
      profile.location = destination;
      profile.monsterFocus = [...new Set(focus as string[])];
    }
    profile.farmingPolicy = mode;
    ports.persist();
    return res.json({ ok: true, farmingPolicy: mode, savedOnly: true });
  };
}

function validFocus(focus: unknown): focus is string[] {
  return Array.isArray(focus) && focus.length > 0 && focus.every(id => typeof id === "string" && id !== "all");
}
