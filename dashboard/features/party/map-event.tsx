"use client";

export type MapEvent = {
  kind: string;
  at: number;
  data: Record<string, string | number | boolean | unknown[]>;
};
