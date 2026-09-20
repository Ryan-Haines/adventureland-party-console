"use client";
import { Item } from "./item";
import { ItemMeta } from "./item-meta";

export function npcSaleValue(item: Item, meta?: ItemMeta | null) {
  const definition = meta?.definition || {};
  if (item.gift) return 1;
  let value = Number(definition.g) || 0;
  value *= definition.cash ? 1 : 0.6;
  if (Number(definition.markup)) value /= Number(definition.markup);
  const level = Math.max(0, Number(item.level) || 0);
  if ((definition.compound || meta?.compoundable) && level) {
    const grades = (definition.grades as number[] | undefined) || [11, 12];
    for (let tier = 1; tier <= level; tier += 1) {
      const grade = tier > grades[1] ? 2 : tier > grades[0] ? 1 : 0;
      if (definition.cash) value *= 1.5;
      else value *= 3.2;
      if (definition.type !== "booster") value += [1000, 40000, 1600000][grade] / 2.4;
      else value *= 0.75;
    }
  }
  if ((definition.upgrade || meta?.upgradeable) && level) {
    const grades = (definition.grades as number[] | undefined) || [11, 12];
    let scrollValue = 0;
    for (let tier = 1; tier <= level; tier += 1) {
      const grade = tier > grades[1] ? 2 : tier > grades[0] ? 1 : 0;
      scrollValue += [1000, 40000, 1600000][grade] / 2;
      if (tier >= 7) {
        value *= 3;
        scrollValue *= 1.32;
      } else if (tier === 6) value *= 2.4;
      else if (tier >= 4) value *= 2;
      if (tier === 9) {
        value *= 2.64;
        value += 400000;
      }
      if (tier === 10) value *= 5;
      if (tier === 12) value *= 0.8;
    }
    value += scrollValue;
  }
  if (item.expires) value /= 8;
  return Math.max(0, Math.round(value));
}
