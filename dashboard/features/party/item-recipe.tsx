"use client";
import { CraftMaterial } from "./craft-material";

export type ItemRecipe = {
  cost: number;
  quest?: string | null;
  materials: CraftMaterial[];
};
