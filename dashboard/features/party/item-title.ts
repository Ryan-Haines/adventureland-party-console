"use client";
import type { Item } from "./item";
import type { ItemMeta } from "./item-meta";
import { ITEM_PROPERTY_KEYS } from "./item-property-keys";

// A copy's title (item.p) as the game shows and applies it. docs/item-titles.md.

// doublehand_types in the game's js/old_common_functions.js.
const DOUBLEHAND_TYPES = new Set(["axe", "basher", "great_staff"]);

// String.prototype.toTitleCase in the game's js/common_functions.js.
const toTitleCase = (value: string) => value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

// The title's display name: G.titles[p].title, or the raw p in title case (render_item).
export function itemTitle(item: Pick<Item, "p">, meta: ItemMeta | null | undefined): string {
  if (!item.p) return "";
  return meta?.title?.title || toTitleCase(item.p);
}

export function titledName(name: string, item: Pick<Item, "p">, meta: ItemMeta | null | undefined): string {
  const title = itemTitle(item, meta);
  return title ? `${title} ${name}` : name;
}

// The stats calculate_item_properties adds for the title. Glitched adds a random stat
// on each calculation, so it adds nothing here and shows as a note instead.
export function titleBonus(item: Pick<Item, "p">, meta: ItemMeta | null | undefined): Record<string, number> {
  const definition = meta?.definition || {};
  const has = (key: string) => !!Number(definition[key]);
  if (item.p === "shiny") {
    if (has("attack")) return { attack: DOUBLEHAND_TYPES.has(String(definition.wtype)) ? 7 : 4 };
    if (has("stat")) return { stat: 2 };
    if (has("armor")) return { armor: 12, resistance: 10 };
    return { dex: 1, int: 1, str: 1 };
  }
  if (!item.p || item.p === "glitched" || !meta?.title) return {};
  const bonus: Record<string, number> = {};
  for (const [key, value] of Object.entries(meta.title))
    if (ITEM_PROPERTY_KEYS.has(key) && typeof value === "number") bonus[key] = value;
  return bonus;
}

// The extras box's Title line.
export function titleNote(item: Pick<Item, "p">, meta: ItemMeta | null | undefined): string {
  const title = itemTitle(item, meta);
  return item.p === "glitched" ? `${title} (+1 Dexterity, Intelligence or Strength at random)` : title;
}
