import type { FarmingSelections, SavedFarmingSelections } from "./selection-contracts.ts";

function focus(settings: SavedFarmingSelections, selections: SavedFarmingSelections): string[] {
  if (Array.isArray(selections.monsterFocus)) return selections.monsterFocus;
  if (Array.isArray(settings.monsterFocus)) return settings.monsterFocus;
  return typeof settings.monsterFocus === "string" ? [settings.monsterFocus] : ["goo"];
}

/** Explicit empty focus arrays remain authoritative across the legacy settings migration. */
export function initialFarmingSelections(
  settings: SavedFarmingSelections,
  selections: SavedFarmingSelections,
): FarmingSelections {
  return {
    monsterFocus: focus(settings, selections),
    monsterFocusByCharacter:
      selections.monsterFocusByCharacter || settings.monsterFocusByCharacter || {},
    monsterPrioritiesByCharacter:
      selections.monsterPrioritiesByCharacter || settings.monsterPrioritiesByCharacter || {},
    monsterSearchRadiusByCharacter:
      selections.monsterSearchRadiusByCharacter || settings.monsterSearchRadiusByCharacter || {},
    farmingPolicy: ["auto", "default", "scatter", "hunt"].includes(settings.farmingPolicy!)
      ? settings.farmingPolicy!
      : "auto",
  };
}
