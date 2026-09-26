import type { Sight, Point } from "./rare-types.ts";
export interface Failed {
  sight: Sight;
  origin: Point;
}
function snapshot(sight: Sight, origin: Point): Failed {
  // Callers pass complete heartbeat objects as Point. Never retain their inventory,
  // catalogs, combat traces or other mutable runtime state in a rejection receipt.
  return { sight: {id:sight.id, mtype:sight.mtype, map:sight.map, x:sight.x, y:sight.y,
    hp:sight.hp, target:sight.target, realm:sight.realm, in:sight.in, seenAt:sight.seenAt,
    reporter:sight.reporter, visible:sight.visible, partyEngaged:sight.partyEngaged,
    reachable:sight.reachable}, origin: {map:origin.map, x:origin.x, y:origin.y} };
}
/** A fresh timestamp alone does not make an unchanged rejected encounter actionable. */
export function createRareRetryEvidence(saved: Record<string, Failed> = {}) {
  // Migrate existing receipts without clearing their rejection or retry evidence.
  for (const [id, entry] of Object.entries(saved)) saved[id] = snapshot(entry.sight, entry.origin);
  const failed = new Map<string, Failed>(Object.entries(saved));
  return {
    reject(id: string, sight: Sight, origin: Point) {
      saved[id] = snapshot(sight, origin);
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
