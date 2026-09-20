import { bidAcceptsLevel } from "./bid-matching.ts";
import type { Item } from "../contracts/item.ts";
import type { MerchantWork } from "../merchant/work.ts";
import type { PublicListing } from "./market-types.ts";

export interface StandBid {
  price: number;
  quantity: number;
  minimumQuality?: number;
  priorityOverride?: number;
  useStandSlot?: boolean;
  acceptHigherLevels?: boolean;
  revision?: number;
  standSuppressed?: boolean;
}
interface PontyListing extends PublicListing {
  unitPrice: number;
}
interface BidState {
  standBids: Record<string, StandBid | undefined>;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
  merchantCharacter: string | null;
  merchantAutomations: Record<string, boolean | undefined>;
  ponty: { updatedAt?: number; listings?: PontyListing[] };
  aldata: { marketListings: PublicListing[] };
  activeRealm: string;
}
interface BidPorts {
  now(): number;
  nextCommand(): number;
  publish(): void;
  log(message: string, level: string, details?: unknown): void;
  prioritized(reason: string): [string, StandBid | null][];
  planPonty(candidates: PontyListing[], quantity: number): PublicListing[];
  stamp(job: MerchantWork): MerchantWork;
  persist(): void;
  dispatch(): void;
  blacklisted(listing: PublicListing): boolean;
}
export const automaticBidPurchaseReasons: ReadonlySet<string> = new Set([
  "stand bid purchases",
  "ALData marketplace purchases",
  "Ponty purchases",
]);

function bidPurchase(job: MerchantWork | null, itemId: string): boolean {
  return !!job && automaticBidPurchaseReasons.has(job.reason) && job.bidItemId === itemId;
}

export function createBidPurchases(state: BidState, ports: BidPorts) {
  function pending(itemId: string): boolean {
    return [state.merchantCurrent, ...state.merchantQueue].some((job) => bidPurchase(job, itemId));
  }

  function removeQueued(itemId: string): number {
    const before = state.merchantQueue.length;
    state.merchantQueue = state.merchantQueue.filter((job) => !bidPurchase(job, itemId));
    return before - state.merchantQueue.length;
  }

  function matchingBid(item: Item | null | undefined): StandBid | undefined {
    const bid = item?.name ? state.standBids[item.name] : undefined;
    return bid && bidAcceptsLevel(bid, item) ? bid : undefined;
  }

  function fulfill(item: Item | null | undefined, quantity: number): number {
    const amount = Math.max(0, Number(quantity) || 0),
      bid = matchingBid(item);
    if (!bid || !amount) return 0;
    const itemId = item!.name!;
    bid.quantity = Math.max(0, Number(bid.quantity) - amount);
    const remaining = Number(bid.quantity) || 0;
    if (!remaining) delete state.standBids[itemId];
    const cancelled = removeQueued(itemId);
    ports.publish();
    ports.log(
      "WTB filled for " +
        amount +
        " × " +
        itemId +
        (remaining ? "; " + remaining + " remaining" : "; order complete"),
      "success",
      cancelled ? { cancelledDuplicateJobs: cancelled } : null,
    );
    return amount;
  }

  function eligible(bid: StandBid | null, itemId: string): bid is StandBid {
    return !!bid && !(Number(bid.quantity) < 1) && !pending(itemId);
  }

  function pontyCandidates(itemId: string, bid: StandBid): PontyListing[] {
    return (state.ponty.listings || []).filter(
      (listing) =>
        listing.item &&
        listing.item.name === itemId &&
        Number(listing.unitPrice) <= Number(bid.price) &&
        bidAcceptsLevel(bid, listing.item) &&
        listing.serverIdentifier !== "PVP" &&
        ports.now() - listing.seenAt < 120000,
    );
  }

  function job(itemId: string, reason: string, listings: PublicListing[]): MerchantWork {
    return {
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target: state.merchantCharacter,
      reason,
      bidItemId: itemId,
      listings,
      completedListingKeys: [],
      homeRealm: state.activeRealm,
      queuedAt: ports.now(),
    };
  }

  function queued(itemId: string, source: string, selected: PublicListing[]): void {
    ports.log(
      source +
        " matched " +
        selected.length +
        " listing" +
        (selected.length === 1 ? "" : "s") +
        " for " +
        itemId,
      "success",
    );
    ports.persist();
    ports.dispatch();
  }

  function queuePonty(): boolean {
    if (
      state.merchantAutomations["stand bid purchases"] === false ||
      !state.merchantCharacter ||
      ports.now() - Number(state.ponty.updatedAt || 0) > 30000
    )
      return false;
    for (const [itemId, bid] of ports.prioritized("Ponty purchases")) {
      if (!eligible(bid, itemId)) continue;
      const candidates = pontyCandidates(itemId, bid),
        selected = ports.planPonty(candidates, Number(bid.quantity));
      if (!selected.length) continue;
      state.merchantQueue.push(
        ports.stamp({
          ...job(itemId, "Ponty purchases", selected),
          pontyCandidates: candidates,
          pontyQuantity: Number(bid.quantity),
        }),
      );
      queued(itemId, "Ponty", selected);
      return true;
    }
    return false;
  }

  function marketCandidates(itemId: string, bid: StandBid): PublicListing[] {
    return state.aldata.marketListings
      .filter(
        (listing) =>
          listing.item.name === itemId &&
          listing.seller !== state.merchantCharacter &&
          !ports.blacklisted(listing) &&
          listing.seenAt >= ports.now() - 120000 &&
          listing.serverIdentifier !== "PVP" &&
          Number(listing.price) <= Number(bid.price) &&
          bidAcceptsLevel(bid, listing.item),
      )
      .sort((a, b) => a.price - b.price || b.seenAt - a.seenAt);
  }

  function selectMarket(itemId: string, bid: StandBid): PublicListing[] {
    let remaining = Number(bid.quantity);
    const selected: PublicListing[] = [];
    for (const listing of marketCandidates(itemId, bid)) {
      if (remaining < 1) break;
      const buyQuantity = Math.min(remaining, Number(listing.quantity) || 1);
      selected.push({ ...listing, buyQuantity });
      remaining -= buyQuantity;
    }
    return selected;
  }

  function queueMarket(): false | undefined {
    if (state.merchantAutomations["stand bid purchases"] === false) return false;
    if (
      !state.merchantCharacter ||
      [state.merchantCurrent, ...state.merchantQueue].some(
        (job) => job?.reason === "ALData marketplace purchases",
      )
    )
      return;
    for (const [itemId, bid] of ports.prioritized("ALData marketplace purchases")) {
      if (!eligible(bid, itemId)) continue;
      const selected = selectMarket(itemId, bid);
      if (!selected.length) continue;
      state.merchantQueue.push(ports.stamp(job(itemId, "ALData marketplace purchases", selected)));
      queued(itemId, "ALData", selected);
      break;
    }
  }
  return { pending, removeQueued, fulfill, queuePonty, queueMarket };
}
