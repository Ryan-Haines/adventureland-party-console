// Hunt travel's walk part: whether a walk is the outbound Hunt and whether it defends. Targeting
// reconciles the walk's encounters (runtime/coordinator/targeting/hunt-travel.ts `updateHuntTravel`)
// and reads these two through movement's coordinator door, so movement imports no targeting value here.
import type { HuntTravelConvoy } from '../../coordinator/targeting/api.ts';

export function outboundHunt(c: HuntTravelConvoy | null | undefined): boolean {
  return !!c && c.purpose === 'monster-hunt' && !!c.huntTarget && !c.continuousReturn;
}
export function huntDefense(c: HuntTravelConvoy): boolean {
  return c.phase === 'defending' || c.phase === 'observing' && c.observationPhase === 'defending';
}
