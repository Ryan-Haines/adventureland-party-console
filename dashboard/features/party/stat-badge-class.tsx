"use client";
import type { CSSProperties } from "react";
import { STAT_COLORS } from "./stat-colors";

const BADGE_STATS = ["str", "int", "dex", "vit"] as const;
type BadgeStat = (typeof BADGE_STATS)[number];
const badgeStat = (statType?: string): BadgeStat | undefined =>
  BADGE_STATS.find((stat) => stat === statType?.toLowerCase());

// A stat badge draws its stat's STAT_COLORS colour, the one the card's stat line draws
// (docs/stat-colors.md). Tailwind compiles only class names written here, so the colour reaches the
// classes through the --stat property statBadgeStyle sets.
export function statBadgeClass(statType?: string) {
  return badgeStat(statType)
    ? "bg-black/90 text-(--stat) ring-(--stat)/50"
    : "bg-slate-950/90 text-slate-200 ring-slate-500/50";
}
export function statBadgeStyle(statType?: string): CSSProperties | undefined {
  const stat = badgeStat(statType);
  return stat ? ({ "--stat": STAT_COLORS[stat] } as CSSProperties) : undefined;
}
