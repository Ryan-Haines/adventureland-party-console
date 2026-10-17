"use client";
import { Sprite } from "./sprite";

export type ItemCraftUse = {
  id: string;
  name: string;
  quantity: number;
  level: number;
  cost: number;
  // The recipe's quest; "mcollector" makes the item Collectable on the game's card.
  quest?: string | null;
  sprite: Sprite | null;
};
