import { requestObject } from '../http/contracts.ts';
import { craftProtection, availableCraftStock } from '../merchant/craft-reservations.ts';
import { isUpgradeOffering, type UpgradeOffering } from '../../upgrade-offerings.ts';
import type { InventoryEntry } from '../contracts/item.ts';

/** Observation boundaries may be absent in older saves or partial dashboard snapshots. */
export function offeringStock(value: unknown): Record<UpgradeOffering, number> {
  const state = requestObject(value), merchant = String(state.merchantCharacter);
  const statuses = requestObject(state.statuses), report = requestObject(statuses[merchant]);
  const packs = requestObject(requestObject(state.bankSnapshot).packs);
  const entries = [ ...stockEntries(report.items, 'inventory:' + merchant),
    ...Object.entries(packs).flatMap(([pack, items]) => stockEntries(items, pack)) ];
  const protection = craftProtection({merchantCharacter:merchant,
    merchantQueue:Array.isArray(state.merchantQueue) ? state.merchantQueue : [],
    merchantCurrent:requestObject(state.merchantCurrent),
    merchantDeliveries:Object.fromEntries(Object.entries(requestObject(state.merchantDeliveries)).map(([key,value]) => [key,Array.isArray(value) ? value : []])),
    merchantCatalog:requestObject(state.merchantCatalog)});
  const result = {offeringp:0, offering:0, offeringx:0};
  for (const entry of availableCraftStock(entries, protection)) {
    const item = entry?.item;
    if (item && !item.l && !item.b && isUpgradeOffering(item.name)) result[item.name] += Number(item.q) || 1;
  }
  return result;
}
function stockEntries(value: unknown, location: string): InventoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, slot) => ({...requestObject(raw), slot, craftLocation:location}));
}
