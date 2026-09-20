"use client";
import { ItemMeta } from "./item-meta";

export function itemMaximumLevel(meta?: ItemMeta | null) {
  if (Number.isFinite(Number(meta?.maxLevel)) && Number(meta?.maxLevel) > 0)
    return Number(meta?.maxLevel);
  return meta?.compoundable ? 7 : meta?.upgradeable ? 13 : 0;
}
