// The items owner's records (3.1 "records.ts", 6 part 2): one notice per change. The decision is
// the notice's name without `items.`, so an entry and its notice can't drift apart. Readers, the
// unit rows included, hear the notices; no product read took the ring entries, so records.ts keeps
// none.
import type { RingEntry } from '../../protocol/records.ts';
import { partyHooks } from '../../hooks/index.ts';
import type { ItemsNotice } from '../../hooks/registry.ts';

export type ItemsDecision = ItemsNotice extends `items.${infer Name}` ? Name : never;
/** One change: its subject (a character, the bank, an add-on), its author `by` and its details. */
export type ItemsEntry = Omit<RingEntry, 'seq' | 'at' | 'part' | 'decision'> & {
  decision: ItemsDecision; subject: string; by: string; [detail: string]: unknown;
};

/** Sends one change's notice. */
export function recordItems(entry: ItemsEntry): void {
  partyHooks().notify(`items.${entry.decision}` as ItemsNotice, entry);
}
