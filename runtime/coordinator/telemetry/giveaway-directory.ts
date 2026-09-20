import type { PublicState, PublicStatePorts } from "./public-state-types.ts";

function addCharacters(
  players: Record<string, string[]>,
  state: Readonly<PublicState>,
  ports: PublicStatePorts,
): void {
  for (const status of Object.values(state.statuses)) {
    if (
      !status ||
      status.seenAt < ports.now() - 15_000 ||
      !status.server ||
      !Array.isArray(status.realmPlayers)
    )
      continue;
    const key = "SR_" + status.server;
    players[key] = [...new Set([...(players[key] || []), ...status.realmPlayers])].sort();
  }
}

function addMerchants(
  players: Record<string, string[]>,
  state: Readonly<PublicState>,
  ports: PublicStatePorts,
): void {
  for (const merchant of state.aldata.merchants || []) {
    if (!merchant?.id || Date.parse(merchant.lastSeen || "0") < ports.now() - 120_000) continue;
    const key =
      "SR_" + String(merchant.serverRegion || "") + String(merchant.serverIdentifier || "");
    players[key] = [...new Set([...(players[key] || []), merchant.id])].sort();
  }
}

/** Combines fresh character observations with recently seen marketplace merchants. */
export function giveawayDirectory(state: Readonly<PublicState>, ports: PublicStatePorts) {
  const players: Record<string, string[]> = {};
  addCharacters(players, state, ports);
  addMerchants(players, state, ports);
  return players;
}
