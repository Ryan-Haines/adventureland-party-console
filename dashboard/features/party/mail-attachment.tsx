"use client";
import { InventoryEntry } from "./inventory-entry";

export type MailAttachment = {
  pack: string;
  label: string;
  entry: InventoryEntry;
};
