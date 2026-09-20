"use client";
import { Location } from "./location";
import { Sprite } from "./sprite";

export type SpawnRecord = {
  sourceMap: string;
  map: string;
  mapName?: string;
  x?: number;
  y?: number;
  boundary?: number[];
  polygon?: number[][];
  count?: number;
  restrictions: string[];
};

export type MonsterChoice = {
  id: string;
  name: string;
  sprite?: Sprite | null;
  spawnRecords?: SpawnRecord[];
  locations?: (Location & { mapName?: string; boundary?: number[] })[];
};
