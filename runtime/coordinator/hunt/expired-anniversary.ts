import type { HuntCycle, HuntTickPorts, HuntTickState } from "./contracts.ts";
import { endHuntEventTrip } from "../events/hunt-trip.ts";

/** An expired round can yield its saved farming checkpoint to the same Hunt's Daisy return. */
export function expiredAnniversaryCanYield(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts, failedCheckpoint?: boolean): boolean {
  const cycle = state.anniversary?.eventCycle;
  if (!cycle || !expiredAt(cycle.endsAt,ports.now())) return false;
  if (!cycle.participants?.length || (cycle.returnDispatchedAt && !failedCheckpoint)) return false;
  if (Object.values(cycle.kissOperations || {}).some(op => op.expiresAt > ports.now())) return false;
  return cycle.participants.every(name => hunt.participants.includes(name) &&
    cycle.waypoints?.[name]?.revision === ports.intent(name).revision &&
    cycle.waypoints?.[name]?.revision !== undefined && !state.statuses[name]?.anniversaryState?.busy);
}
function expiredAt(endsAt: unknown, now: number): boolean {
  return Number.isFinite(endsAt) && now>=Number(endsAt);
}

export function supersedeExpiredAnniversary(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts, failedCheckpoint?: boolean): void {
  if (!expiredAnniversaryCanYield(hunt, state, ports, failedCheckpoint)) return;
  const cycle = state.anniversary!.eventCycle!;
  cycle.supersededAt = ports.now();
  cycle.returnReason = "Expired anniversary farming return superseded by Hunt turn-in";
  for (const name of cycle.participants!) endHuntEventTrip(state, name, "anniversary", ports.now());
}
