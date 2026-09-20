import type { Item, InventoryEntry } from "../contracts/item.ts";

export interface CargoRequest {
  id: string;
  pack: string;
  slot: number;
  item: Item;
  mode?: string;
  state?: string;
  bootstrap?: boolean;
  queuedAt?: number;
}
interface CargoState {
  merchantQueue?: { id: string; order?: { bank?: { pack: string; slot?: number }[] } }[];
  merchantCurrent?: { id: string; order?: { bank?: { pack: string; slot?: number }[] } } | null;
  bankSnapshot?: { packs?: { items1?: (InventoryEntry | null)[] } } | null;
  bankboiQueue: CargoRequest[];
  bankboiReservedMigrated: boolean;
  withdrawals: Record<string, { pack: string; slot?: number }[] | undefined>;
}
interface CargoPorts {
  identity(item: Item): string;
  now(): number;
  persist(): void;
}

/** Adopt overflow in the staging row without recapturing cargo awaiting merchant withdrawal. */
export function createReservedBankboiCargo(state: CargoState, ports: CargoPorts) {
  function reservedForRetrieval(slot: number): boolean {
    if ([state.merchantCurrent, ...(state.merchantQueue || [])].some((job) =>
      job?.order?.bank?.some((entry) => entry.pack === "items1" && entry.slot === slot))) return true;
    return Object.values(state.withdrawals).some((requests) =>
      (requests || []).some((request) => request.pack === "items1" && request.slot === slot),
    );
  }

  function retain(request: CargoRequest, slots: (InventoryEntry | null)[]): boolean {
    if (request.pack !== "items1" || request.slot < 35) return true;
    if (reservedForRetrieval(request.slot)) return false;
    const item = slots[request.slot]?.item;
    return !!item && ports.identity(item) === ports.identity(request.item);
  }

  function adopt(slot: number, item: Item): boolean {
    const existing = state.bankboiQueue.find(
      (request) =>
        request.pack === "items1" &&
        request.slot === slot &&
        ports.identity(request.item) === ports.identity(item),
    );
    if (existing) {
      if (JSON.stringify(existing.item) === JSON.stringify(item)) return false;
      existing.item = item;
      return true;
    }
    const id = "items1:" + slot + ":" + ports.identity(item);
    if (state.bankboiQueue.some((request) => request.id === id)) return false;
    state.bankboiQueue.push({
      id,
      mode: "store",
      pack: "items1",
      slot,
      item,
      state: "staged",
      bootstrap: !state.bankboiReservedMigrated,
      queuedAt: ports.now(),
    });
    return true;
  }

  function adoptStagingRow(slots: (InventoryEntry | null)[]): boolean {
    let changed = false;
    for (let slot = 35; slot < 42; slot++) {
      const item = slots[slot]?.item;
      if (!item || reservedForRetrieval(slot)) continue;
      if (adopt(slot, item)) changed = true;
    }
    return changed;
  }

  function reconcile(): boolean {
    const slots = state.bankSnapshot?.packs?.items1;
    if (!Array.isArray(slots)) return false;
    const previous = JSON.stringify(state.bankboiQueue);
    state.bankboiQueue = state.bankboiQueue.filter((request) => retain(request, slots));
    let changed = previous !== JSON.stringify(state.bankboiQueue);
    if (adoptStagingRow(slots)) changed = true;
    if (!state.bankboiReservedMigrated) {
      state.bankboiReservedMigrated = true;
      changed = true;
    }
    if (changed) ports.persist();
    return changed;
  }
  return { reconcile };
}
