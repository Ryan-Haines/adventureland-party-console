"use client";
import { MerchantExchangeResult } from "./merchant-exchange-result";
import { Sprite } from "./sprite";

export type MerchantExchangeItem = {
  key: string;
  id: string;
  level: number;
  name: string;
  cost: number;
  required: number;
  npc: string;
  sprite: Sprite | null;
  results: MerchantExchangeResult[];
  reward?: string;
  rewardQuantity?: number;
  currencyName?: string;
  currencySprite?: Sprite | null;
  choices?: MerchantExchangeItem[];
};
