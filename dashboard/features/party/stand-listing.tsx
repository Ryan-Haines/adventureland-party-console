"use client";
import { Item } from "./item";

export type StandListing = {
  id?: string;
  slot: number;
  item: Item;
  price: number;
  quantity: number;
  bankPack?: string;
  bankSlot?: number;
  state?: string;
  tradeSlot?: string;
};
