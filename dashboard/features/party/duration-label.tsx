"use client";
import { formatDuration } from "./format-duration";

// A countdown's time left, rounded up to the whole second.
export function timeLeft(ms: number) {
  return formatDuration(Math.ceil(ms / 1000) * 1000);
}

export function durationLabel(ms?: number | null) {
  if (ms === null || ms === undefined) return "Active";
  if (ms <= 0) return "Expiring";
  return timeLeft(ms);
}
