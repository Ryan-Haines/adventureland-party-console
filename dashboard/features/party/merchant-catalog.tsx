"use client";
import { MerchantBuyItem } from "./merchant-buy-item";
import { MerchantCatalogItem } from "./merchant-catalog-item";
import { MerchantCraftRecipe } from "./merchant-craft-recipe";
import { MerchantExchangeItem } from "./merchant-exchange-item";

export type MerchantCatalog = {
  allItems?: MerchantCatalogItem[];
  buyable: MerchantBuyItem[];
  craftable: MerchantCraftRecipe[];
  exchangeable?: MerchantExchangeItem[];
};
