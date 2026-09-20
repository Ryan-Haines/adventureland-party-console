"use client";
import { InventoryEntry } from "./inventory-entry";

export const compactInventory = (items: (InventoryEntry | null)[]) => {
  const occupied = items.filter((entry): entry is InventoryEntry => entry !== null);
  return [...occupied, ...Array<null>(Math.max(0, items.length - occupied.length)).fill(null)];
};
