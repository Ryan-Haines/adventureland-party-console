"use client";

export type ALDataPublicTrade = {
  owner: string;
  label?: string;
  characters?: string[];
  lastUpdated?: number;
  listings?: {
    name: string;
    level?: number;
    p?: string;
    note?: string;
    wts?: { price?: number; quantity?: number; priceNegotiable?: boolean };
    wtb?: { price?: number; quantity?: number; priceNegotiable?: boolean };
  }[];
};
