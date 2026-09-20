"use client";
import { Item } from "./item";

export type ALDataBuyOrder = {
  key: string;
  source: "aldata";
  buyer: string;
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
};
