"use client";

export function abbreviatedGold(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(3)}b`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(3)}m`;
  if (value >= 100_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}
