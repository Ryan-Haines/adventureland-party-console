"use client";
import { Sprite } from "./sprite";

export type ItemDropSource = {
  monsterId: string;
  monsterName: string;
  rate: number;
  quantity: number;
  goldPerKill?: number | null;
  threat?: number;
  sourceType?: "monster" | "zone" | "world";
  mapId?: string;
  mapName?: string;
  baseRate?: number;
  originRate?: number;
  acquisitionPath?: string[];
  sprite?: Sprite | null;
};
