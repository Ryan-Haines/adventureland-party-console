// The game window's side of the status owner's bound record (coordinator/bounds.ts; bigcheck/bounds.md; the user's
// rule of 2026-11-13). A kept bound that runs in a game window queues its firing here, and the
// window's next report carries the queue to the coordinator, whose intake hands each firing to
// `boundFired` there. A CODE frame's report is its status post (apply.ts `post`); the Steam window's
// is its bridge post (lifecycle roster/bridge.ts). The queue empties on each report the coordinator
// takes, so its length is the firings since the last one.
import type { BoundFiring } from '../coordinator/bounds.ts';

/** A firing as a game window queues it: `subject` defaults to the reporting character at intake.
 *  `session` and `seq` name it, so the coordinator records a firing a report carries again once. */
export type QueuedFiring = Omit<BoundFiring, 'subject'> & { subject?: string; session: string; seq: number };

// The queue sits on the window's global, so the loader's bundle and the class bundle it installs in
// one CODE frame (lifecycle character/loader.ts) fill the one queue that frame's report sends. Its
// session names this window's queue, so a reloaded window's numbering starts apart from the last.
interface Queue { session: string; seq: number; firings: QueuedFiring[]; caps?: Record<string, { owner: string; count: number }> }
const host = globalThis as { __partyBoundQueue?: Queue };
const queue = (): Queue => (host.__partyBoundQueue ||= { session: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2), seq: 0, firings: [] });

export function boundFired(firing: Omit<QueuedFiring, 'session' | 'seq'>): void {
  const q = queue();
  q.firings.push({ ...firing, session: q.session, seq: ++q.seq });
}
// A size, memory or CPU cap reaching its limit is normal operation, so it adds to one count per cap
// and queues no firing of its own. The next report folds each count into one `cap` entry of the
// firing queue (`boundsPending`), so a report carries at most one entry per cap and a resent report
// counts once by its seq like any firing.
export function capReached(cap: string, owner: string, count = 1): void {
  const caps = (queue().caps ||= {});
  const entry = (caps[cap] ||= { owner, count: 0 });
  entry.count += count;
}
/** The firings the next report carries, with the cap counts since the last report folded in. */
export function boundsPending(): QueuedFiring[] {
  const q = queue();
  for (const [cap, { owner, count }] of Object.entries(q.caps || {}))
    q.firings.push({ bound: cap, owner, cap: true, state: { count }, session: q.session, seq: ++q.seq });
  q.caps = {};
  return q.firings.slice();
}
/** The coordinator took a report that carried the first `count` firings. */
export function boundsSent(count: number): void { queue().firings.splice(0, count); }
