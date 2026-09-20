import type { MerchantWork } from "../merchant/work.ts";
import type { PublicListing } from "./market-types.ts";

export interface OrderListing extends PublicListing {
  rid?: unknown;
  buyQuantity?: number;
}
export interface PontyOrderListing extends OrderListing {
  key: string;
  serverRegion: string;
  serverIdentifier: string;
  unitPrice: number;
  groupKey: string;
}
export interface ManualOrderState {
  merchantCharacter: string | null;
  activeRealm: string;
  merchantQueue: MerchantWork[];
  merchantCurrent: MerchantWork | null;
  statuses: Record<string, { server?: string; nearbyStandListings?: OrderListing[] } | undefined>;
  standListingCache?: OrderListing[];
  aldata: { marketListings: OrderListing[]; marketBuyOrders: OrderListing[] };
  ponty: { listings: PontyOrderListing[] };
}
export interface ManualOrderPorts {
  now(): number;
  nextCommand(): number;
  stamp(job: MerchantWork): MerchantWork;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
  dispatch(): void;
  plan(
    candidates: PontyOrderListing[],
    quantity: number,
    server?: string,
  ): PontyOrderListing[] | null;
}
export function createManualOrders(state: ManualOrderState, ports: ManualOrderPorts) {
  function job(reason: string, fields: Partial<MerchantWork>): MerchantWork {
    return {
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target: state.merchantCharacter,
      reason,
      manual: true,
      ...fields,
      queuedAt: ports.now(),
    };
  }
  function finish(message: string, details?: unknown): void {
    ports.log(message, "info", details);
    ports.persist();
    ports.dispatch();
  }
  function stand(listings: OrderListing[]): MerchantWork {
    const work = job("stand purchases", { listings });
    state.merchantQueue.push(work);
    finish(
      "Queued " + listings.length + " player-stand purchase" + (listings.length === 1 ? "" : "s"),
    );
    return work;
  }
  function aldata(listing: OrderListing, quantity: number, sale: boolean): MerchantWork {
    const amount = Math.min(quantity, Number(listing.quantity) || 1);
    const fields = sale
      ? { buyOrder: listing, sellQuantity: amount }
      : { listings: [{ ...listing, buyQuantity: amount }], completedListingKeys: [] };
    const work = ports.stamp(
      job(sale ? "ALData marketplace sales" : "ALData marketplace purchases", {
        ...fields,
        homeRealm: state.activeRealm,
      }),
    );
    state.merchantQueue.push(work);
    if (sale)
      finish("Manual ALData marketplace sale queued", {
        buyer: listing.buyer,
        item: listing.item.name,
        quantity: amount,
      });
    else
      finish("Manual ALData marketplace purchase queued", {
        seller: listing.seller,
        item: listing.item.name,
      });
    return work;
  }
  function candidates(keys: Set<unknown>, maxPrice: number): PontyOrderListing[] {
    const reserved = new Set(
      [state.merchantCurrent, ...state.merchantQueue]
        .filter((work) => work?.reason === "Ponty purchases")
        .flatMap((work) => (work!.listings || []).map((entry) => entry.key)),
    );
    return state.ponty.listings
      .filter((entry) => eligible(entry, keys, reserved, maxPrice))
      .sort(
        (a, b) =>
          a.unitPrice - b.unitPrice ||
          (a.serverRegion + a.serverIdentifier).localeCompare(b.serverRegion + b.serverIdentifier),
      );
  }
  function eligible(
    entry: PontyOrderListing,
    keys: Set<unknown>,
    reserved: Set<string | undefined>,
    price: number,
  ): boolean {
    return (
      keys.has(entry.key) &&
      !reserved.has(entry.key) &&
      entry.serverIdentifier !== "PVP" &&
      ports.now() - entry.seenAt < 120000 &&
      entry.unitPrice <= price
    );
  }
  function ponty(selected: PontyOrderListing[], quantity: number): MerchantWork[] {
    const realms = new Map<string, PontyOrderListing[]>();
    for (const listing of selected) {
      const realm = "SR_" + listing.serverRegion + listing.serverIdentifier;
      if (!realms.has(realm)) realms.set(realm, []);
      realms.get(realm)!.push(listing);
    }
    const jobs = [...realms].map(([realm, listings]) =>
      ports.stamp(
        job("Ponty purchases", {
          listings,
          manual: true,
          realm,
          pontyPlanned: true,
          homeRealm: state.activeRealm,
          completedListingKeys: [],
        }),
      ),
    );
    state.merchantQueue.push(...jobs);
    finish("Manual Ponty purchase queued", {
      item: selected[0]!.item.name,
      quantity,
      price: selected.reduce((sum, entry) => sum + entry.price, 0),
    });
    return jobs;
  }
  return { stand, aldata, candidates, ponty };
}
