"use client";

export function comparisonSlotLabel(slot: string) {
  return slot === "mainhand"
    ? "Main hand"
    : slot === "offhand"
      ? "Off hand"
      : slot === "ring1"
        ? "Ring 1"
        : slot === "ring2"
          ? "Ring 2"
          : slot === "earring1"
            ? "Earring 1"
            : slot === "earring2"
              ? "Earring 2"
              : slot;
}
