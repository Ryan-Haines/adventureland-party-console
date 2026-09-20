"use client";

export type SteamSwitch = {
  from: string | null;
  target: string | null;
  startedAt: number;
  timedOut: boolean;
  phase?: "awaiting-realm-choice" | "preparing" | "release" | "confirm-release" | "navigate" | "complete" | "failed";
  error?: string | null;
};
