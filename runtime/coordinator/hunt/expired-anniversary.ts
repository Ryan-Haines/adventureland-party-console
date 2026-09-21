import type { HuntCycle, HuntTickPorts, HuntTickState } from "./contracts.ts";
import { endHuntEventTrip } from "../events/hunt-trip.ts";

/** An expired round can yield its saved farming checkpoint to the same Hunt's Daisy return. */
export function expiredAnniversaryCanYield(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  const cycle = state.anniversary?.eventCycle;
  if (!cycle || !Number.isFinite(cycle.endsAt) || ports.now() < Number(cycle.endsAt)) return false;
  if (!cycle.participants?.length || cycle.returnDispatchedAt) return false;
  if (Object.values(cycle.kissOperations || {}).some(op => op.expiresAt > ports.now())) return false;
  return cycle.participants.every(name => hunt.participants.includes(name) &&
    cycle.waypoints?.[name]?.revision === ports.intent(name).revision &&
    cycle.waypoints?.[name]?.revision !== undefined && !state.statuses[name]?.anniversaryState?.busy);
}

export function supersedeExpiredAnniversary(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): void {
  if (!expiredAnniversaryCanYield(hunt, state, ports)) return;
  const cycle = state.anniversary!.eventCycle!;
  cycle.supersededAt = ports.now();
  cycle.returnReason = "Expired anniversary farming return superseded by Hunt turn-in";
  for (const name of cycle.participants!) endHuntEventTrip(state, name, "anniversary", ports.now());
}
