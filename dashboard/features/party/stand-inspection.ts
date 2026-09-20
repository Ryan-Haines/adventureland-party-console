import type { Char } from './char';
import type { StandListing } from './stand-listing';
import type { StandBid } from './stand-bid';
import type { PartyState } from './party-state';
import type { Item } from './item';

const identity = (a: Item, b: Item) => a.name === b.name && Number(a.level || 0) === Number(b.level || 0) && a.p === b.p && a.stat_type === b.stat_type && JSON.stringify(a.data) === JSON.stringify(b.data);
function standOccupants(listings: StandListing[], native: PartyState['nativeStand'], merchant?: Partial<Char>) {
  const slots = new Map<string, { kind: 'sale' | 'buy'; item?: Item; itemId?: string; listing?: StandListing }>();
  const valid = (slot: string) => /^trade(?:[1-9]|1[0-6])$/.test(slot);
  for (const [slot, entry] of Object.entries(merchant?.slots || {}))
    if (valid(slot) && entry) slots.set(slot, {kind: entry.item.b ? 'buy' : 'sale', item: entry.item});
  if (!merchant?.standOpen) {
    for (const offer of Object.values(native?.offers || {}))
      if (valid(offer.slot) && !slots.has(offer.slot) && ['live','removing'].includes(offer.phase)) slots.set(offer.slot,{kind:'buy',itemId:offer.itemId});
    for (const listing of listings)
      if (listing.tradeSlot && valid(listing.tradeSlot) && !slots.has(listing.tradeSlot) && listing.state === 'live')
        slots.set(listing.tradeSlot,{kind:'sale',item:listing.item,listing});
  }
  return slots;
}
export function standOccupancy(listings: StandListing[], native: PartyState['nativeStand'], merchant?: Partial<Char>, bids: Record<string, StandBid> = {}) {
  const slots = standOccupants(listings,native,merchant);
  const sales = [...slots.values()].filter(entry=>entry.kind === 'sale').length;
  const placedBuys = new Set([...slots.values()].filter(entry=>entry.kind === 'buy').map(entry=>entry.item?.name || entry.itemId));
  const reserved = Object.entries(bids).filter(([id,bid])=>bid.useStandSlot && !placedBuys.has(id)).length;
  return {sales, buys:slots.size-sales+reserved, total:slots.size+reserved};
}
export function occupiedStandSlots(listings: StandListing[], native: PartyState['nativeStand'], merchant?: Partial<Char>, bids: Record<string, StandBid> = {}) {
  return standOccupancy(listings,native,merchant,bids).total;
}
export function standSaleRows(listings: StandListing[], merchant?: Char, native?: PartyState['nativeStand']) {
  const slots = Object.entries(merchant?.slots || {}).filter(([slot, entry]) => slot.startsWith('trade') && entry && !entry.item.b);
  const occupants = standOccupants(listings,native,merchant);
  const used = new Set<string>();
  const rows = listings.map((configured, index) => {
    const match = configured.state !== 'paused' ? slots.find(([slot, entry]) => !used.has(slot) && identity(configured.item, entry!.item) && (!configured.tradeSlot || configured.tradeSlot === slot)) : undefined;
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
export function standBuyRows(bids: Record<string, StandBid>, native: PartyState['nativeStand'], merchant?: Char) {
  const offers = Object.values(native?.offers || {});
  return Object.entries(bids).filter(([id, bid]) => bid.useStandSlot || offers.some(offer => offer.itemId === id && offer.auto)).map(([id, bid]) => {
    const offer = offers.find(offer => offer.itemId === id);
    const level = offer?.level ?? Number(bid.minimumQuality || 0);
    const entry = offer ? merchant?.slots?.[offer.slot] : undefined;
    const observed = entry?.item.b === true && entry.item.name === id && Number(entry.item.level || 0) === level && Number(entry.item.price) === (offer?.price ?? bid.price) ? entry : undefined;
    const problem = native?.problems[id] || offer?.problem;
    const status = problem || (merchant?.standOpen && observed ? 'Live' : !merchant?.standOpen ? 'Queued · stand closed' : offer?.phase === 'removing' ? 'Removing' : 'Queued');
    return { id, bid, offer, observed, level, status };
  });
}

