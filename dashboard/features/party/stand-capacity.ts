import type { StandListing } from './stand-listing';
import type { StandBid } from './stand-bid';

// Automatic buys yield their slots to sales; explicit buy orders reserve them.
export function standIsFull(listings: StandListing[], bids: Record<string, StandBid> = {}): boolean {
  return listings.filter(listing => listing.state !== 'paused').length +
    Object.values(bids).filter(bid => bid.useStandSlot).length >= 16;
}
