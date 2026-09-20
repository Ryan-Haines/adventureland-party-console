"use client";
import { Item } from "./item";

export type UpgradeMark = {
  slot: number | string;
  item: Item;
  equipped?: boolean;
  tiers?: number;
  auto?: boolean;
  offering?: import("../../../runtime/upgrade-offerings").UpgradeOffering;
  requestId?: string;
  waitingOffering?: { offering: string; level: number; signature: string };
};
