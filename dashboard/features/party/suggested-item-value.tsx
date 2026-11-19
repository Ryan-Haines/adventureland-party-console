'use client';
import { InventoryEntry } from './inventory-entry';
import { ItemSuggestedPrice } from './item-suggested-price';
import { MerchantBuyItem } from './merchant-buy-item';
import { useUpgradeEstimates } from './upgrade-estimate';
import { defaultStandPrice, ESTIMATE_QUANTILE, UPGRADE_CHANCES, type UpgradeChoice } from '../../../runtime/items/api.ts';
import { catalogPrice, upgradeScrollPrices } from '@/lib/game-formulas';
import type { MerchantCatalogItem } from './merchant-catalog-item';
export function useSuggestedItemValue(
  entry: InventoryEntry,
  buyable: MerchantBuyItem[],
  catalog: readonly MerchantCatalogItem[],
) {
  const definition = entry.meta?.definition || {},
    defaultPrice = defaultStandPrice(definition),
    level = Math.max(0, Number(entry.item.level) || 0);
  const catalogItem = buyable.find((item) => item.id === entry.item.name),
    precomputed = entry.meta?.world?.suggestedPrices || [];
  // A precomputed source upgrades at the catalog's scroll prices; with one missing, the source shows
  // as unavailable.
  const scrollCosts =
    catalogItem?.scrollCosts ||
    upgradeScrollPrices(catalogPrice(catalog));
  const grade = Math.max(
    0,
    Math.min(2, Number(catalogItem?.upgradeGrade ?? definition.igrade) || 0),
  );
  const lines: {
    key: string;
    quantity: number;
    target: number;
    item: UpgradeChoice;
  }[] = precomputed
    .filter(() => level > 0 && entry.meta?.upgradeable && !!scrollCosts)
    .map((source, index) => ({
      key: String(index),
      quantity: 1,
      target: level,
      item: {
        id: entry.item.name,
        cost: Math.max(defaultPrice, Number(source.suggested) || defaultPrice),
        upgradeable: true,
        upgradeGrade: grade,
        grades:
          catalogItem?.grades || (definition.grades as number[] | undefined),
        upgradeChances: catalogItem?.upgradeChances || UPGRADE_CHANCES[grade],
        scrollCosts: scrollCosts || undefined,
      },
    }));
  if (catalogItem)
    lines.push({ key: 'buy', quantity: 1, target: level, item: catalogItem });
  const estimates = useUpgradeEstimates(lines);
  let pending = false,
    unavailable = false,
    failure: string | undefined;
  const sources: ItemSuggestedPrice[] = [];
  precomputed.forEach((source, index) => {
    const estimate = estimates[String(index)];
    let suggested = Math.max(
      defaultPrice,
      Number(source.suggested) || defaultPrice,
    );
    if (level > 0 && entry.meta?.upgradeable) {
      if (!scrollCosts) {
        unavailable = true;
        return;
      }
      if (!estimate || estimate.status === 'pending') {
        pending = true;
        return;
      }
      if (estimate.status === 'unavailable') {
        unavailable = true;
        failure ??= estimate.error;
        return;
      }
      suggested = Math.max(suggested, estimate.gold);
    }
    sources.push({
      ...source,
      suggested: Math.max(1, Math.ceil(suggested)),
      purchase: false,
    });
  });
  if (catalogItem) {
    const estimate = estimates.buy;
    if (!estimate || estimate.status === 'pending') pending = true;
    else if (estimate.status === 'unavailable') {
      unavailable = true;
      failure ??= estimate.error;
    }
    else
      sources.push({
        monsterId: '__buy__',
        monsterName: level > 0 ? 'buy + upgrade' : 'buy',
        sprite: null,
        // A buy + upgrade costs the estimate's quantile run, so it succeeds at that rate.
        rate: level > 0 ? ESTIMATE_QUANTILE : 1,
        quantity: 1,
        kills: estimate.attempts,
        goldPerKill: 0,
        suggested: Math.max(1, estimate.gold),
        paths: [],
        purchase: true,
        attempts: estimate.attempts,
        scrolls: estimate.scrolls,
      });
  }
  sources.sort(
    (a, b) =>
      a.suggested - b.suggested || a.monsterName.localeCompare(b.monsterName),
  );
  return {
    suggested:
      sources[0]?.suggested ??
      (level > 0 && entry.meta?.upgradeable ? undefined : defaultPrice),
    defaultPrice,
    sources,
    pending,
    unavailable,
    failure,
  };
}
