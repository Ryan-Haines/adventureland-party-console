"use client";

export type StandPriceHistory = {
  lowest: number;
  lowestLevel?: number;
  recent: number;
  recentLevel?: number;
  seenAt: number;
  marketLow?: number;
  marketLowLevel?: number;
  highestPublicWTB?: number;
  highestPublicWTBLevel?: number;
};
