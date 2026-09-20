"use client";
import { ItemCraftUse } from "./item-craft-use";
import { ItemDropSource } from "./item-drop-source";
import { ItemRecipe } from "./item-recipe";
import { ItemSetInfo } from "./item-set-info";
import { ItemSuggestedPrice } from "./item-suggested-price";

export type ItemWorldInfo = {
  recipe?: ItemRecipe | null;
  set?: ItemSetInfo | null;
  drops?: ItemDropSource[];
  suggestedPrices?: ItemSuggestedPrice[];
  usedIn?: ItemCraftUse[];
};
