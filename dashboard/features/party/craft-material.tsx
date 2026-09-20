"use client";
import { ItemDropSource } from "./item-drop-source";
import { Sprite } from "./sprite";

export type CraftMaterial = {
  id: string;
  name: string;
  quantity: number;
  level: number;
  sprite: Sprite | null;
  drops?: ItemDropSource[];
};
