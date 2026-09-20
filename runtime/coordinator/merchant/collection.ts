import type { InventoryEntry, ItemMark } from "../contracts/item.ts";
import type { ObservedPosition } from "../contracts/position.ts";
import { markedItem, sameMarkedItem } from "../inventory/item-identity.ts";

const statusLifetimeMs = 15_000;
const nearbyRadius = 200;

function matchesSlot(mark: ItemMark, entry: InventoryEntry, slot: number): boolean {
  if (Number.isInteger(mark.slot) && mark.slot !== slot) return false;
  return sameMarkedItem(entry.item, markedItem(mark));
}

export function collectionSlotCount(
  entries: readonly (InventoryEntry | null)[],
  marks: readonly ItemMark[],
): number {
  const slots = new Set<number>();
  entries.forEach((entry, index) => {
    if (!entry?.item) return;
    const slot = Number.isInteger(entry.slot) ? Number(entry.slot) : index;
    if (marks.some((mark) => matchesSlot(mark, entry, slot))) slots.add(slot);
  });
  return slots.size;
}

export function freshCollectionStatus(status: ObservedPosition | undefined, now: number): boolean {
  return !!status && !(now - Number(status.seenAt || 0) > statusLifetimeMs);
}

function sameLocation(first: ObservedPosition, second: ObservedPosition): boolean {
  return (
    !!first.map &&
    first.map === second.map &&
    !!first.server &&
    first.server === second.server &&
    first.in === second.in
  );
}

export function merchantCollectionNearby(
  merchant: ObservedPosition | undefined,
  target: ObservedPosition | undefined,
  now: number,
): boolean {
  if (!merchant || !target) return false;
  if (!freshCollectionStatus(merchant, now) || !freshCollectionStatus(target, now)) return false;
  if (merchant.rip || target.rip || !sameLocation(merchant, target)) return false;
  if (![merchant.x, merchant.y, target.x, target.y].every(Number.isFinite)) return false;
  return (
    Math.hypot(Number(merchant.x) - Number(target.x), Number(merchant.y) - Number(target.y)) <=
    nearbyRadius
  );
}

export function isItemCollection(reason: string): boolean {
  return ["marked items", "npc sale pickup", "auto npc sale pickup"].includes(reason);
}

export function markedCollectionReady(
  reason: string,
  target: ObservedPosition | undefined,
  count: number,
  threshold: number,
  nearby: boolean,
  now: number,
): boolean {
  if (!isItemCollection(reason)) return true;
  if (!freshCollectionStatus(target, now)) return false;
  return count > 0 && (count >= (threshold || 1) || nearby);
}
