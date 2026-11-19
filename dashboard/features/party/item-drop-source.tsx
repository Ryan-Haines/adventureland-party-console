"use client";
import { Sprite } from "./sprite";

export type ItemDropSource = {
  monsterId: string;
  monsterName: string;
  rate: number;
  quantity: number;
  goldPerKill?: number | null;
  threat?: number;
  sourceType?: "monster" | "home" | "zone" | "world";
  mapId?: string;
  mapName?: string;
  baseRate?: number;
  originRate?: number;
  acquisitionPath?: string[];
  // The event whose window the drop exists only in (items/character/bag.ts `eventWindow`).
  eventWindow?: string;
  sprite?: Sprite | null;
};
