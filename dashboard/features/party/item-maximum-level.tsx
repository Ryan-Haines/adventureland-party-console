"use client";
import { ItemMeta } from "./item-meta";
import { maximumItemLevel } from "../../../runtime/items/api.ts";

// The highest level the dashboard offers for an item: the items owner's maximum for its kind.
export function itemMaximumLevel(meta?: ItemMeta | null) {
  return maximumItemLevel({ compound: meta?.compoundable, upgrade: meta?.upgradeable });
}
