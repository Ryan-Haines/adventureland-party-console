interface Position {
  map: string;
  x: unknown;
  y: unknown;
}
interface MonsterChoice<Location> {
  id: string;
  locations?: Location[] | null;
}
interface DestinationState<Location> {
  leader: string | null;
  followers: Record<string, unknown>;
  statuses: Record<string, Position>;
  monsterFocus?: string[] | null;
  monsterFocusByCharacter: Record<string, string[]>;
  monsterPrioritiesByCharacter: Record<string, Record<string, unknown>>;
  monsterChoices?: MonsterChoice<Location>[] | null;
}
interface Candidate<Location> {
  id: string;
  location: Location;
}

function selectedFocus<Location>(state: DestinationState<Location>, name: string | null): string[] {
  if (name === state.leader || state.followers[String(name)]) return state.monsterFocus || [];
  return Object.prototype.hasOwnProperty.call(state.monsterFocusByCharacter, String(name))
    ? state.monsterFocusByCharacter[String(name)]
    : state.monsterFocus || [];
}

function distance(location: Position, status: Position): number {
  return location.map === status.map
    ? Math.hypot(Number(location.x) - Number(status.x), Number(location.y) - Number(status.y))
    : Number.MAX_SAFE_INTEGER;
}

function compare<Location extends Position>(
  a: Candidate<Location>,
  b: Candidate<Location>,
  priorities: Record<string, unknown>,
  status: Position,
): number {
  const priorityDifference = (Number(priorities[b.id]) || 50) - (Number(priorities[a.id]) || 50);
  return priorityDifference || distance(a.location, status) - distance(b.location, status);
}

/** Shared focus governs party members; independent characters can explicitly select no monsters. */
export function selectCoordinatorMonsterDestination<Location extends Position>(
  state: DestinationState<Location>,
  name: string | null,
): Candidate<Location> | null {
  const status = state.statuses[String(name)];
  const focus = selectedFocus(state, name);
  const priorities = state.monsterPrioritiesByCharacter[String(name)] || {};
  if (!status || !Array.isArray(state.monsterChoices)) return null;
  const selected = new Set(focus.filter((id) => id !== "all"));
  const candidates = state.monsterChoices.flatMap((monster) =>
    selected.has(monster.id) && Array.isArray(monster.locations)
      ? monster.locations.map((location) => ({ id: monster.id, location }))
      : [],
  );
  if (!candidates.length) return null;
  candidates.sort((a, b) => compare(a, b, priorities, status));
  return candidates[0];
}
