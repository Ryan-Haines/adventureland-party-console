// The one NPC trip of the items owner and the merchant jobs owner: every walk to an NPC before a
// networked call goes through it, so the computer rule (rules.ts `reachesWithoutWalking`) is read
// in one place. Each owner builds it once over its own walk.
import { reachesWithoutWalking, type NetworkedCall } from '../rules.ts';

type TripPorts = { character(): Parameters<typeof reachesWithoutWalking>[0]; G(): Parameters<typeof reachesWithoutWalking>[1] };
export type NpcTrip = (destination: unknown, call: NetworkedCall) => Promise<boolean>;

// npcTrip answers whether it walked, so a trip with a walk back returns only from a walk.
export function npcTrip(ports: TripPorts, walk: (destination: unknown) => Promise<unknown>): NpcTrip {
  return async (destination, call) => {
    if (reachesWithoutWalking(ports.character(), ports.G(), call)) return false;
    await walk(destination);
    return true;
  };
}
