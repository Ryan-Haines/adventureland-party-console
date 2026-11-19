import type { StandBid } from './stand-bid';

type SaveBid = (
  itemId: string, price: number, quantity: number, minimumQuality?: number, clear?: boolean,
  priorityOverride?: number | null, options?: Record<string, unknown>,
) => Promise<unknown>;

// An active-bid field edit posts the whole bid with the one edited field replaced and the bid's
// revision attached, so the bid route rejects an edit made against a stale bid.
export async function saveActiveBidField(
  itemId: string, bid: StandBid, field: 'price' | 'quantity' | 'priority', value: number | null, onBid: SaveBid,
) {
  await onBid(itemId, field === 'price' ? value! : bid.price,
    field === 'quantity' ? value! : bid.quantity, bid.minimumQuality, false,
    field === 'priority' ? value : bid.priorityOverride,
    { editField: field === 'priority' ? 'priorityOverride' : field, value, bidRevision: bid.revision || 0 });
}

// A priority draft that differs from the bid's saved priority posts with the bid's revision; a
// blank draft clears the priority. It returns whether a post went out.
export async function saveStandPriorityDraft(
  itemId: string, bid: StandBid, draft: string | undefined, onBid: SaveBid,
) {
  if (draft === undefined) return false;
  const priority = draft === '' ? null : Number(draft);
  if (priority === (bid.priorityOverride ?? null)) return false;
  await onBid(itemId, bid.price, bid.quantity, bid.minimumQuality, false, priority,
    { editField: 'priorityOverride', value: priority, bidRevision: bid.revision || 0 });
  return true;
}
