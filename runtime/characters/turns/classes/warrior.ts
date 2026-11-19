import { mayTaunt, dashToward } from "./warrior-combat.ts";
import type { Role, Target } from "../role-types.ts";
import type { ClassTurn } from "../api.ts";
import { partyHooks } from "../../../hooks/index.ts";
// Taunt goes through the skill engine, whose booking keeps the queue evidence.
async function taunt(target: Target, turn: ClassTurn){
  return turn.casts.cast('taunt', target, 'survival');
}
export const role: Partial<Role> = {
  name: "warrior",
  combat: true,
  beforeAttack: async function (target, turn) {
    // Franky movement belongs solely to approach-and-hold, including scatter mode.
    if (turn.facts.franky()) return false;
    if (target.mtype === "porcupine" && mayTaunt(target, turn)) {
      await taunt(target, turn);
      return true;
    }
    // Scatter's Stomp is the ranking's (TRN-Q-DPS DPS-9): it scores the stun by the HP it saves, as any
    // skill whose condition stops its bearer, and the survival owner's emergency Stomp keeps the stun for survival.
    if (turn.facts.roleFarmingMode() === "scatter") return dashToward(target, turn);
    if (mayTaunt(target, turn)) await taunt(target, turn);
    if (!partyHooks().ask('targeting.allowed', target)) return false;
    return dashToward(target, turn);
  },
};
