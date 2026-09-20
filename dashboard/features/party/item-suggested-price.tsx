"use client";
import { Sprite } from "./sprite";

export type ItemSuggestedPrice = {
  monsterId: string;
  monsterName: string;
  sprite?: Sprite | null;
  mapId?: string;
  mapName?: string;
  rate: number;
  quantity: number;
  kills: number;
  goldPerKill: number;
  suggested: number;
  paths?: string[];
  worldDrop?: boolean;
  purchase?: boolean;
  attempts?: number;
  scrolls?: number[];
  luckMultiplier?: number;
};
