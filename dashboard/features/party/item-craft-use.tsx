"use client";
import { Sprite } from "./sprite";

export type ItemCraftUse = {
  id: string;
  name: string;
  quantity: number;
  level: number;
  cost: number;
  sprite: Sprite | null;
};
