"use client";

export function exactLevelPrice(
  price: number | undefined,
  observedLevel: number | undefined,
  itemLevel: number,
) {
  return price && observedLevel != null && Number(observedLevel) === itemLevel ? price : undefined;
}
