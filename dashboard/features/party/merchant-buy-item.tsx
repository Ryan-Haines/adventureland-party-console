"use client";
import { Sprite } from "./sprite";

export type MerchantBuyItem = {
  id: string;
  name: string;
  cost: number;
  seller: string;
  sprite: Sprite | null;
  upgradeable?: boolean;
  compoundable?: boolean;
  upgradeGrade?: number;
  grades?: number[];
  upgradeChances?: number[];
  scrollCosts?: number[];
};
