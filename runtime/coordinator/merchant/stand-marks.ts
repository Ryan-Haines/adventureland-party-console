import type { Item, InventoryEntry } from "../contracts/item.ts";
export interface StandMark extends InventoryEntry {
  id: string;
  price: number;
  quantity: number;
  state: string;
  queuedAt: number;
  bankPack?: string;
  bankSlot?: number;
  tradeSlot?: string;
}
export interface StandMarkState {
  standBids?: Record<string, { useStandSlot?: boolean } | undefined>;
  standListings: StandMark[];
  merchantCharacter: string | null;
  withdrawals: Record<string, { pack: string; slot?: number; item?: Item | null }[] | undefined>;
  statuses: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  bankSnapshot: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
}
interface StandSource extends InventoryEntry {
  bankPack?: string;
}
interface StandMarkPorts {
  now(): number;
  nextCommand(): number;
}
const transientFields = new Set(["q", "price", "rid", "b", "giveaway"]);
function identity(item: Item | null | undefined): string {
  return JSON.stringify(
    Object.keys(item || {})
      .filter((key) => !transientFields.has(key))
      .sort()
      .map((key) => [key, item![key]]),
  );
}
function sourceKey(source: StandSource): string {
  return source.bankPack
    ? "bank:" + source.bankPack + ":" + source.slot
    : "merchant:" + source.slot;
}

export function createStandMarks(state: StandMarkState, ports: StandMarkPorts) {
  function occupied(): number {
    return state.standListings.filter(listing => listing.state !== "paused").length + Object.values(state.standBids || {}).filter(bid => bid?.useStandSlot).length;
  }
  function ensureWithdrawal(listing: StandMark): void {
    if (!listing.bankPack || !state.merchantCharacter) return;
    const withdrawals = (state.withdrawals[String(state.merchantCharacter)] ||= []);
    const request = { pack: listing.bankPack, slot: listing.bankSlot, item: listing.item };
    if (!withdrawals.some((entry) => JSON.stringify(entry) === JSON.stringify(request)))
      withdrawals.push(request);
  }
  function make(source: StandSource, price: number, existingId?: string): StandMark {
    return {
      id: existingId || "stand-" + ports.now() + "-" + ports.nextCommand(),
      slot: source.slot,
      item: source.item,
      price,
      quantity: Math.max(1, Math.min(9999, Number(source.item?.q) || 1)),
      state: "configured",
      queuedAt: ports.now(),
      bankPack: source.bankPack || undefined,
      bankSlot: source.bankPack ? source.slot : undefined,
    };
  }
  function matchingSources(wanted: string): StandSource[] {
    const sources: StandSource[] = [];
    collectSources(sources, state.statuses[String(state.merchantCharacter)]?.items, wanted);
    for (const [pack, entries] of Object.entries(state.bankSnapshot?.packs || {}))
      collectSources(sources, entries, wanted, pack);
    return sources;
  }
  function collectSources(
    sources: StandSource[],
    entries: (InventoryEntry | null)[] | undefined,
    wanted: string,
    pack?: string,
  ): void {
    for (const entry of entries || [])
      if (entry?.item && identity(entry.item) === wanted)
        sources.push(
          pack
            ? { slot: entry.slot, item: entry.item, bankPack: pack }
            : { slot: entry.slot, item: entry.item },
        );
  }
  function reprice(wanted: string, price: number): Set<string> {
    const covered = new Set<string>();
    state.standListings.forEach((existing, index) => {
      if (identity(existing.item) !== wanted) return;
      const source = {
        slot: existing.bankPack ? existing.bankSlot : existing.slot,
        item: existing.item,
        bankPack: existing.bankPack,
      };
      const updated = make(source, price, existing.id);
      state.standListings[index] = updated;
      if (existing.state !== "live" && !existing.tradeSlot) covered.add(sourceKey(source));
      ensureWithdrawal(updated);
    });
    return covered;
  }
  function markAll(item: Item, price: number): void {
    const wanted = identity(item),
      covered = reprice(wanted, price);
    for (const source of matchingSources(wanted)) {
      if (occupied() >= 16 || covered.has(sourceKey(source))) continue;
      const listing = make(source, price);
      state.standListings.push(listing);
      covered.add(sourceKey(source));
      ensureWithdrawal(listing);
    }
  }
  function find(
    requestedId: string | null,
    bankPack: string | null,
    slot: number,
    item: Item,
  ): number {
    if (requestedId) return state.standListings.findIndex((entry) => entry.id === requestedId);
    return state.standListings.findIndex(
      (entry) =>
        (bankPack
          ? entry.bankPack === bankPack && entry.bankSlot === slot
          : entry.state !== "live" && !entry.tradeSlot && entry.slot === slot && !entry.bankPack) &&
        JSON.stringify(entry.item) === JSON.stringify(item),
    );
  }
  function remove(index: number, pack: string | null, slot: number, item: Item): void {
    if (index >= 0) state.standListings.splice(index, 1);
    if (pack && state.merchantCharacter)
      state.withdrawals[String(state.merchantCharacter)] = (
        state.withdrawals[String(state.merchantCharacter)] || []
      ).filter(
        (entry) =>
          !(
            entry.pack === pack &&
            entry.slot === slot &&
            JSON.stringify(entry.item) === JSON.stringify(item)
          ),
      );
  }
  function single(
    index: number,
    id: string | null,
    pack: string | null,
    slot: number,
    item: Item,
    price: number,
    quantity: number,
  ): boolean {
    if ((index < 0 || state.standListings[index].state === "paused") && occupied() >= 16) return false;
    const listing = make({ slot, item, bankPack: pack || undefined }, price, id || undefined);
    listing.quantity = quantity;
    if (index >= 0) state.standListings[index] = listing;
    else state.standListings.push(listing);
    ensureWithdrawal(listing);
    return true;
  }
  return { find, remove, markAll, single };
}
