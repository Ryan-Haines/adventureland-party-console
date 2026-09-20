"use client";
import { InventoryEntry } from "./inventory-entry";

export type SelectedItem = {
  character: string;
  entry: InventoryEntry;
  source?: { kind: "merchant" } | { kind: "bank"; pack: string };
};
