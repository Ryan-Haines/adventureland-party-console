import { readFileSync } from 'node:fs';
import path from 'node:path';
import { requestObject } from '../http/contracts.ts';
/** Host-owned maintenance lease; never exported as a game preference. */
export function consoleMaintenance(directory: string | undefined, now = Date.now) {
  let lease: { id: string; expires: number } | null = null, checked = 0;
  const participants = new Set<string>();
  function current() {
    if (!directory) return null;
    if (now() - checked < 250) return lease;
    checked = now();
    try {
      const input = requestObject(JSON.parse(readFileSync(path.join(directory, 'updates/pause.json'), 'utf8')));
      if (typeof input.id !== 'string' || typeof input.expires !== 'number' || input.expires < now()) { lease = null; return null; }
      if (input.id !== lease?.id) participants.clear();
      return lease = { id: input.id, expires: input.expires };
    } catch { lease = null; return null; }
  }
  function status(statuses: Record<string, unknown>, expected: readonly (string | null)[] = [], blocked = false) {
    const active = current();
    if (!active) return { ready: false, waiting: [], id: null };
    for (const name of expected) if (name) participants.add(name);
    for (const [name, raw] of Object.entries(statuses)) {
      const report = requestObject(raw);
      if (Number(report.seenAt) > now() - 15000) participants.add(name);
    }
    const waiting = [...participants].filter(name => {
      const report = requestObject(statuses[name]), ack = requestObject(report.consoleMaintenance);
      return Number(report.seenAt) < now() - 5000 || ack.id !== active.id || ack.ready !== true;
    });
    if (blocked) waiting.push('active Steam handoff');
    return { id: active.id, ready: waiting.length === 0, waiting };
  }
  return { current, status };
}
