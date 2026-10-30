import { pruneLuckCasts } from "./luck.ts";

interface SavedGathering {
  gatheringModes?: string[] | null;
  gatheringMode?: string | null;
  gatheringNoTool?: Record<string, boolean> | null;
  gatheringCooldowns?: Record<string, number | undefined> | null;
  mluckCastAt?: Record<string, number> | null;
}

/** Saved multi-mode choices, including an empty array, take precedence over legacy single-mode selection. */
export function initialGatheringState(saved: SavedGathering, now: () => number = Date.now) {
  const mluckCastAt = { ...saved.mluckCastAt };
  pruneLuckCasts(mluckCastAt, now());
  return {
    gatheringModes: Array.isArray(saved.gatheringModes)
      ? saved.gatheringModes
      : saved.gatheringMode
        ? [saved.gatheringMode]
        : [],
    gatheringNoTool: saved.gatheringNoTool || {},
    gatheringCooldowns: saved.gatheringCooldowns || { fishing: 0, mining: 0 },
    mluckCastAt,
  };
}
