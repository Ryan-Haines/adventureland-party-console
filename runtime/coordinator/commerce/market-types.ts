import type { Item } from "../contracts/item.ts";
import type { MarketListing } from "../merchant/work.ts";

export interface PublicListing extends MarketListing {
  item: Item & { name: string };
  price: number;
  quantity: number;
  seenAt: number;
  buyer?: string;
  slot?: string;
}

/** Feed normalization coerces coordinates but preserves the raw map metadata. */
export interface NormalizedPublicListing extends PublicListing {
  map: unknown;
  x: number;
  y: number;
}

export interface PriceHistory {
  [field: string]: unknown;
  lowest?: number;
  lowestLevel?: number;
  marketLow?: number;
  marketLowLevel?: number;
  recent?: number;
  recentLevel?: number;
  seenAt?: number;
  highestPublicWTB?: number;
  highestPublicWTBLevel?: number;
}

export interface MerchantIdentity {
  seller?: string;
  name?: string;
  serverRegion?: string;
  serverIdentifier?: string;
}
export interface MerchantBlock extends MerchantIdentity {
  until?: number;
  failures?: number;
  reason?: string;
  cooldownMinutes?: number;
  updatedAt?: number;
}
