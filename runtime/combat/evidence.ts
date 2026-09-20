import type { Evidence } from './queue.ts';
import type { Death } from './grouped.ts';

export function sameEvidenceTarget(a: Pick<Evidence, 'id' | 'map' | 'in' | 'server'>, b: Pick<Evidence, 'id' | 'map' | 'in' | 'server'>): boolean {
  return String(a.id) === String(b.id) && a.map === b.map && a.in === b.in && a.server === b.server;
}

/** Death cleanup runs even when scatter has stopped the grouped polling channel. */
export function retireDeadEvidence(events: Evidence[], deaths: Death[], retired: (event: Evidence) => void): void {
  for (let i = events.length - 1; i >= 0; i--) {
    if (!deaths.some(death => sameEvidenceTarget(events[i], death))) continue;
    retired(events[i]);
    events.splice(i, 1);
  }
}
