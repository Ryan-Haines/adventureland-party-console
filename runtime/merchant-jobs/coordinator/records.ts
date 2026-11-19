// The job owner's records: one protocol
// ring entry per decision, `part: 'merchant'`, at most 20 per subject (3.the add-on owner's size for this ring).
// The subject is the merchant, and each entry names its job in `owner` (`job:<id>`) or the slot's
// writer. The stuck record is the tasks owner's ladder's, so the ring keeps no snapshot of its own.
import { createMovementRing, type RingEntry } from '../../protocol/records.ts';
import { partyHooks } from '../../hooks/index.ts';
import type { MerchantJobNotice } from '../../hooks/registry.ts';

export const MERCHANT_RING_SIZE = 20;
type Entry = Omit<RingEntry, 'seq' | 'at' | 'part'> & { by?: string; subject: string };
const rings = new Map<string, ReturnType<typeof createMovementRing<Entry & { part: 'merchant' }>>>();

// The notice each decision sends. An add-on kind's refusal
// and clamp are ring entries only.
const NOTICES: Readonly<Record<string, MerchantJobNotice>> = {
  queued: 'merchant.job.queued', claimed: 'merchant.job.started', paused: 'merchant.job.paused', resumed: 'merchant.job.resumed',
  ended: 'merchant.job.ended', blocked: 'merchant.job.blocked', unblocked: 'merchant.job.unblocked',
  'slot-written': 'merchant.slot.written', 'slot-cleared': 'merchant.slot.written', 'slot-held': 'merchant.slot.held',
  'slot-refused': 'merchant.slot.refused', 'no-tool': 'merchant.gathering.noTool',
};

// Writes one entry under its subject and sends its notice: queued, claimed, paused with `by`,
// resumed, ended with its code, blocked and unblocked, a written, refused or held slot write. The
// entry's `by` is the decision's author, its owner when none is named.
export function recordMerchant(entry: Entry, now: () => number = Date.now): void {
  let ring = rings.get(entry.subject);
  if (!ring) rings.set(entry.subject, ring = createMovementRing<Entry & { part: 'merchant' }>(now, MERCHANT_RING_SIZE));
  ring.push({ ...entry, part: 'merchant' });
  const notice = NOTICES[entry.decision];
  if (notice) partyHooks().notify(notice, { ...entry, by: entry.by ?? entry.owner });
}

// The entries of one subject, oldest first, for diagnostics and the unit rows.
export function merchantRecords(subject: string) {
  return rings.get(subject)?.entries() ?? [];
}
