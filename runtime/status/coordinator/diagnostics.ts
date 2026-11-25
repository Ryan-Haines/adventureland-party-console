// The diagnostics lease for every ring.
// A character's rings live in
// its memory and never travel in the report. A diagnostics view reads a character's records and
// names the rings it shows; each read starts or renews that character's lease on those rings, and
// while a lease lasts the reply names its rings (reply.ts's diagnostics section), so the character
// posts each one as its own request after the report. A lease lasts two of the character's measured
// report intervals after the view's last read, the bound the standing holds use:
// a view that keeps reading keeps it, and one that stops releases it within two
// reports. The saved snapshots stay the movement owner's (movement/coordinator/records.ts); the view reads them here
// beside the live rings, and its routes are in routes.ts. An add-on's own ring leases the same way
// under its add-on's name (`diagnostics-ring`). The Diagnostics button reads the alerts: every saved
// snapshot, each one a death, a stuck moment, a caught error, a refusal (runtime/protocol/records.ts
// `refusal`), a failed walk or task, churn, a fallback to a safe point or a call-limit disconnect. The last `records.saved` notice tells the
// dashboard to read them again.
import { reportInterval } from '../../protocol/reports.ts';
import type { LeasedRing } from '../rules.ts';
import type { DiagnosticsAlert, RecordSaved } from '../api.ts';
import { partyHooks } from '../../hooks/index.ts';

interface PostedRing { at: number; records: unknown[]; incidents: unknown[] }
interface DiagnosticsPorts {
  now(): number;
  // The character's last report, whose `reportIntervalMs` sets the lease's life.
  status(name: string): { reportIntervalMs?: unknown } | undefined;
  // The movement owner's saved snapshots of a character, newest first, without their rings.
  snapshots(name: string): unknown[];
  // Every saved snapshot of every subject from its file name, and one snapshot whole.
  saved(): DiagnosticsAlert[];
  report(subject: string, id: string): unknown;
}

export function createDiagnostics(ports: DiagnosticsPorts) {
  const leases = new Map<string, Map<LeasedRing, number>>(), posted = new Map<string, Map<LeasedRing, PostedRing>>();
  let lastSaved: RecordSaved | null = null;
  // The rings a character's lease still names; an ended ring's last post goes with it.
  function rings(name: string): LeasedRing[] {
    const held = leases.get(name), now = ports.now();
    if (!held) return [];
    const ended: LeasedRing[] = [];
    for (const [ring, until] of held) if (now >= until) { held.delete(ring); posted.get(name)?.delete(ring); ended.push(ring); }
    if (ended.length) partyHooks().notify('diagnostics.released', { character: name, rings: ended, by: 'user' });
    return [...held.keys()];
  }
  const service = {
    rings,
    // `records.saved` (the movement owner's notice): the last save, which the dashboard's state carries.
    saved(payload: Record<string, unknown>) {
      lastSaved = { at: ports.now(), ring: String(payload.ring), character: String(payload.character), record: String(payload.record) };
    },
    lastSaved: (): RecordSaved | null => lastSaved,
    // The alerts list; reading it takes no lease, so no character posts a ring for it.
    alerts: (): DiagnosticsAlert[] => ports.saved(),
    // One alert's report: the snapshot's facts and the routine records that led up to it.
    report: (subject: string, id: string): unknown => ports.report(subject, id),
    // A view's read: renews the lease on each named ring and answers the live posts and the movement owner's snapshots.
    read(name: string, named: readonly LeasedRing[]) {
      // An ended ring leaves first, so a view that comes back leases it again.
      rings(name);
      const until = ports.now() + 2 * reportInterval(ports.status(name)), held = leases.get(name) ?? new Map();
      leases.set(name, held);
      const leased = named.filter(ring => !held.has(ring));
      for (const ring of named) held.set(ring, until);
      if (leased.length) partyHooks().notify('diagnostics.leased', { character: name, rings: leased, by: 'user' });
      const live = posted.get(name);
      return { character: name, until, live: Object.fromEntries(named.map(ring => [ring, live?.get(ring) ?? null])),
        snapshots: ports.snapshots(name) };
    },
    // The character's post of one ring. A post without a lease on it is refused: the ring stays
    // on the character unless a view reads it.
    post(name: string, ring: LeasedRing, body: Omit<PostedRing, 'at'>): boolean {
      if (!rings(name).includes(ring)) return false;
      const live = posted.get(name) ?? new Map();
      posted.set(name, live);
      live.set(ring, { at: ports.now(), records: body.records, incidents: body.incidents });
      return true;
    },
  };
  return service;
}
export type Diagnostics = ReturnType<typeof createDiagnostics>;
