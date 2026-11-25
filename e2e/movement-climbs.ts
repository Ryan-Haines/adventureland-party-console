// The step gate's climbs, stalls and re-sends per hour. The movement ring keeps only its last 128 records, so this reads each character's
// ring every 2 s across the whole test and counts each record once by its time and sequence. The
// walking try's own counts (the owner's `walkTries`) add up across runtime reloads. Each test
// appends one line per character to .build/e2e-results/movement-climbs.jsonl, with the reads that
// failed and the gaps where the ring wrapped over records between two reads, so a short count
// shows whether the run was quiet or the reader missed records.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {sequenceGaps} from './native-observer-kit';

interface Client { page: { isClosed(): boolean }; readonly frame: unknown; run(code: string): Promise<unknown> }
type Counts = { climbs: number; rungFailures: number; failedJourneys: number; resends: number; stalls: number; failedReads: number; gaps: number };

export function startMovementClimbs(clients: Record<string, Client>, test: string) {
  const startedAt = Date.now(), seen = new Map<string, Set<string>>(), counts = new Map<string, Counts>();
  const tries = new Map<string, { last: { resends: number; stalls: number }; before: { resends: number; stalls: number } }>();
  const read = `(()=>{const m=globalThis.__partyMovement;if(!m)return null;return {records:m.records().map(r=>[r.at,r.seq,r.decision,String(r.code||'')]),tries:m.ownerReport?.().walkTries??null};})()`;
  const ring = sequenceGaps();
  async function sample(): Promise<void> {
    for (const [name, client] of Object.entries(clients)) {
      if (client.page.isClosed()) continue;
      const c = counts.get(name) ?? { climbs: 0, rungFailures: 0, failedJourneys: 0, resends: 0, stalls: 0, failedReads: 0, gaps: 0 };
      counts.set(name, c);
      let got: { records: [number, number, string, string][]; tries: { resends: number; stalls: number } | null } | null;
      // A character with no game frame now (a headless worker) fails the read either way; run
      // retries it for 30 s first, which held the fixture's teardown on the last sample.
      try { void client.frame; } catch { c.failedReads++; continue; }
      try { got = await client.run(read) as typeof got; } catch { c.failedReads++; continue; }
      if (!got) continue;
      ring.read(name, got.records.map(([, seq]) => seq));
      c.gaps = ring.gaps(name);
      const keys = seen.get(name) ?? new Set<string>();
      seen.set(name, keys);
      for (const [at, seq, decision, code] of got.records) {
        if (at < startedAt) continue;
        const key = `${at}:${seq}`;
        if (keys.has(key)) continue;
        keys.add(key);
        if (decision === 'rung') c.climbs++;
        if (decision === 'rung-failed') c.rungFailures++;
        if (decision === 'ended' && code.startsWith('failed')) c.failedJourneys++;
      }
      if (got.tries) {
        const t = tries.get(name) ?? { last: { resends: 0, stalls: 0 }, before: { resends: 0, stalls: 0 } };
        // A reload starts the owner's counts again; the counts before it stay.
        if (got.tries.resends < t.last.resends || got.tries.stalls < t.last.stalls) t.before = { resends: t.before.resends + t.last.resends, stalls: t.before.stalls + t.last.stalls };
        t.last = got.tries; tries.set(name, t);
        c.resends = t.before.resends + t.last.resends; c.stalls = t.before.stalls + t.last.stalls;
      }
    }
  }
  let busy = false;
  const timer = setInterval(() => { if (busy) return; busy = true; void sample().finally(() => { busy = false; }); }, 2000);
  return async function stop(): Promise<void> {
    clearInterval(timer);
    await sample();
    const file = path.resolve('.build/e2e-results/movement-climbs.jsonl'), ms = Date.now() - startedAt;
    mkdirSync(path.dirname(file), { recursive: true });
    for (const [name, c] of counts) appendFileSync(file, JSON.stringify({ test, name, ms, ...c }) + '\n');
  };
}
