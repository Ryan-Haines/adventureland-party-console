"use client";

export type CombatLogEntry = {
  at: number;
  type: string;
  message: string;
  details?: unknown;
};
