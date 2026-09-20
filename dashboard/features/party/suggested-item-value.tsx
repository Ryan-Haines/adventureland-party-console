"use client";
import { InventoryEntry } from "./inventory-entry";
import { ItemSuggestedPrice } from "./item-suggested-price";
import { MerchantBuyItem } from "./merchant-buy-item";
import { UPGRADE_CHANCES } from "./upgrade-chances";
import { upgradeEstimate } from "./upgrade-estimate";

export function suggestedItemValue(entry: InventoryEntry, buyable: MerchantBuyItem[]) {
  const definition = entry.meta?.definition || {};
  const defaultPrice = Math.max(1, Number(definition.g) || 1);
  const precomputed = entry.meta?.world?.suggestedPrices || [];
  const level = Math.max(0, Number(entry.item.level) || 0);
  const catalogItem = buyable.find((item) => item.id === entry.item.name);
  const sources = precomputed.map((source) => {
    let suggested = Math.max(defaultPrice, Number(source.suggested) || defaultPrice);
    if (level > 0 && entry.meta?.upgradeable) {
      const grade = Math.max(
        0,
        Math.min(2, Number(catalogItem?.upgradeGrade ?? definition.igrade) || 0),
      );
      const estimated = upgradeEstimate(
        {
          id: entry.item.name,
          name: String(definition.name || entry.item.name),
          cost: suggested,
          seller: "",
          sprite: entry.meta?.sprite || null,
          upgradeable: true,
          upgradeGrade: grade,
          grades: catalogItem?.grades || (definition.grades as number[] | undefined),
          upgradeChances: catalogItem?.upgradeChances || UPGRADE_CHANCES[grade],
          scrollCosts: catalogItem?.scrollCosts || [1000, 40000, 1600000, 64000000],
        },
        1,
        level,
      );
      suggested = Math.max(suggested, estimated.gold);
    }
    return {
      ...source,
      suggested: Math.max(1, Math.ceil(suggested)),
      purchase: false,
    } as ItemSuggestedPrice;
  });
  if (catalogItem) {
    const estimated = upgradeEstimate(catalogItem, 1, level);
    sources.push({
      monsterId: "__buy__",
      monsterName: level > 0 ? "buy + upgrade" : "buy",
      sprite: null,
      rate: level > 0 ? 0.9 : 1,
      quantity: 1,
      kills: estimated.attempts,
      goldPerKill: 0,
      suggested: Math.max(1, estimated.gold),
      paths: [],
      purchase: true,
      attempts: estimated.attempts,
      scrolls: estimated.scrolls,
    });
  }
  sources.sort((a, b) => a.suggested - b.suggested || a.monsterName.localeCompare(b.monsterName));
  return {
    suggested: sources[0]?.suggested || defaultPrice,
    defaultPrice,
    sources,
  };
}
