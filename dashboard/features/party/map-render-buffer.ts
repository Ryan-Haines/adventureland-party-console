import type { MapFrame } from './map-frame';
import type { MapDefinition } from './map-definition';
import type { MapPlacement } from './map-placement';

export type MapRenderBuffer = {
  frame: MapFrame | null;
  previous: MapFrame | null;
  receivedAt: number;
};
// The console's own map stream sent a frame the view cannot parse: a coordinator bug. Each stream
// reports its first such frame to the browser console and keeps drawing the next good one.
export function mapFrameFailure(stream: string) {
  let reported = false;
  return (error: unknown) => {
    if (reported) return;
    reported = true;
    console.error(`Map stream ${stream} sent a frame the dashboard cannot read`, error);
  };
}
// A hit or heal ring draws as long as the game client shows its damage text (js/functions.js
// `d_text`). The client fades the text one step every `anim_time` ms, max(75, 1800 / size), which
// is 100 for the normal 18 px font (js/game.js `SZ.normal`). Each step takes 0.078 alpha, and the
// client removes the text once its alpha is at or below 0.25, after ten steps. A frame keeps the
// earlier events whose ring still draws.
const TEXT_STEP_MS = Math.max(75, Math.trunc(1800 / 18));
const TEXT_STEPS = Math.ceil((1 - 0.25) / 0.078);
export const HIT_RING_MS = TEXT_STEP_MS * TEXT_STEPS;
export function receiveMapFrame(
  buffer: MapRenderBuffer,
  next: MapFrame,
  receivedAt: number,
  now: number,
) {
  const previous = buffer.frame?.map === next.map ? buffer.frame : null;
  next.events = [
    ...(previous?.events || []).filter((event) => now - event.at < HIT_RING_MS),
    ...(next.events || []),
  ];
  Object.assign(buffer, { frame: next, previous, receivedAt });
}
export function drawDue(now: number, last: number, fps?: number) {
  return !fps || now - last >= 1000 / fps - 0.01;
}
export function prepareMap(definition: MapDefinition) {
  const prepare = (placement: MapPlacement) => {
    const tile = definition.tiles[placement[0]];
    const width = tile?.[3] || 1,
      height = tile?.[4] || width;
    return {
      placement,
      width,
      height,
      left: Math.min(placement[1], placement[3] ?? placement[1]),
      right: Math.max(placement[1], placement[3] ?? placement[1]),
      top: Math.min(placement[2], placement[4] ?? placement[2]),
      bottom: Math.max(placement[2], placement[4] ?? placement[2]),
    };
  };
  return {
    placements: definition.placements.map(prepare),
    groups: definition.groups.map((group) => ({
      y: Math.max(
        ...group.map(
          (v) =>
            v[2] +
            (definition.tiles[v[0]]?.[4] || definition.tiles[v[0]]?.[3] || 0),
        ),
      ),
      placements: group.map(prepare),
    })),
  };
}
export type PreparedPlacement = ReturnType<
  typeof prepareMap
>['placements'][number];
export function visibleTiles(
  p: PreparedPlacement,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  if (
    p.right + p.width < left ||
    p.left > right ||
    p.bottom + p.height < top ||
    p.top > bottom
  )
    return null;
  return {
    left:
      p.left +
      Math.max(0, Math.ceil((left - p.width - p.left) / p.width)) * p.width,
    top:
      p.top +
      Math.max(0, Math.ceil((top - p.height - p.top) / p.height)) * p.height,
    right: Math.min(p.right, right),
    bottom: Math.min(p.bottom, bottom),
  };
}
