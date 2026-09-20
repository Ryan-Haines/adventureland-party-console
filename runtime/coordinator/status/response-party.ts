import type { EntityReference, HeartbeatState, HeartbeatStatus } from "./response-types.ts";

const positionFields = [
  "ctype",
  "map",
  "x",
  "y",
  "escape",
  "server",
  "seenAt",
  "in",
  "hp",
  "max_hp",
  "mp",
  "max_mp",
  "rip",
  "attack",
  "frequency",
  "range",
  "activeCombatTarget",
  "monsterHunt",
] as const;

function position(name: string, status: HeartbeatStatus) {
  return {
    name,
    ...Object.fromEntries(positionFields.map((field) => [field, status[field]])),
    kiting: !!status.combat?.kiting,
    team: status.eventTeam || null,
    activeEvent: status.activeEvent || status.joinedEvent || null,
    armorPiercing: status.combatStats && status.combatStats.armorPiercing,
  };
}

function uniqueReferences(entries: (EntityReference | null | undefined)[]): EntityReference[] {
  const seen = new Set<string>();
  return entries.filter((entry): entry is EntityReference => {
    if (!entry || typeof entry.id !== "string" || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function partyResponse(
  state: HeartbeatState,
  names: string[],
  leader: HeartbeatStatus | null | undefined,
) {
  return {
    desiredPartyMembers: names.filter(
      (name) =>
        (name === state.leader || state.followers[name]) &&
        leader &&
        state.statuses[name]?.server === leader.server,
    ),
    partyPositions: names.map((name) => position(name, state.statuses[name]!)),
    partyThreats: uniqueReferences(
      names
        .filter((name) => name !== state.leader)
        .flatMap((name) => {
          const threats = state.statuses[name]?.threats;
          return Array.isArray(threats) ? threats : [];
        }),
    ),
    partyTargets: uniqueReferences(names.map((name) => state.statuses[name]?.target)),
  };
}

export function monsterFocus(state: HeartbeatState, name: string): string[] {
  if (state.farmingPolicy === "hunt" && state.monsterHunt?.target)
    return [state.monsterHunt.target];
  if ((name === state.leader || state.followers[name]) && state.leader) return state.monsterFocus;
  return Object.prototype.hasOwnProperty.call(state.monsterFocusByCharacter, name)
    ? state.monsterFocusByCharacter[name]!
    : state.monsterFocus;
}

const requiredCatalogs = [
  "travelPlaces",
  "monsterChoices",
  "monsterHunterLocation",
  "bestiaryCatalog",
  "skillCatalog",
  "appearanceChoices",
  "merchantCatalog",
] as const;
export function needsCatalog(state: HeartbeatState): boolean {
  return (
    state.monsterLocationsVersion !== 3 ||
    requiredCatalogs.some((field) => !state[field]) ||
    state.merchantCatalogVersion !== "token-shops-v3"
  );
}
