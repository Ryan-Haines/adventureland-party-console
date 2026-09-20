export interface CraftNeed { id: string; level?: number; quantity: number }
export interface DeliveryReservation { location: string; slot?: number; item: Item }
export interface CraftProtection { deliveries?: DeliveryReservation[]; requirements: CraftNeed[]; allocations?: (CraftNeed & {location: string})[]; error?: string }
interface Item { name?: string; level?: number; q?: number; [key: string]: unknown }
interface Entry { item?: Item | null; craftLocation?: string; [key: string]: unknown }
/** Apply quantity reservations in source preference order; copies are consumed only once. */
export function availableCraftStock<T extends Entry>(entries: readonly (T | null | undefined)[], protection: CraftProtection): (T | null)[] {
  if (protection.error) return entries.map(() => null);
  entries = withoutDeliveryStock(entries, protection.deliveries || []);
  const remaining = new Map<string, number>();
  for (const need of protection.requirements) {
    const key = need.id + "@" + (need.level || 0);
    remaining.set(key, (remaining.get(key) || 0) + need.quantity);
  }
  const amounts = entries.map(entry => entry?.item ? Number(entry.item.q) || 1 : 0);
  function reserve(index: number, requested: number): number {
    const item = entries[index]?.item;
    if (!item) return 0;
    const key = item.name + "@" + (item.level || 0);
    const reserved = Math.min(remaining.get(key) || 0, amounts[index], requested);
    remaining.set(key, (remaining.get(key) || 0) - reserved);
    amounts[index] -= reserved;
    return reserved;
  }
  // Preserve the allocated source before considering relocation. Otherwise an
  // auto-compound withdrawal could become newly reserved on arrival in the bag.
  for (const allocation of protection.allocations || []) {
    let needed = allocation.quantity;
    entries.forEach((entry, index) => {
      if (entry?.craftLocation === allocation.location && entry.item?.name === allocation.id &&
          (entry.item.level || 0) === (allocation.level || 0)) needed -= reserve(index, needed);
    });
  }
  entries.forEach((_entry, index) => reserve(index, Infinity));
  return entries.map((entry, index) => {
    if (!entry?.item) return entry || null;
    const item = entry.item, quantity = amounts[index];
    const reserved = (Number(item.q) || 1) - quantity;
    if (!reserved) return entry;
    return quantity ? {...entry, item: {...item, q: quantity}} : null;
  });
}

/** Reserve exact slots first, then relocate distinct matching copies within their owner. */
export function withoutDeliveryStock<T extends Entry>(entries: readonly (T | null | undefined)[], marks: DeliveryReservation[]): (T | null)[] {
  const used = new Set<number>(), assigned = new Set<DeliveryReservation>();
  const matches = (entry: T | null | undefined, mark: DeliveryReservation) => !!entry?.item && entry.craftLocation === mark.location &&
    Object.keys(mark.item).filter(key => !['q','price','rid','b','giveaway'].includes(key))
      .every(key => JSON.stringify(entry.item![key]) === JSON.stringify(mark.item[key]));
  function reserve(mark: DeliveryReservation, exact: boolean) {
    const index = entries.findIndex((entry, i) => !used.has(i) && matches(entry,mark) && (!exact || entry?.slot === mark.slot));
    if (index >= 0) { used.add(index); assigned.add(mark); }
  }
  for (const mark of marks) if (mark.slot !== undefined) reserve(mark,true);
  for (const mark of marks) if (!assigned.has(mark)) reserve(mark,false);
  return entries.map((entry,index) => used.has(index) ? null : entry || null);
}
