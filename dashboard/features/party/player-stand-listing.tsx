"use client";
import { Item } from "./item";

export type PlayerStandListing = {
  seller: string;
  slot: string;
  rid: string;
  item: Item;
  price: number;
  quantity: number;
  map: string;
  x: number;
  y: number;
};
