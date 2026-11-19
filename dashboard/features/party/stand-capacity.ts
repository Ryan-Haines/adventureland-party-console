import { defaultStandPrice, markMatches } from '../../../runtime/items/api.ts';
import type { InventoryEntry } from './inventory-entry';
import type { PartyState } from './party-state';

// The items owner's stand count: the core section's `standSlots`, whose `free` is the stand less the
// unpaused listings and the slot-reserving bids, the count the coordinator refuses an order by. Before
// the first core answer nothing is full, and the coordinator's own refusal still answers an order it
// cannot place.
export function standIsFull(state: Pick<PartyState, 'standSlots'>): boolean {
  return !!state.standSlots && state.standSlots.free <= 0;
}
export function standFullMessage(state: Pick<PartyState, 'standSlots'>): string {
  const slots = state.standSlots?.slots ?? 0;
  return `Merchant stand is full (${slots}/${slots})`;
}

// A Stand press on a copy: the listing that already holds it (its bank cell, or its inventory slot)
// is edited, or a new mark starts at the default price. A new mark on a full stand is refused with
// The items owner's count.
export interface StandDraft { id?: string; entry: InventoryEntry; bankPack?: string; defaultPrice: number; markAll: boolean; price: string; quantity: string }
export function standDraft(state: Pick<PartyState, 'standSlots' | 'standListings'>, entry: InventoryEntry, bankPack?: string): { refused: string } | { draft: StandDraft } {
  const existing = (state.standListings || []).find((mark) => (bankPack
    ? mark.bankPack === bankPack && mark.bankSlot === entry.slot
    : !mark.bankPack && mark.slot === entry.slot) && markMatches(mark.item, entry.item));
  if (!existing && standIsFull(state)) return { refused: standFullMessage(state) };
  const defaultPrice = defaultStandPrice(entry.meta?.definition);
  return { draft: { id: existing?.id, entry, bankPack, defaultPrice, markAll: false,
    price: String(existing?.price || defaultPrice), quantity: String(existing?.quantity || entry.item.q || 1) } };
}
