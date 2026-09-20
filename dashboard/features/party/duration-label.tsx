"use client";
import { formatDuration } from "./format-duration";

export function durationLabel(ms?: number | null) {
  if (ms === null || ms === undefined) return "Active";
  if (ms <= 0) return "Expiring";
  return formatDuration(Math.ceil(ms / 1000) * 1000);
}
