/** Death attribution follows authorized participation, not globally visible bosses. */
export interface HuntEventTrip {
  event: string;
  startedAt: number;
  endedAt?: number;
}
export interface HuntEventTrips {
  huntEventTrips?: Record<string, HuntEventTrip[]>;
  combatEventHandoff?: { startedAt: number; endedAt?: number } | null;
}

export function beginHuntEventTrip(
  state: HuntEventTrips,
  name: string,
  event: string,
  now: number,
): HuntEventTrip {
  const trips = ((state.huntEventTrips ||= {})[name] ||= []);
  const current = trips.at(-1);
  if (current && !current.endedAt && current.event === event) return current;
  if (current && !current.endedAt) current.endedAt = now;
  const trip = { event, startedAt: now };
  state.combatEventHandoff ||= { startedAt: now };
  delete state.combatEventHandoff.endedAt;
  trips.push(trip);
  if (trips.length > 32) trips.splice(0, trips.length - 32);
  return trip;
}

function hasOpenTrip(state: HuntEventTrips): boolean {
  return Object.values(state.huntEventTrips || {}).some(
    (trips) => trips.length && !trips.at(-1)!.endedAt,
  );
}

export function endHuntEventTrip(
  state: HuntEventTrips,
  name: string,
  event: string | undefined,
  now: number,
): void {
  const trip = state.huntEventTrips?.[name]?.at(-1);
  if (trip && !trip.endedAt && (!event || trip.event === event)) trip.endedAt = now;
  if (state.combatEventHandoff && !hasOpenTrip(state)) state.combatEventHandoff.endedAt ||= now;
}
