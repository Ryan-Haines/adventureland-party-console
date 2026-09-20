import type { Item, ItemMark } from "../contracts/item.ts";
import { markedItem } from "./item-identity.ts";

interface SlotReservation {
  slot?: number | string;
  equipped?: unknown;
}
interface CompoundReservation {
  items: { slot?: number; item?: Item }[];
}
interface ReservationState {
  marked: Record<string, ItemMark[] | undefined>;
  merchantMarked: Record<string, SlotReservation[] | undefined>;
  upgrades: Record<string, SlotReservation[] | undefined>;
  compounds: Record<string, CompoundReservation[] | undefined>;
}

/** Release outgoing bag slots without removing equipped upgrades or unrelated group members. */
export function createInventoryReservations(state: ReservationState) {
  function pruneCompounds(
    name: string,
    retain: (entry: CompoundReservation["items"][number]) => boolean,
  ): void {
    for (const group of state.compounds[name] || []) group.items = group.items.filter(retain);
    state.compounds[name] = (state.compounds[name] || []).filter((group) => group.items.length);
  }

  function remove(name: string, slot: number, item: Item): void {
    state.marked[name] = (state.marked[name] || []).filter((entry) => {
      if (Number.isSafeInteger(entry && entry.slot)) return entry.slot !== slot;
      return JSON.stringify(markedItem(entry)) !== JSON.stringify(item);
    });
    state.merchantMarked[name] = (state.merchantMarked[name] || []).filter(
      (entry) => entry.slot !== slot,
    );
    state.upgrades[name] = (state.upgrades[name] || []).filter(
      (entry) => entry.equipped || entry.slot !== slot,
    );
    pruneCompounds(name, (entry) => entry.slot !== slot);
  }

  /** Incoming reservations use the complete serialized item, including stack quantity. */
  function clearIncoming(name: string, item: Item): void {
    pruneCompounds(name, (entry) => JSON.stringify(entry.item) !== JSON.stringify(item));
  }
  return { remove, clearIncoming };
}
