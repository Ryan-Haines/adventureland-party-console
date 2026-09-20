"use client";
import { ItemWorldInfo } from "./item-world-info";
import { Sprite } from "./sprite";

export type ItemMeta = {
  definition: Record<string, string | number | boolean | unknown[]>;
  upgradeable?: boolean;
  compoundable?: boolean;
  buyable?: boolean;
  properties?: Record<string, string | number | boolean>;
  scaling?: Record<string, string | number | boolean>;
  maxLevel?: number;
  usage?: {
    classes: { id: string; name: string; hands: number | null }[];
    hands: number[];
  };
  world?: ItemWorldInfo;
  sprite: Sprite | null;
};
