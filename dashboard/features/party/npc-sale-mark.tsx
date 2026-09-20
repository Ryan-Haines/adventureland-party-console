"use client";
import { Item } from "./item";

export type NpcSaleMark = {
  id: string;
  auto?: boolean;
  pack?: string;
  source?: "bank" | "merchant" | "character";
  character?: string;
  slot: number;
  item: Item;
  quantity: number;
  state?: string;
  error?: string | null;
  retryAt?: number;
  retryCount?: number;
};
