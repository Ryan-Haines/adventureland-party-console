"use client";
import { CraftMaterial } from "./craft-material";
import { Sprite } from "./sprite";

export type MerchantCraftRecipe = {
  id: string;
  name: string;
  cost: number;
  sprite: Sprite | null;
  materials: CraftMaterial[];
};
