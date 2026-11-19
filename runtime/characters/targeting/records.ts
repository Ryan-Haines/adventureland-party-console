// The targeting ring on the character:
// the protocol's one entry shape (`part: 'targeting'`, runtime/protocol/records.ts), at
// most the protocol ring's one bound (`MOVEMENT_RING_SIZE`, V3.3 Counts). It keeps what targeting passed over or refused: a target the character's own
// hit in flight already kills (`skipped`) and an `allows` refusal (`refused`). Each is
// one entry until it changes, so a pass that keeps the same skip or refusal writes nothing. The
// ring lives in memory and is read on demand (`__partyTargeting.records()`). Each entry is also one
// notice, told as it is written.
import { createMovementRing } from '../../protocol/records.ts';
import type { TargetingNotice } from '../../hooks/registry.ts';

export interface TargetingRecord {
  part: 'targeting'; kind: 'retired' | 'skipped' | 'refused' | 'marks-cleared';
  target?: string; skill?: string; why?: string;
  // A refusal's G check, with A's row when A refused, and its source.
  row?: string; by?: string;
  // A skip's damage in flight and the HP it covered (3.7).
  damage?: number; hp?: number;
}
export type TargetingEntry = Omit<TargetingRecord, 'part'>;
// The notice each ring entry is.
const NOTICES: Record<TargetingRecord['kind'], TargetingNotice> = {
  retired: 'targeting.retired', skipped: 'targeting.skipped', refused: 'targeting.refused', 'marks-cleared': 'targeting.cleared' };
export function createTargetingRing(notify: (hook: TargetingNotice, entry: TargetingEntry) => void = () => {}, now: () => number = () => Date.now()) {
  const ring = createMovementRing<TargetingRecord>(now);
  return {
    record(entry: TargetingEntry): void {
      ring.push({ part: 'targeting', ...entry });
      notify(NOTICES[entry.kind], entry);
    },
    entries: () => ring.entries(),
  };
}
