// The deliveries: a delivery request, the stock the merchant holds for it,
// and the recovery of a delivery left in flight, read from the merchant's and the recipient's bags.
import type { InventoryEntry, Item } from '../../coordinator/contracts/item.ts';
import { randomUUID } from 'node:crypto';
import { fresh } from '../../protocol/reports.ts';

export interface DeliveryRequest {
  id?: string;
  slot?: number;
  item?: Item;
  equipOnDelivery?: boolean;
  awaitingEquip?: boolean;
  /** Failed native equip receipt; wait for a later full merchant inventory. */
  equipFailedAt?: number;
  blocked?: string;
  legacy?: boolean;
}

export function deliveryReady(mark: DeliveryRequest): boolean {
  return !!mark.item && !mark.awaitingEquip && !mark.blocked;
}
interface InventoryStatus {
  seenAt?: number;
  inventorySeenAt?: number;
  items?: (InventoryEntry | null)[];
  slots?: Record<string, {item?: Item} | null>;
}
export function deliveryMatches(actual: Item | null | undefined, wanted: Item | undefined): boolean {
  return !!actual && !!wanted && Object.keys(wanted).filter(key => key !== 'q')
    .every(key => JSON.stringify(actual[key] ?? null) === JSON.stringify(wanted[key] ?? null));
}
/** Keep surviving slot assignments first, then relocate displaced requests across all recipients.
 * Quantities belong to requests, so merging/growing a stack must not change the amount owed.
 */
function allocateStock(marks: DeliveryRequest[], merchant: InventoryStatus): Map<DeliveryRequest, InventoryEntry> {
  const stock = (merchant.items || []).filter((entry): entry is InventoryEntry => !!entry?.item);
  const remaining = new Map(stock.map(entry => [entry, Number(entry.item?.q || 1)]));
  const assigned = new Map<DeliveryRequest, InventoryEntry>();
  function assign(mark: DeliveryRequest, originalSlot: boolean): void {
    if ((mark.awaitingEquip && mark.equipFailedAt === undefined) || assigned.has(mark)) return;
    const quantity = Number(mark.item?.q || 1);
    const entry = stock.find(entry => (!originalSlot || entry.slot === mark.slot) &&
      deliveryMatches(entry.item, mark.item) && (remaining.get(entry) || 0) >= quantity);
    if (!entry) return;
    assigned.set(mark, entry);
    remaining.set(entry, remaining.get(entry)! - quantity);
  }
  for (const mark of marks) assign(mark, true);
  for (const mark of marks) assign(mark, false);
  return assigned;
}
function inventoryFresh(status: InventoryStatus | undefined, now: number): status is InventoryStatus {
  return !!status?.items && fresh(Number(status.seenAt || 0), now, 'presence');
}
function legacyEquipped(mark: DeliveryRequest, marks: DeliveryRequest[], recipient: InventoryStatus | undefined, now: number): boolean {
  return !!mark.legacy && !!mark.equipOnDelivery && inventoryFresh(recipient, now) &&
    Object.values(recipient.slots || {}).some(entry => deliveryMatches(entry?.item, mark.item)) &&
    marks.filter(other => deliveryMatches(other.item, mark.item)).length === 1;
}
function reconcileOne(mark: DeliveryRequest, marks: DeliveryRequest[], allocated: boolean,
  recipient: InventoryStatus | undefined, now: number): string | null {
  if (mark.awaitingEquip) return null;
  if (allocated) {
    if (mark.blocked !== 'Reserved delivery item missing') return null;
    delete mark.blocked;
    return 'Delivery stock restored';
  }
  if (legacyEquipped(mark, marks, recipient, now)) {
    marks.splice(marks.indexOf(mark), 1);
    return 'Reconciled already-equipped delivery';
  }
  if (mark.blocked) return null;
  mark.blocked = 'Reserved delivery item missing';
  return 'Delivery blocked: missing stock; other work can continue';
}
function reconcileFailedEquip(mark: DeliveryRequest, marks: DeliveryRequest[], allocated: boolean): string {
  if (!allocated) {
    marks.splice(marks.indexOf(mark), 1);
    return 'Removed failed equip delivery: item no longer in merchant inventory';
  }
  // A new transfer attempt must not accept a delayed receipt for the old send.
  mark.id = randomUUID();
  delete mark.awaitingEquip;
  delete mark.equipFailedAt;
  delete mark.blocked;
  return 'Retrying delivery after failed equip: item still in merchant inventory';
}
function relocateDelivery(mark: DeliveryRequest, entry: InventoryEntry | undefined): boolean {
  if (entry?.slot === undefined || mark.slot === entry.slot) return false;
  mark.slot = entry.slot;
  return true;
}
function needsNewInventory(mark: DeliveryRequest, inventorySeenAt: number, now: number): boolean {
  return mark.equipFailedAt !== undefined &&
    (inventorySeenAt <= mark.equipFailedAt || !fresh(inventorySeenAt, now, 'presence'));
}
function reconcileRecipient(name: string, marks: DeliveryRequest[],
  assignments: Map<DeliveryRequest, InventoryEntry> | null, recipient: InventoryStatus | undefined, now: number,
  inventorySeenAt: number): string[] {
  const changes: string[] = [];
  for (const mark of marks.slice()) {
    if (!mark.id) { mark.id = randomUUID(); mark.legacy = true; changes.push('Assigned delivery identity for ' + name); }
    if (!assignments) continue;
    if (needsNewInventory(mark, inventorySeenAt, now)) continue;
    const entry = assignments.get(mark);
    if (relocateDelivery(mark, entry)) {
      changes.push('Relocated delivery: ' + mark.item?.name + ' for ' + name);
    }
    const result = mark.equipFailedAt !== undefined
      ? reconcileFailedEquip(mark, marks, !!entry) : reconcileOne(mark, marks, !!entry, recipient, now);
    if (result) changes.push(result + ': ' + mark.item?.name + ' for ' + name);
  }
  return changes;
}

/** Missing stock blocks only this delivery. Only exact equipped legacy intent is inferred. */
export function reconcileDeliveries(deliveries: Record<string, DeliveryRequest[] | undefined>,
  merchant: InventoryStatus | undefined, statuses: Record<string, InventoryStatus | undefined>, now: number): string[] {
  const assignments = inventoryFresh(merchant, now)
    ? allocateStock(Object.values(deliveries).flatMap(marks => marks || []), merchant) : null;
  return Object.entries(deliveries).flatMap(([name, marks]) =>
    reconcileRecipient(name, marks || [], assignments, statuses[name], now, merchant?.inventorySeenAt || 0));
}

/** A repeated receipt cannot resurrect a completed request or consume a newer one. */
export function acknowledgeDelivery(marks: DeliveryRequest[], receipt: DeliveryRequest): DeliveryRequest | undefined {
  const candidates = marks.filter(entry => receipt.id ? entry.id === receipt.id :
    Object.keys(receipt).every(key => JSON.stringify(entry[key as keyof DeliveryRequest]) === JSON.stringify(receipt[key as keyof DeliveryRequest])));
  const mark = candidates.length === 1 ? candidates[0] : undefined;
  if (!mark || mark.awaitingEquip) return;
  delete mark.blocked;
  if (mark.equipOnDelivery) mark.awaitingEquip = true;
  else marks.splice(marks.indexOf(mark), 1);
  return mark;
}
