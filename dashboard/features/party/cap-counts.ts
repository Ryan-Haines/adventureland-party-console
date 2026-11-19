"use client";
import { boundsPending, boundsSent, capReached } from '../../../runtime/status/api.ts';
import { reportAction } from './query-actions';

// The dashboard's caps (the parsed-doll cache, an upgrade estimate's roll budget, yields and batch
// cache) count through the status owner's `capReached`, as a game window's do. The page sends no status report, so
// each count posts the queued cap entries to the coordinator's bound record (status
// coordinator/routes.ts `/diagnostics/caps`) through the action client's reportAction, so a lost
// session ends the page's session as any write does. One post goes at a time. A count that lands while a post is
// out goes with the next post, which starts when that one is taken; a failed post keeps its entries
// queued for the next count, and their sequence numbers keep a resent entry from counting twice.
let posting = false;
export function countCap(cap: string, owner: string, count = 1): void {
  capReached(cap, owner, count);
  void post();
}
async function post(): Promise<void> {
  if (posting) return;
  const firings = boundsPending();
  if (!firings.length) return;
  posting = true;
  let taken = false;
  try {
    await reportAction('/diagnostics/caps', { firings });
    taken = true;
  } catch {
    taken = false;
  } finally {
    posting = false;
  }
  if (!taken) return;
  boundsSent(firings.length);
  void post();
}
