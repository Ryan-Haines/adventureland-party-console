import type { Sight, Point } from "./rare-types.ts";
interface Failed {
  sight: Sight;
  origin: Point;
}
/** A fresh timestamp alone does not make an unchanged rejected encounter actionable. */
export function createRareRetryEvidence() {
  const failed = new Map<string, Failed>();
  return {
    reject(id: string, sight: Sight, origin: Point) {
      failed.set(id, { sight: { ...sight }, origin: { ...origin } });
    },
    remove(id: string) {
      failed.delete(id);
    },
    eligible(id: string, sight: Sight, origin: Point): boolean {
      const old = failed.get(id);
      if (!old) return true;
      const changed =
        sight.hp < old.sight.hp ||
        sight.target !== old.sight.target ||
        sight.partyEngaged ||
        sight.map !== old.sight.map ||
        Math.hypot(sight.x - old.sight.x, sight.y - old.sight.y) > 20 ||
        origin.map !== old.origin.map ||
        Math.hypot(origin.x - old.origin.x, origin.y - old.origin.y) > 50;
      if (changed) failed.delete(id);
      return !!changed;
    },
  };
}
