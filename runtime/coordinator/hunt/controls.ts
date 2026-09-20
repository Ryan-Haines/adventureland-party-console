interface HuntMember {
  seenAt: number;
  ctype?: string;
  server?: string;
}
interface PartyMembers {
  leader: string | null;
  statuses: Record<string, HuntMember | undefined>;
  followers: Record<string, unknown>;
}
interface HuntCommands {
  activeConvoy?: { purpose?: string | null; participants?: string[] } | null;
  commands: Record<string, { purpose?: string | null } | undefined>;
  monsterHunt: { cycleId?: string; participants?: string[] } | null;
}
interface Position {
  map: string;
  x: unknown;
  y: unknown;
}
interface MonsterChoice {
  id: string;
  locations?: unknown;
}

function memberOrder(leader: string | null, first: string, second: string): number {
  if (first === leader) return -1;
  return second === leader ? 1 : first.localeCompare(second);
}

/** Only a fresh combat leader can gather followers on its current realm. */
export function coordinatorHuntParticipants(
  state: PartyMembers,
  now: () => number,
  activeNames: () => string[],
): string[] {
  const leader = state.leader && state.statuses[state.leader];
  if (!leader || leader.seenAt < now() - 10000 || leader.ctype === "merchant") return [];
  return activeNames()
    .filter((name) => {
      const status = state.statuses[name];
      return (
        status &&
        status.ctype !== "merchant" &&
        status.server === leader.server &&
        (name === state.leader || state.followers[name])
      );
    })
    .sort((first, second) => memberOrder(state.leader, first, second));
}

/** Release Hunt travel without deleting replacement commands owned by another activity. */
export function cancelCoordinatorHuntConvoy(state: HuntCommands): void {
  if (!state.activeConvoy || state.activeConvoy.purpose !== "monster-hunt") return;
  for (const name of state.activeConvoy.participants || []) {
    if (state.commands[name]?.purpose === "monster-hunt") delete state.commands[name];
  }
  state.activeConvoy = null;
}

export function clearCoordinatorHunt(state: HuntCommands): void {
  cancelCoordinatorHuntConvoy(state);
  for (const name of Object.keys(state.commands)) {
    if (state.monsterHunt?.participants?.includes(name) && state.commands[name]?.purpose === "monster-hunt") delete state.commands[name];
  }
  state.monsterHunt = null;
}

function distance(location: Position, leader: Position): number {
  return location.map === leader.map
    ? Math.hypot(Number(location.x) - Number(leader.x), Number(location.y) - Number(leader.y))
    : Number.MAX_SAFE_INTEGER;
}

/** Prefer the nearest same-map zone; retain source order for equally ranked zones. */
export function coordinatorHuntDestination<Choice extends MonsterChoice, Location extends Position>(
  state: {
    leader: string | null;
    statuses: Record<string, Position | undefined>;
    monsterChoices?: Choice[] | null;
  },
  type: string | null | undefined,
  zones: (choices: Choice[], focus: string[]) => Location[],
): Location | null | undefined {
  const leader = state.leader && state.statuses[state.leader];
  const choice = (state.monsterChoices || []).find((entry) => entry.id === type);
  if (!leader || !choice || !Array.isArray(choice.locations) || !choice.locations.length)
    return null;
  // A matching catalog choice establishes the string id; retain the caller's exact value.
  return zones(state.monsterChoices || [], [type!]).sort(
    (first, second) => distance(first, leader) - distance(second, leader),
  )[0];
}

export function coordinatorHuntThreat(
  catalog: { id: string; threat?: unknown; hp?: unknown }[] | null | undefined,
  type: string,
) {
  const monster: { threat?: unknown; hp?: unknown } =
    (catalog || []).find((entry) => entry.id === type) || {};
  return { threat: Number(monster.threat) || 0, hp: Number(monster.hp) || 0 };
}
