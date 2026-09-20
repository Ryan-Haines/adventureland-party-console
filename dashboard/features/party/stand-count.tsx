import { useQuery } from '@tanstack/react-query';
import { characterKey, useCharacterData } from './dashboard-live';
import type { Char } from './char';
import { occupiedStandSlots } from './stand-inspection';
import type { StandListing } from './stand-listing';
import type { PartyState } from './party-state';
export function StandCount({ name, listings = [], nativeStand, bids }: { name: string; listings?: StandListing[]; nativeStand?: PartyState['nativeStand']; bids?: PartyState['standBids'] }) {
  const presence = useCharacterData(name,'presence');
  const query = useQuery({
    queryKey: characterKey(name, 'inventory'),
    enabled: false,
    queryFn: (): Partial<Char> => ({}),
  });
  return <>{occupiedStandSlots(listings,nativeStand,{...query.data,...presence},bids)}</>;
}
