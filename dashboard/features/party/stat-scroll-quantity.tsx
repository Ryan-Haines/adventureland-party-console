"use client";
import { Item } from "./item";
import { ItemMeta } from "./item-meta";

export function statScrollQuantity(meta: ItemMeta | null | undefined, item: Item) {
  const level = Math.max(0, Number(item.level) || 0);
  const grades = Array.isArray(meta?.definition.grades)
    ? (meta.definition.grades as number[])
    : [9, 10, 11, 12];
  const grade =
    level >= (grades[2] ?? 11)
      ? 3
      : level >= (grades[1] ?? 10)
        ? 2
        : level >= (grades[0] ?? 9)
          ? 1
          : 0;
  return [1, 10, 100, 1000][grade] || 1;
}
