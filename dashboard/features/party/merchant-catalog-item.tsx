"use client";
import { ItemMeta } from "./item-meta";
import { Sprite } from "./sprite";

export type MerchantCatalogItem = {
  id: string;
  name: string;
  sprite: Sprite | null;
  upgradeable?: boolean;
  compoundable?: boolean;
  meta?: ItemMeta | null;
};
