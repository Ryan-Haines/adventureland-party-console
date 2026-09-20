import type { HuntCycle } from "./contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";
interface MembershipState {
  leader: string | null; merchantCharacter: string | null; followers: Record<string, boolean>;
  farmingProfiles: Record<string, unknown>;
  statuses: Record<string, {map: string; x: number; y: number; seenAt: number} | undefined>;
  commands: Record<string, {id?: number; type: string; purpose?: string | null; convoyId?: string} | undefined>;
  navigationIntents: Record<string, {revision: number; cancelled: boolean} | undefined>;
  characterLocations: Record<string, ReturnLocation | undefined>;
  combatResetByCharacter: Record<string, number | undefined>; groupedCombatResetAt: number;
  activeConvoy: {id: string; participants: string[]} | null;
  monsterHunt: HuntCycle | null; combatRecovery: unknown;
  location: ReturnLocation | null; nextCommandId: number;
}
function retireConvoy(state: MembershipState, name: string): void {
  const convoy = state.activeConvoy;
  if (!convoy?.participants.includes(name)) return;
  for (const member of convoy.participants) {
    if (state.commands[member]?.convoyId === convoy.id) delete state.commands[member];
  }
  state.activeConvoy = null;
  if (state.monsterHunt) state.monsterHunt.convoyId = null;
}
function removeHuntMember(hunt: HuntCycle, name: string): void {
  hunt.participants = hunt.participants.filter(member => member !== name);
  if (hunt.owner !== name && hunt.turnIn?.owner !== name) return;
  delete hunt.turnIn;
  delete hunt.owner;
  delete hunt.loot;
  hunt.target = null;
  hunt.missions = [];
  hunt.currentIndex = -1;
  hunt.stage = "checking-quests";
}
/** Preserve personal preferences while revoking only the departing controller's work. */
export function reconcileFarmingMembership<T extends MembershipState>(party: T, farmingScopes: { owner(name: string): string; view(name: string): T }, previous: { leader: string | null; followers: Record<string, boolean> }, now = Date.now) {
      const names = [...new Set([...Object.keys(party.statuses), ...Object.keys(party.farmingProfiles), ...Object.keys(previous.followers)])];
      const oldOwner = (name: string) => previous.leader && previous.followers[name] ? previous.leader : name;
      const changed = names.filter(name => name !== party.merchantCharacter && oldOwner(name) !== farmingScopes.owner(name));
      if (previous.leader !== party.leader) {
        for (const name of [previous.leader, party.leader]) if (name && !changed.includes(name)) changed.push(name);
      }
      for (const name of changed) retireFarmingMembership(name, oldOwner(name));
      for (const name of changed) joinFarmingMembership(name);
    function retireFarmingMembership(name: string, previousOwner: string) {
      const state = farmingScopes.view(previousOwner), hunt = state.monsterHunt;
      retireConvoy(state, name);
      if (["monster-hunt", "farming-follow"].includes(state.commands[name]?.purpose || "")) delete state.commands[name];
      party.navigationIntents[name] = { revision: (party.navigationIntents[name]?.revision || 0) + 1, cancelled: false };
      delete party.characterLocations[name];
      party.combatResetByCharacter[name] = now();
      state.groupedCombatResetAt = now();
      if (name === previousOwner) {
        if (hunt?.returnLocation) state.location = hunt.returnLocation;
        state.monsterHunt = null;
        state.combatRecovery = null;
      } else if (hunt) removeHuntMember(hunt, name);
    }
    function joinFarmingMembership(name: string) {
      const owner = farmingScopes.owner(name), state = farmingScopes.view(owner);
      if (owner === name) return;
      const hunt = state.monsterHunt;
      if (hunt && !hunt.participants.includes(name)) hunt.participants.push(name);
      const leader = party.statuses[owner];
      if (!leader || now() - leader.seenAt > 10000 || party.commands[name]) return;
      const destination = { map: leader.map, x: Number(leader.x), y: Number(leader.y) };
      party.characterLocations[name] = destination;
      party.commands[name] = { id: party.nextCommandId++, type: "return-leader", purpose: "farming-follow" };
    }
}
