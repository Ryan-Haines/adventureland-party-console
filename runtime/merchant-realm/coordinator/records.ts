// The realm owner's records:
// each decision sends its notice (a move and its owner, a refused want with its reason, a
// switch phase). No product reads a ring of these entries, so none is kept (the ruling of
// 10-2 cause 19 for the items ring); a reconnect sends no notice.
import type { RingEntry } from '../../protocol/records.ts';
import { partyHooks } from '../../hooks/index.ts';
import type { RealmNotice } from '../../hooks/registry.ts';

type Entry = Omit<RingEntry, 'seq' | 'at' | 'part'> & { subject: string };

const NOTICES: Readonly<Record<string, RealmNotice>> = {
  move: 'realm.move.started', arrived: 'realm.move.arrived', failed: 'realm.move.failed', refused: 'realm.want.refused',
  granted: 'realm.want.granted', phase: 'realm.switch.phase',
};

// Sends one decision's notice, `by` the want's owner.
export function recordRealm(entry: Entry): void {
  const notice = NOTICES[entry.decision];
  if (notice) partyHooks().notify(notice, { ...entry, by: entry.owner });
}
