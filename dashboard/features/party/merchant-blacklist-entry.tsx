"use client";

export type MerchantBlacklistEntry = {
  seller: string;
  serverRegion?: string;
  serverIdentifier?: string;
  reason?: string;
  failures?: number;
  until: number;
  cooldownMinutes?: number;
  updatedAt?: number;
};
