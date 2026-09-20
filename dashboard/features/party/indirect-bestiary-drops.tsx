"use client";
import { BestiaryDrop } from "./bestiary-drop";
import { BestiaryMonster } from "./bestiary-monster";
import { MerchantCatalogItem } from "./merchant-catalog-item";

export function indirectBestiaryDrops(monster: BestiaryMonster, catalog: MerchantCatalogItem[]) {
  const drops: BestiaryDrop[] = [];
  const seen = new Set<string>();
  for (const item of catalog) {
    for (const source of item.meta?.world?.drops || []) {
      if (
        source.monsterId !== monster.id ||
        (source.sourceType !== "zone" && source.sourceType !== "world")
      )
        continue;
      const key = `${item.id}:${source.sourceType}:${source.mapId || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
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
