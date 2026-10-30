import type { GAnimation } from "typed-adventureland";
import type { ServerToClient_action_base } from "typed-adventureland/dist/src/socket-events/server-to-client/events/ServerToClient_action.js";
import type { MapProjectile } from "../map-sprites.ts";
// Upstream action declarations omit native origin_offset; the caller resolves it
// through native projectile_origin before this projection boundary.
export function projectHeadlessAction(
  action: Pick<ServerToClient_action_base, "pid" | "eta">,
  origin: { x: number; y: number },
  target: { x: number; y: number },
  animation: Partial<Pick<GAnimation, "file" | "frames" | "framefps" | "scale" | "directional">>,
  now = Date.now(),
  ray = false,
): MapProjectile | null {
  if (
    typeof action.pid !== "string" ||
    !action.pid ||
    action.pid.length > 128 ||
    !Number.isFinite(action.eta) ||
    (!ray && action.eta <= 0) ||
    action.eta > 30000 ||
    !animation.file ||
    !Number.isFinite(animation.frames) ||
    animation.frames! < 1 ||
    animation.frames! > 256 ||
    ![origin.x, origin.y, target.x, target.y].every(Number.isFinite)
  )
    return null;
  const url = animation.file.startsWith("/")
    ? "https://adventure.land" + animation.file
    : animation.file;
  if (!/^https?:\/\//.test(url) || url.length > 2048) return null;
  return {
    ray,
    id: action.pid,
    url,
    frames: Math.floor(animation.frames!),
    frameMillis: Math.max(1, animation.framefps || 15),
    scale: ray ? 1 : Math.max(0.05, Math.min(10, animation.scale || 1)),
    directional: !!animation.directional,
    startedAt: now,
    expiresAt: now + (ray ? 664 : action.eta),
    x: origin.x,
    y: origin.y,
    targetX: target.x,
    targetY: target.y,
  };
}
Object.assign(globalThis, { projectPartyHeadlessAction: projectHeadlessAction });
