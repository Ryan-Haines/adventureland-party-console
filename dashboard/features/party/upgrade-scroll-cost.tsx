"use client";
import { ItemMeta } from "./item-meta";

export function upgradeScrollCost(
  meta: ItemMeta | null | undefined,
  startLevel: number,
  tiers: number,
) {
  const grades = Array.isArray(meta?.definition.grades)
    ? (meta.definition.grades as number[])
    : [9, 10, 11, 12];
  const scrollCosts = [1_000, 40_000, 1_600_000, 64_000_000];
  let total = 0;
  for (let level = startLevel; level < startLevel + tiers; level += 1) {
    const grade =
      level >= (grades[2] ?? 11)
        ? 3
        : level >= (grades[1] ?? 10)
          ? 2
          : level >= (grades[0] ?? 9)
            ? 1
            : 0;
    total += scrollCosts[grade] || 0;
  }
  return total;
}
