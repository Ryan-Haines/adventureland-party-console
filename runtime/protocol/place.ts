// The one "same place" rule for both runtimes. The game sets `in` on every character and entity,
// and outside an instance `in` is the map name (character.in, game pin in tools/sim/pins.json), so
// a place is its map plus its instance and the map stands in for a missing `in`. A saved location
// or a record written without `in` then matches a report on the same map.
export interface Place { map?: string; in?: string | number }

/** The instance a place sits in: its `in`, or its map outside an instance. */
export function placeKey(p: Place): string { return String(p.in ?? p.map); }

/** Two places are one when they share the map and the instance. */
export function samePlace(a: Place, b: Place): boolean {
  return a.map === b.map && placeKey(a) === placeKey(b);
}
