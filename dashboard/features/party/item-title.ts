"use client";
import type { Item } from "./item";
import type { ItemMeta } from "./item-meta";

// A copy's title (item.p) as the game shows it; dashboard/lib/game-formulas.ts `titleBonus` applies
// it. docs/item-titles.md.

// String.prototype.toTitleCase in the game's js/common_functions.js.
const toTitleCase = (value: string) => value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

// The title's display name: G.titles[p].title, or the raw p in title case (render_item).
function itemTitle(item: Pick<Item, "p">, meta: ItemMeta | null | undefined): string {
  if (!item.p) return "";
  return meta?.title?.title || toTitleCase(item.p);
}

export function titledName(name: string, item: Pick<Item, "p">, meta: ItemMeta | null | undefined): string {
  const title = itemTitle(item, meta);
  return title ? `${title} ${name}` : name;
}

// The extras box's Title line.
export function titleNote(item: Pick<Item, "p">, meta: ItemMeta | null | undefined): string {
  const title = itemTitle(item, meta);
  return item.p === "glitched" ? `${title} (+1 Dexterity, Intelligence or Strength at random)` : title;
}
