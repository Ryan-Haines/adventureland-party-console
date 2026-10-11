import { protectedMerchantStorageStock } from './merchant-storage-stock.ts';
import { isUpgradeOffering, type UpgradeOffering } from '../../upgrade-offerings.ts';

/** Observation boundaries may be absent in older saves or partial dashboard snapshots. */
export function offeringStock(value: unknown): Record<UpgradeOffering, number> {
  const result = {offeringp:0, offering:0, offeringx:0};
  for (const entry of protectedMerchantStorageStock(value)) {
    const item = entry?.item;
    if (item && !item.l && !item.b && isUpgradeOffering(item.name)) result[item.name] += Number(item.q) || 1;
  }
  return result;
}
