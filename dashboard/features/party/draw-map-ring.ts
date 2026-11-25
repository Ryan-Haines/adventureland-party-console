import { markerRadius, markerStyle } from "../../../runtime/status/character/marker-style";
import type { MapFrame } from "./map-frame";

type RingFrame = Pick<MapFrame, "target" | "name" | "map" | "grouped" | "eventCombat" | "queue">;

/**
 * The combat queue's ring under one map entity, as the character's own overlay draws it. A grouped
 * or event frame rings each queue entry on this map that is not hidden; any other frame rings the
 * selected target and the monster attacking the character in the current style.
 */
export function drawMapRing(ctx: CanvasRenderingContext2D, frame: RingFrame, entity: { id: string; target?: unknown }, x: number, y: number, scale: number) {
  const queue = frame.queue || [];
  const targeted = frame.target === entity.id;
  const threatening = entity.target === frame.name;
  const eventMarker = frame.eventCombat || queue.some(t => t.state === 'event' || t.state === 'scatter');
  const rank = frame.grouped || eventMarker ? queue.findIndex(t => t.id === entity.id && t.map === frame.map && t.visible !== false) : -1;
  if (rank < 0 && (frame.grouped || eventMarker || !(targeted || threatening))) return;
  const style = rank >= 0 ? markerStyle(queue[rank], rank) : markerStyle({ role: "current" });
  ctx.strokeStyle = style.css;
  ctx.lineWidth = 3 / scale;
  ctx.beginPath();
  // The frame's entity carries no awidth, so a ring with no queue radius takes markerRadius's floor.
  const radius = (rank >= 0 && queue[rank].radius) || markerRadius({});
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (style.double) { ctx.moveTo(x + radius + 6 / scale, y); ctx.arc(x, y, radius + 6 / scale, 0, Math.PI * 2); }
  ctx.stroke();
}
