"use client";
import { ALDataBuyOrder } from "./aldata-buy-order";
import { ALDataListing } from "./aldata-listing";
import { ALDataPublicTrade } from "./aldata-public-trade";

export type ALDataState = {
  hasKey: boolean;
  auth: "NO" | "YES" | "CORRECT" | "WRONG";
  authCheckedAt: number;
  merchantsUpdatedAt: number;
  tradesUpdatedAt: number;
  publishStatus: string;
  publishedAt: number;
  error?: string | null;
  listings?: ALDataListing[];
  buyOrders?: ALDataBuyOrder[];
  trades?: ALDataPublicTrade[];
};
