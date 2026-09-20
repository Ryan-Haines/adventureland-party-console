"use client";
import { Item } from "./item";
import { ItemMeta } from "./item-meta";
import { ITEM_PROPERTY_KEYS } from "./item-property-keys";
import { STAT_SCROLL_BY_STAT } from "./stat-scroll-by-stat";
import { STAT_SCROLLS } from "./stat-scrolls";

export function calculatedLevelProperties(meta: ItemMeta | undefined, item: Item, level: number) {
  const definition = meta?.definition || {};
  const scaling = meta?.scaling || {};
  const values: Record<string, number> = {};
  ITEM_PROPERTY_KEYS.forEach((key) => {
    const base = Number(definition[key]);
    if (Number.isFinite(base)) values[key] = base;
  });
  for (let step = 1; step <= level; step += 1) {
    let multiplier = 1;
    if (meta?.upgradeable) {
      if (step === 7) multiplier = 1.25;
      else if (step === 8) multiplier = 1.5;
      else if (step === 9) multiplier = 2;
      else if (step === 10) multiplier = 3;
      else if (step >= 11) multiplier = 1.25;
    } else if (meta?.compoundable) {
      if (step === 5) multiplier = 1.25;
      else if (step === 6) multiplier = 1.5;
      else if (step === 7) multiplier = 2;
      else if (step >= 8) multiplier = 3;
    }
    Object.entries(scaling).forEach(([key, raw]) => {
      const amount = Number(raw);
      if (!Number.isFinite(amount)) return;
      values[key] =
        (values[key] || 0) +
        (key === "stat" ? Math.round(amount * multiplier) : amount * multiplier);
      if (key === "stat" && step >= 7) values.stat += 1;
    });
  }
  if (level === 10 && values.stat && Number(definition.tier) >= 3) values.stat += 2;
  Object.keys(values).forEach((key) => {
    if (
      ![
        "evasion",
        "miss",
        "reflection",
        "dreturn",
        "lifesteal",
        "manasteal",
        "attr0",
        "attr1",
        "crit",
        "critdamage",
        "breaks",
      ].includes(key)
    )
      values[key] = Math.round(values[key]);
  });
  if (item.stat_type && values.stat) {
    const multiplier =
      STAT_SCROLL_BY_STAT.get(item.stat_type as (typeof STAT_SCROLLS)[number]["stat"])
        ?.multiplier || 1;
    values[item.stat_type] = (values[item.stat_type] || 0) + values.stat * multiplier;
    delete values.stat;
  }
  return values;
}
