import {requestObject} from '../http/contracts.ts';
import { deliveryMatches } from './delivery-recovery.ts';
import type {InventoryEntry} from '../contracts/item.ts';

/** Only the requested gear and intent can resolve survivor ambiguity; potions cannot. */
export function upgradeRecoverySignature(marks:unknown[],items:(InventoryEntry|null)[]):string {
  const names=new Set(marks.map(mark=>requestObject(requestObject(mark).item).name));
  return JSON.stringify([marks,items.filter(entry=>entry?.item && names.has(entry.item.name))
    .map(entry=>({slot:entry!.slot,item:entry!.item}))]);
}

export function compoundRequestKey(raw: unknown): unknown {
  const group = requestObject(raw);
  return group.requestId ?? group.id;
}

/** Run complete carried triplets before visiting storage or retrying stale receipts. */
export function nextCompoundBatch(groups: unknown[], inventory: (InventoryEntry | null)[]): unknown[] {
  const carried = groups.filter(raw => {
    const marks = requestObject(raw).items;
    if (!Array.isArray(marks) || marks.length !== 3) return false;
    const slots = new Set<number>();
    return marks.every(value => {
      const mark = requestObject(value);
      if ((mark.storage && !mark.storageReceived) || typeof mark.slot !== 'number' || slots.has(mark.slot)) return false;
      slots.add(mark.slot);
      const actual = inventory.find(entry => entry?.slot === mark.slot)?.item;
      const wanted = requestObject(mark.item);
      return !!actual && !!wanted.name && deliveryMatches(actual, wanted) && deliveryMatches(wanted, actual);
    });
  });
  return carried.length ? carried : groups;
}

/** Compound recovery follows its complete triplet intent and matching copies.
 * Gold, potions, movement and heartbeat timestamps cannot repair a lost input.
 */
export function compoundRecoverySignature(groups:unknown[],items:(InventoryEntry|null)[]):string {
  const marks=groups.flatMap(group=>{
    const entries=requestObject(group).items;
    return Array.isArray(entries)?entries:[];
  });
  return JSON.stringify([groups,upgradeRecoverySignature(marks,items)]);
}
