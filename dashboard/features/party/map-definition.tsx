"use client";
import { MapPlacement } from "./map-placement";
import { MapTile } from "./map-tile";

export type MapDefinition = {
  name: string;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  default?: number | null;
  tiles: MapTile[];
  placements: MapPlacement[];
  groups: MapPlacement[][];
  tilesets: Record<string, { file: string }>;
};
