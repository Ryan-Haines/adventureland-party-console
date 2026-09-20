"use client";
import { Item } from "./item";

export type ALDataListing = {
  key: string;
  source: "aldata";
  seller: string;
  slot: string;
  serverRegion: string;
  serverIdentifier: string;
  map: string;
  x: number;
  y: number;
  lastSeen: string;
  seenAt: number;
  price: number;
  quantity: number;
  item: Item;
  groupedListings?: ALDataListing[];
};
