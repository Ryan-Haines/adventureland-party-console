"use client";

export type StandBid = {
  revision?: number;
  price: number;
  quantity: number;
  minimumQuality?: number;
  priorityOverride?: number;
  useStandSlot?: boolean;
  acceptHigherLevels?: boolean;
};
