import type { AnniversaryState } from "./contracts.ts";

interface SavedAnniversary extends Partial<AnniversaryState> {
  [key: string]: unknown;
}

/** Saved round state overrides defaults; obsolete exclusions are discarded on restore. */
export function initialAnniversaryState(
  saved: SavedAnniversary | null | undefined,
): AnniversaryState {
  const restored = { ...saved };
  // Migration only: old saves must not reintroduce the removed feature.
  delete restored.blacklist;
  return {
    nativeSlice: null,
    rounds: {},
    advertisedRounds: {},
    reciprocal: {},
    pendingReturns: {},
    activity: [],
    crafted: 0,
    ...restored,
    abortedRounds: Object.fromEntries(Object.entries(saved?.abortedRounds || {}).filter(([, value]) => (value as {reason?:string})?.reason !== "target-blacklisted")),
    attempts: saved?.attempts || {},
  };
}
