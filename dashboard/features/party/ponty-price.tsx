"use client";
import { Item } from "./item";
import { ItemMeta } from "./item-meta";
import { npcSaleValue } from "./npc-sale-value";

export function pontyPrice(item: Item, meta?: ItemMeta | null) {
  const definition = meta?.definition || {};
  const level = Math.max(0, Number(item.level) || 0);
  // Ponty uses 2 × Adventure Land's calculated item value (3 × for cash
  // items). Some lightweight inventory snapshots omit the explicit upgrade /
  // compound flags, so infer the progression kind from the catalog max level
  // and equipment type instead of silently pricing a +level as level zero.
  const compoundTypes = new Set(["ring", "earring", "amulet", "belt", "orb"]);
  const compoundable = !!(
    meta?.compoundable ||
    definition.compound ||
    Number(meta?.maxLevel) === 7 ||
    (level && compoundTypes.has(String(definition.type || "")))
  );
  const upgradeable = !!(
    meta?.upgradeable ||
    definition.upgrade ||
    Number(meta?.maxLevel) === 13 ||
    (level && !compoundable)
  );
  const pricingMeta: ItemMeta = {
    ...(meta || { definition, sprite: null }),
    definition,
    compoundable,
    upgradeable,
  };
  return npcSaleValue(item, pricingMeta) * (definition.cash ? 3 : 2);
}
