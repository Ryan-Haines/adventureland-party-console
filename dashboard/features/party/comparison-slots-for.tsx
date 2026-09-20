"use client";
import { Char } from "./char";
import { COMPARISON_SLOTS } from "./comparison-slots";
import { ItemMeta } from "./item-meta";

export function comparisonSlotsFor(meta: ItemMeta | null | undefined, character: Char) {
  const type = String(meta?.definition.type || "");
  if (type === "weapon") {
    const usage = meta?.usage?.classes.find((entry) => entry.id === character.ctype);
    return usage?.hands === 1 ? ["mainhand", "offhand"] : ["mainhand"];
  }
  return COMPARISON_SLOTS[type] || [];
}
