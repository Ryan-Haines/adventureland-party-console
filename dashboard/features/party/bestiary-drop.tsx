"use client";
import { Sprite } from "./sprite";

export type BestiaryDrop = {
  id: string;
  name: string;
  rate: number;
  quantity: number;
  sprite?: Sprite | null;
  sourceType?: "monster" | "zone" | "world";
  mapName?: string;
};
