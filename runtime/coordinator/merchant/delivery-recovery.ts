import { randomUUID } from 'node:crypto';
import type { Item, InventoryEntry } from '../contracts/item.ts';

export interface DeliveryRequest {
  id?: string;
  slot?: number;
  item?: Item;
  equipOnDelivery?: boolean;
  awaitingEquip?: boolean;
  blocked?: string;
  legacy?: boolean;
}

export function deliveryReady(mark: DeliveryRequest): boolean {
  return !!mark.item && !mark.awaitingEquip && !mark.blocked;
}
interface InventoryStatus {
  seenAt?: number;
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
    if (mark.awaitingEquip || assigned.has(mark)) return;
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
function fresh(status: InventoryStatus | undefined, now: number): status is InventoryStatus {
  return !!status?.items && now - Number(status.seenAt || 0) <= 10000;
}
function legacyEquipped(mark: DeliveryRequest, marks: DeliveryRequest[], recipient: InventoryStatus | undefined, now: number): boolean {
  return !!mark.legacy && !!mark.equipOnDelivery && fresh(recipient, now) &&
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
function reconcileRecipient(name: string, marks: DeliveryRequest[],
  assignments: Map<DeliveryRequest, InventoryEntry> | null, recipient: InventoryStatus | undefined, now: number): string[] {
  const changes: string[] = [];
  for (const mark of marks.slice()) {
    if (!mark.id) { mark.id = randomUUID(); mark.legacy = true; changes.push('Assigned delivery identity for ' + name); }
    if (!assignments) continue;
    const entry = assignments.get(mark);
    if (entry?.slot !== undefined && mark.slot !== entry.slot) {
      mark.slot = entry.slot;
      changes.push('Relocated delivery: ' + mark.item?.name + ' for ' + name);
    }
    const result = reconcileOne(mark, marks, !!entry, recipient, now);
    if (result) changes.push(result + ': ' + mark.item?.name + ' for ' + name);
  }
  return changes;
}

/** Missing stock blocks only this delivery. Only exact equipped legacy intent is inferred. */
export function reconcileDeliveries(deliveries: Record<string, DeliveryRequest[] | undefined>,
  merchant: InventoryStatus | undefined, statuses: Record<string, InventoryStatus | undefined>, now: number): string[] {
  const assignments = fresh(merchant, now)
    ? allocateStock(Object.values(deliveries).flatMap(marks => marks || []), merchant) : null;
  return Object.entries(deliveries).flatMap(([name, marks]) =>
    reconcileRecipient(name, marks || [], assignments, statuses[name], now));
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
