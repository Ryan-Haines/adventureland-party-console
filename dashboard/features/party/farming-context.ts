import type { PartyState } from "./party-state";
import { scopeOwner } from "../../../runtime/tasks/api.ts";
import { slotPair } from "../../../runtime/hunting/api.ts";

export function farmingContext(state: PartyState, name: string) {
  // The tasks owner's scope owner: the merchant farms in its own scope even with a saved follower mark.
  const owner = scopeOwner(state, name), followingLeader = owner !== name ? owner : undefined;
  const personal = state.farmingProfiles?.[name];
  const effective = state.farmingProfiles?.[owner], live = state.farmingLive?.[owner];
  const legacy = owner === state.leader;
  // The hunting owner's two slot fields, resolved by its slotPair: the character's own for the pressed
  // buttons and the summary, the scope's for its status. The config's single `farmingPolicy` is
  // the apps' interface v1.
  const own = slotPair(personal, name === state.leader ? state : undefined), scope = slotPair(effective, legacy ? state : undefined);
  return {
    farmArea: live?.farmAreaState || (legacy ? state.farmAreaState : undefined),
    owner,
    followingLeader,
    combatMode: own.combatMode,
    targetMode: own.targetMode,
    effectiveCombat: scope.combatMode,
    effectiveTarget: scope.targetMode,
    blacklist: effective?.huntBlacklist || (legacy ? state.huntBlacklist : undefined) || {},
    settings: effective?.huntSettings || (legacy ? state.huntSettings : undefined),
    hunt: live?.monsterHunt ?? (legacy ? state.monsterHunt : null),
  };
}
