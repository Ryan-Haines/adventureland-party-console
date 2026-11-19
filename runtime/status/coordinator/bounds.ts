// The safety bound record (big check part 6, the user's rule of 2026-11-13): a named bound an owner
// keeps against a failure outside the console's code (the game server, the network, a process) tells
// this record each time it trips. Each firing is one ring entry naming the bound, its owner, the
// member or job and the state at that moment, and one count per bound, so a bound that fires shows on
// the diagnostics read and the end run counts it. In normal play any firing is a finding: either the
// outside failure is real, or a console bug hides behind the bound and gets fixed at its cause.
// A bound on the coordinator calls `boundFired` through the status owner's coordinator door. A bound in a game
// window calls the `boundFired` of the status owner's door for both runtimes (status/api.ts, character/bounds.ts),
// whose queue its window's next report carries here (`boundsReported`). No owner keeps its own copy.
import { createMovementRing } from '../../protocol/records.ts';

// The ring holds the newest 20 firings with their state, for the diagnostics read; the counts below
// keep every firing, so the ring only bounds how much state the read shows.
const BOUND_RING_SIZE = 20;
export interface BoundFiring { bound: string; owner: string; subject: string; state: Record<string, unknown>; cap?: true }
const ring = createMovementRing<BoundFiring>(Date.now, BOUND_RING_SIZE);
const counts = new Map<string, number>();

// The metrics history's series: metrics/service.ts hands its counter here while it runs.
let series: ((firing: BoundFiring) => void) | null = null;
export function boundSeries(counter: typeof series): void { series = counter; }

export function boundFired(firing: BoundFiring): void {
  ring.push(firing);
  counts.set(firing.bound, (counts.get(firing.bound) || 0) + 1);
  series?.(firing);
}

// A size, memory or CPU cap reaching its limit (a truncated text, an evicted entry, a yield) is
// normal operation, not a failure, so it adds to its own count per cap and takes no ring entry,
// metrics series or diagnostic. The diagnostics bounds read shows the counts beside the bounds'.
const capCounts = new Map<string, { owner: string; count: number }>();
export function capReached(cap: string, owner: string, count = 1): void {
  const entry = capCounts.get(cap) || { owner, count: 0 };
  entry.count += count;
  capCounts.set(cap, entry);
}

// A game window's report carries the firings its kept bounds queued (character/bounds.ts): a CODE
// frame's status report (intake.ts, table I's `bounds` row) and the Steam window's bridge report
// (lifecycle roster/bridge-session.ts). One that names no subject is the reporter's. A report the
// window sends again after a lost answer carries the same firings, and `taken` keeps the highest
// `seq` each window queue's `session` has reported, so each firing counts once. The map holds one
// entry per window queue that reported in this run. The queue is console code, so a firing with no
// bound or owner is a console bug and shows as its own bound, `malformedFiring`.
const taken = new Map<string, number>();
export function boundsReported(firings: unknown, reporter: string): void {
  for (const firing of Array.isArray(firings) ? firings as Record<string, unknown>[] : []) {
    const session = typeof firing?.session === 'string' ? firing.session : null, seq = Number(firing?.seq);
    if (session && Number.isSafeInteger(seq)) {
      if (seq <= (taken.get(session) ?? 0)) continue;
      taken.set(session, seq);
    }
    const subject = typeof firing?.subject === 'string' ? firing.subject : reporter;
    if (firing?.cap === true && typeof firing.bound === 'string' && typeof firing.owner === 'string') {
      const count = Number((firing.state as Record<string, unknown> | undefined)?.count);
      capReached(firing.bound, firing.owner, Number.isSafeInteger(count) && count > 0 ? count : 1);
      continue;
    }
    if (typeof firing?.bound !== 'string' || typeof firing.owner !== 'string') {
      boundFired({ bound: 'malformedFiring', owner: '12', subject: reporter, state: { firing } });
      continue;
    }
    const state = firing.state && typeof firing.state === 'object' ? firing.state as Record<string, unknown> : {};
    boundFired({ bound: firing.bound, owner: firing.owner, subject, state });
  }
}

// The firings since start, oldest first, the count per bound and the count per cap: the
// diagnostics bounds read (routes.ts) and the unit rows.
export function boundFirings(): { counts: Record<string, number>; entries: ReturnType<typeof ring.entries>; caps: Record<string, { owner: string; count: number }> } {
  return { counts: Object.fromEntries(counts), entries: ring.entries(), caps: Object.fromEntries([...capCounts].map(([cap, entry]) => [cap, { ...entry }])) };
}

