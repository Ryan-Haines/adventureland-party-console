import type { MapFrame } from './map-frame';
import type { MapDefinition } from './map-definition';
import type { MapPlacement } from './map-placement';

export type MapRenderBuffer = {
  frame: MapFrame | null;
  previous: MapFrame | null;
  receivedAt: number;
};
export function receiveMapFrame(
  buffer: MapRenderBuffer,
  next: MapFrame,
  receivedAt: number,
  now: number,
) {
  const previous = buffer.frame?.map === next.map ? buffer.frame : null;
  next.events = [
    ...(previous?.events || []).filter((event) => now - event.at < 1100),
    ...(next.events || []),
  ].slice(-80);
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
