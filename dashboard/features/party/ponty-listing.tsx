"use client";
import { Item } from "./item";

export type PontyListing = {
  key: string;
  rid: string;
  item: Item;
  quantity: number;
  unitPrice: number;
  price: number;
  groupKey?: string;
  serverRegion?: string;
  serverIdentifier?: string;
  seenAt?: number;
  keys?: string[];
  realmLabel?: string;
  minimumLot?: number;
};
