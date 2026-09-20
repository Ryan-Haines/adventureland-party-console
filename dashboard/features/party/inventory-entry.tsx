"use client";
import { Item } from "./item";
import { ItemMeta } from "./item-meta";
import { Sprite } from "./sprite";

export type InventoryEntry = {
  slot: number;
  item: Item;
  meta?: ItemMeta | null;
  operation?: {
    type: "upgrade" | "compound";
    fromLevel: number;
    toLevel: number;
    chance: number | null;
    sprite: Sprite | null;
  };
};
