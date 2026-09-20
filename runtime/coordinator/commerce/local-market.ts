import { bidAcceptsLevel } from "./bid-matching.ts";
import type { MerchantWork } from "../merchant/work.ts";
import type { PriceHistory, PublicListing } from "./market-types.ts";
import type { StandBid } from "./bids.ts";

interface LocalMarketState {
  standPriceHistory: Record<string, PriceHistory>;
  standBids: Record<string, StandBid | undefined>;
  merchantAutomations: Record<string, boolean | undefined>;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
  merchantCharacter: string | null;
}
interface LocalMarketPorts {
  now(): number;
  nextCommand(): number;
  pending(itemId: string): boolean;
  priority(itemId: string): number;
  log(message: string, level: string): void;
}

function lowestPrices(listings: (PublicListing | null)[]): Map<string, number> {
  const current = new Map<string, number>();
  for (const listing of listings) {
    const id = listing?.item?.name,
      price = Number(listing?.price);
    if (!id || !Number.isFinite(price) || price < 1) continue;
    if (!current.has(id) || price < current.get(id)!) current.set(id, price);
  }
  return current;
}

function nextPrice(
  old: PriceHistory | undefined,
  price: number,
  level: number,
  now: number,
): PriceHistory {
  const lowest = !old || price < (Number(old.lowest) || price);
  const identifiesLowest = old && old.lowestLevel == null && price === Number(old.lowest);
  return {
    ...old,
    lowest: lowest ? price : Number(old!.lowest),
    lowestLevel: lowest || identifiesLowest ? level : old!.lowestLevel,
    recent: price,
    recentLevel: level,
    seenAt: now,
  };
}

export function createLocalMarket(state: LocalMarketState, ports: LocalMarketPorts) {
  function history(listings: (PublicListing | null)[]): boolean {
    let changed = false;
    for (const [id, price] of lowestPrices(listings)) {
      const old = state.standPriceHistory[id];
      const listing = listings.find(
        (entry) => entry?.item?.name === id && Number(entry.price) === price,
      );
      const next = nextPrice(old, price, Number(listing?.item?.level) || 0, ports.now());
      if (!old || old.lowest !== next.lowest || old.recent !== next.recent) {
        state.standPriceHistory[id] = next;
        changed = true;
      }
    }
    return changed;
  }

  function eligible(listing: PublicListing | null): listing is PublicListing {
    const bid = listing?.item?.name ? state.standBids[listing.item.name] : undefined;
    return (
      !!bid &&
      bid.quantity > 0 &&
      !ports.pending(listing!.item.name) &&
      Number(listing!.price) <= Number(bid.price) &&
      bidAcceptsLevel(bid, listing!.item)
    );
  }

  function select(matches: PublicListing[], id: string, quantity: number): PublicListing[] {
    let remaining = quantity;
    const selected: PublicListing[] = [];
    for (const listing of matches.filter((entry) => entry.item.name === id)) {
      if (remaining < 1) break;
      const buyQuantity = Math.min(remaining, Number(listing.quantity) || 1);
      selected.push({ ...listing, buyQuantity });
      remaining -= buyQuantity;
    }
    return selected;
  }

  function observe(listings: unknown): boolean {
    if (!Array.isArray(listings)) return false;
    const reports = listings as (PublicListing | null)[];
    const changed = history(reports);
    if (state.merchantAutomations["stand bid purchases"] === false || state.merchantCurrent)
      return changed;
    const matches = reports
      .filter(eligible)
      .sort(
        (a, b) => ports.priority(b.item.name) - ports.priority(a.item.name) || a.price - b.price,
      );
    if (!matches.length) return changed;
    const id = matches[0]!.item.name,
      selected = select(matches, id, state.standBids[id]!.quantity);
    if (!selected.length) return changed;
    state.merchantQueue.push({
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target: state.merchantCharacter,
      reason: "stand bid purchases",
      bidItemId: id,
      listings: selected,
      queuedAt: ports.now(),
    });
    ports.log(
      "Bid matched for " + id + " at " + selected[0]!.price.toLocaleString() + " gold",
      "success",
    );
    return true;
  }
  return { observe };
}
