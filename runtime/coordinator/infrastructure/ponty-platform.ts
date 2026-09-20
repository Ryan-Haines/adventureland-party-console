import type { Item } from "../contracts/item.ts";
import type { createPontyMarket } from "../commerce/ponty.ts";

/** Retained jobs may lack price/quantity metadata; the legacy planner handles them as-is. */
interface PurchasableLot {
  quantity?: unknown;
  unitPrice?: unknown;
  serverRegion?: string;
  serverIdentifier?: string;
}

/** Installed CommonJS Ponty service consumed by coordinator commerce. */
export interface PontyPlatform {
  itemKey(this: void, item: Item): string;
  normalize: Parameters<typeof createPontyMarket>[1]["normalize"];
  planPurchase<T extends PurchasableLot>(
    this: void,
    listings: T[],
    quantity: number,
    currentRealm: string | undefined,
    allowPartial: true,
  ): T[];
  planPurchase<T extends PurchasableLot>(
    this: void,
    listings: T[],
    quantity: number,
    currentRealm?: string,
    allowPartial?: boolean,
  ): T[] | null;
}
