"use client";
import { Item } from "./item";
import { ItemMeta } from "./item-meta";

export type EquippedEntry = { item: Item; meta?: ItemMeta | null };
