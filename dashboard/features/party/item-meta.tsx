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
  // Class-only and map-only bonuses, from the definition's nested class and map fields.
  bonuses?: { kind: "class" | "map"; id: string; name: string; stats: Record<string, number> }[];
  usage?: {
    classes: { id: string; name: string; hands: number | null }[];
    hands: number[];
  };
  world?: ItemWorldInfo;
  sprite: Sprite | null;
};
