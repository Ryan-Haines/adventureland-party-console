"use client";
import { EquippedEntry } from "./equipped-entry";
import { InventoryEntry } from "./inventory-entry";

export type Bankboi = {
  name: string;
  ctype?: string;
  level?: number;
  state: string;
  items: (InventoryEntry | null)[];
  slots?: Record<string, EquippedEntry>;
  gold?: number;
  seenAt?: number;
  error?: string | null;
  transaction?: { phase: string; mode: string } | null;
};
