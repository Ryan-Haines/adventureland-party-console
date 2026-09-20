"use client";
import { InventoryEntry } from "./inventory-entry";

export type BankSnapshot = {
  gold: number;
  standOpen?: boolean;
  packs: Record<string, (InventoryEntry | null)[]>;
  character: string;
  seenAt: number;
};
