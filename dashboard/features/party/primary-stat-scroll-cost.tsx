"use client";
import { Item } from "./item";
import { ItemMeta } from "./item-meta";
import { statScrollQuantity } from "./stat-scroll-quantity";

export function primaryStatScrollCost(meta: ItemMeta | null | undefined, item: Item) {
  return statScrollQuantity(meta, item) * 8_000;
}
