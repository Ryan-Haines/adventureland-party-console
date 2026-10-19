"use client";

export type Item = {
  l?: string | boolean;
  gift?: boolean;
  expires?: number | string;
  name: string;
  level?: number;
  q?: number;
  // Account bound; the game prints "Account Bound" on the card.
  acl?: number | boolean;
  p?: string;
  stat_type?: string;
  data?: unknown;
  price?: number;
  rid?: string;
  b?: boolean;
  m?: boolean | string | number;
};
