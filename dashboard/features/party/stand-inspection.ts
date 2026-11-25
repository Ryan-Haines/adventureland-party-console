import type { Char } from './char';
import type { StandListing } from './stand-listing';
import type { StandBid } from './stand-bid';
import type { PartyState } from './party-state';
import type { Item } from './item';
import { markMatches } from '../../../runtime/items/api.ts';

// A stand cell is any trade cell the game reports; its count is the items owner's `standSlots`.
const validStandSlot = (slot: string) => /^trade[1-9]\d*$/.test(slot);
function standOccupants(listings: StandListing[], native: PartyState['nativeStand'], merchant?: Partial<Char>) {
  const slots = new Map<string, { kind: 'sale' | 'buy'; item?: Item; itemId?: string; listing?: StandListing; offer?: NonNullable<PartyState['nativeStand']>['offers'][string] }>();
  for (const [slot, entry] of Object.entries(merchant?.slots || {}))
    if (validStandSlot(slot) && entry) slots.set(slot, {kind: entry.item.b ? 'buy' : 'sale', item: entry.item});
  if (!merchant?.standOpen) {
    for (const offer of Object.values(native?.offers || {}))
      if (validStandSlot(offer.slot) && !slots.has(offer.slot) && ['live','removing'].includes(offer.phase)) slots.set(offer.slot,{kind:'buy',itemId:offer.itemId,offer});
    for (const listing of listings)
      if (listing.tradeSlot && validStandSlot(listing.tradeSlot) && !slots.has(listing.tradeSlot) && listing.state === 'live')
        slots.set(listing.tradeSlot,{kind:'sale',item:listing.item,listing});
  }
  return slots;
}
export function standSaleRows(listings: StandListing[], merchant?: Char, native?: PartyState['nativeStand']) {
  const slots = Object.entries(merchant?.slots || {}).filter(([slot, entry]) => validStandSlot(slot) && entry && !entry.item.b);
  const occupants = standOccupants(listings,native,merchant);
  const used = new Set<string>();
  const rows = listings.map((configured, index) => {
    const match = configured.state !== 'paused' ? slots.find(([slot, entry]) => !used.has(slot) && markMatches(entry!.item, configured.item) && (!configured.tradeSlot || configured.tradeSlot === slot)) : undefined;
    const stored = !match && configured.state === 'live' && configured.tradeSlot && !used.has(configured.tradeSlot) && occupants.get(configured.tradeSlot)?.listing === configured;
    if (match) used.add(match[0]);
    else if (stored && configured.tradeSlot) used.add(configured.tradeSlot);
    return { occupied: !!match || !!stored, configured, liveEntry: match?.[1], editable: true, key: configured.id || `configured-${index}`, status: configured.state === 'paused' ? 'Paused' : merchant?.standOpen && match && Number(match[1]!.item.price) === configured.price ? 'Live' : 'Queued' };
  });
  for (const [slot, entry] of slots) {
    if (!entry || used.has(slot)) continue;
    rows.push({ occupied: true, configured: { slot: Number(slot.replace('trade', '')), item: entry.item, price: Number(entry.item.price || 0), quantity: Number(entry.item.q || 1) }, liveEntry: entry, editable: false, key: slot, status: merchant?.standOpen ? 'Live' : 'Queued' });
  }
  return rows;
}
export function standBuyRows(bids: Record<string, StandBid>, native: PartyState['nativeStand'], merchant?: Char, listings: StandListing[] = []) {
  const offers = Object.values(native?.offers || {});
  return [...standOccupants(listings, native, merchant)]
    .filter(([, occupant]) => occupant.kind === 'buy')
    .sort(([a], [b]) => Number(a.slice(5)) - Number(b.slice(5)))
    .map(([slot, occupant]) => {
      const observed = merchant?.slots?.[slot];
      const id = occupant.item?.name || occupant.itemId!;
      const offer = occupant.offer || offers.find(candidate => candidate.slot === slot && candidate.itemId === id &&
        Number(occupant.item?.level || 0) === candidate.level && Number(occupant.item?.price) === candidate.price);
      const level = Number(occupant.item?.level ?? offer?.level ?? 0);
      const price = Number(occupant.item?.price ?? offer?.price ?? 0);
      const quantity = Number(occupant.item?.q ?? (offer ? Math.max(0, Number(offer.quantity || 1) - Number(offer.acknowledged || 0)) : 1));
      const bid: StandBid | undefined = bids[id];
      return { key: slot, id, bid, offer, observed, level, price, quantity };
    });
}
