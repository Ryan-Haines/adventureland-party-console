// The overkill skip: a target is passed over while the character's own damage in flight on it
// covers its HP. The damage in flight is the turns owner's projectile tracker (`skills.incoming`),
// which holds each hit from its `action` packet until its `hit` packet or its eta, at 0.9 of the
// mitigated damage. A miss, an evade or a heal shows only when the hit lands, so a monster that
// lived is a candidate again on the next pass. The tracker's entries key on one projectile, so a
// new fight starts with no skip from an old one.
import type { TargetingEntry } from './records.ts';
import { MOVEMENT_RING_SIZE } from '../../protocol/records.ts';

export interface SkipPorts {
  // This character's own damage in flight on the target.
  incoming(target: string): number;
  // Whether the target is still a live entity the character sees.
  live(target: string): boolean;
  record(entry: TargetingEntry): void;
  now?(): number;
}
// One held skip: its target, the damage in flight that covered the HP, the HP it covered, and its
// first and last pass. The turns checks read it to tell a skipped attack edge from an empty one
// (decided 2026-11-09).
export interface HeldSkip { target: string; damage: number; hp: number; since: number; last: number }
export function createOverkillSkip(ports: SkipPorts) {
  const now = ports.now ?? (() => Date.now());
  // The skips that hold now, by target, so a skip writes one ring entry while it lasts. A target
  // whose hit kills it is never asked again, so each new skip first drops the held skips whose
  // target is no live entity, and the map keeps only skips that still hold (V3.3 Counts).
  const held = new Map<string, HeldSkip>();
  return {
    covers(target: { id: string; hp?: number }): boolean {
      const hp = Number(target.hp), id = String(target.id), damage = hp > 0 ? ports.incoming(id) : 0;
      if (!(hp > 0 && damage >= hp)) { held.delete(id); return false; }
      const at = now(), skip = held.get(id);
      if (skip) { skip.damage = damage; skip.hp = hp; skip.last = at; return true; }
      for (const other of held.keys()) if (!ports.live(other)) held.delete(other);
      held.set(id, { target: id, damage, hp, since: at, last: at });
      ports.record({ kind: 'skipped', target: id, damage, hp, why: "the character's own hit in flight covers its HP" });
      return true;
    },
    held(id: string): HeldSkip | null { const skip = held.get(String(id)); return skip ? { ...skip } : null; },
  };
}
export type OverkillSkip = ReturnType<typeof createOverkillSkip>;

// An unreachable target: movement's notice at its approach's last level or its sight search's end sets the
// target aside on the targeting owner's own list (install.ts `setAsideFor`) and drops it as this character's
// selection, so the finders that read the mark pick another or none. The id never goes on the killed list,
// which would refuse it as a confirmed death. Every mark clears at each fight's start: the pass where
// survival's fight fact turns true after a pass where it was false. Inside one fight a mark keeps its 10 s.
export interface RetirePorts {
  // `fail` sets the mark and answers its expiry on the character's clock; `any` answers whether a
  // mark that has not expired is set.
  // `marked` answers whether the target's mark has not expired.
  marks: { fail(id: string): number | void; clear(): void; any(): boolean; marked(id: string): boolean };
  // The role runner's selection and its drop (runner.ts `dropTarget`, beside `invalidateTarget`).
  selected(): string | null;
  drop(id: string): void;
  // `survival.fighting`: the survival owner's fight fact.
  fighting(): boolean;
  record(entry: TargetingEntry): void;
  // Whether this character leads its party, and the grouped lock target the
  // coordinator's queue holds (shared.js `groupedCombat.target`), or null.
  leader?(): boolean;
  lock?(): { id: string; map: string; in?: string | number } | null;
}
// A notice the queue reads from the leader's report: the lock it cannot reach, when, and when the
// leader's failed-approach mark on it expires (`until`), so the queue's own exclusion ends with the
// mark. The report carries it while that target is still the lock, so the queue retires it once.
export interface UnreachableLock { id: string; map: string; in?: string | number; at: number; until?: number }
export function createRetire(ports: RetirePorts) {
  // The fight fact the last pass read, or null while no mark was set, when the pass asks nothing:
  // with no mark there is nothing to clear, and survival's fight test is the target timer's largest
  // cost. A mark then reads the fight it starts in, so a mark set inside a fight holds.
  let fought: boolean | null = false;
  let unreachableLock: UnreachableLock | null = null;
  // The targets this character has retired. Movement repeats its notice for the same target on
  // later approaches, and each repeat renews the mark and the drop; only the first writes the ring
  // entry and its `targeting.retired` notice. The set keeps the newest MOVEMENT_RING_SIZE ids (V3.3
  // Counts).
  const retired = new Set<string>();
  function report(): UnreachableLock[] {
    if (unreachableLock && ports.lock?.()?.id !== unreachableLock.id) unreachableLock = null;
    return unreachableLock ? [{ ...unreachableLock }] : [];
  }
  return {
    notice(notice: { character?: unknown; target?: unknown; why?: unknown }): void {
      if (notice.character !== character.name || notice.target === undefined || notice.target === null) return;
      const id = String(notice.target);
      const until = ports.marks.fail(id);
      if (fought === null) fought = ports.fighting();
      if (!retired.has(id)) {
        retired.add(id);
        if (retired.size > MOVEMENT_RING_SIZE) retired.delete(retired.values().next().value!);
        ports.record({ kind: 'retired', target: id, why: String(notice.why ?? 'unreachable'), by: 'core:targeting' });
      }
      if (ports.selected() === id) ports.drop(id);
      // TGT-Q19, decided 2026-11-09: the leader's notice on its own lock target goes to the
      // queue, which retires the lock the way a lost target retires (runtime/coordinator/targeting/queue.ts).
      const lock = ports.lock?.();
      if (lock && String(lock.id) === id && ports.leader?.())
        unreachableLock = { id, map: lock.map, in: lock.in, at: Date.now(), ...(typeof until === 'number' ? { until } : {}) };
    },
    report,
    // Whether the approach to `id` must not start: this character's notice on its lock target still
    // waits for the queue's retire inside the notice's mark, or the target's mark is live. The lock
    // stays `id` for one queue round trip after the notice and then goes null, while the member's
    // cached lock target stays `id` one update longer; the live mark covers that update.
    retiring(id: string): boolean {
      const held = report()[0];
      return (!!held && held.id === String(id) && (held.until === undefined || Date.now() < held.until)) || ports.marks.marked(String(id));
    },
    pass(): void {
      if (!ports.marks.any()) { fought = null; return; }
      const now = ports.fighting();
      if (now && fought === false) { ports.marks.clear(); ports.record({ kind: 'marks-cleared', why: 'a fight started' }); }
      fought = now;
    },
  };
}
export type Retire = ReturnType<typeof createRetire>;
