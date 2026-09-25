import type { Sight, Point } from "./rare-types.ts";
export interface Failed {
  sight: Sight;
  origin: Point;
}
/** A fresh timestamp alone does not make an unchanged rejected encounter actionable. */
export function createRareRetryEvidence(saved: Record<string, Failed> = {}) {
  const failed = new Map<string, Failed>(Object.entries(saved));
  return {
    reject(id: string, sight: Sight, origin: Point) {
      saved[id] = { sight: { ...sight }, origin: { ...origin } };
      failed.set(id, saved[id]);
    },
    remove(id: string) {
      failed.delete(id); delete saved[id];
    },
    eligible(id: string, sight: Sight, origin: Point, reachable = false): boolean {
      const old = failed.get(id);
      if (!old) return true;
      const changed =
        sight.seenAt > old.sight.seenAt &&
        (sight.hp < old.sight.hp || sight.partyEngaged && !old.sight.partyEngaged || reachable && !old.sight.reachable) && origin.map === sight.map;
      if (changed) { failed.delete(id); delete saved[id]; }
      return !!changed;
    },
  };
}
