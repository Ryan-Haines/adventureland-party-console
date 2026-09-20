"use client";
import { Sprite } from "./sprite";

export type MerchantExchangeResult = {
  kind: string;
  id: string;
  name: string;
  quantity: number;
  chance: number;
  sprite: Sprite | null;
};
