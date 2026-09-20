"use client";

export type MonsterHuntStatus = {
  id: string | null;
  count: number;
  remainingMs: number | null;
  server: string | null;
};
