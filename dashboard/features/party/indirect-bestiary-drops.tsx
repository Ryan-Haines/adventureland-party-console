"use client";
import { BestiaryDrop } from "./bestiary-drop";
import { BestiaryMonster } from "./bestiary-monster";
import { MerchantCatalogItem } from "./merchant-catalog-item";
import { isDirectDrop } from "./drop-rate";

export function indirectBestiaryDrops(monster: BestiaryMonster, catalog: MerchantCatalogItem[]) {
  const drops: BestiaryDrop[] = [];
  const seenItems = new Set<string>();
  for (const item of catalog) {
    if (seenItems.has(item.id)) continue;
    seenItems.add(item.id);
    for (const source of item.meta?.world?.drops || []) {
      if (
        source.monsterId !== monster.id || !isDirectDrop(source) ||
        (source.sourceType !== "zone" && source.sourceType !== "world")
      )
        continue;
      drops.push({
        id: item.id,
        name: item.name,
        rate: source.rate,
        quantity: source.quantity || 1,
        sprite: item.sprite,
        sourceType: source.sourceType,
        mapName: source.mapName,
      });
    }
  }
  return drops.sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
}
