import type { Role } from "./types.ts";
export const defaultRole: Role = {
  name: "adventurer",
  combat: true,
  chooseTarget: function () {
    const scatterBreak = sharedRoutine.getScatterBreakTarget();
    if (sharedRoutine.hasScatterBreakTarget()) {
      const currentTarget = sharedRoutine.getEngagedTarget();
      if (currentTarget) return currentTarget;
      if (scatterBreak) return scatterBreak;
    }
    const eventTarget = sharedRoutine.getEventTarget();
    if (eventTarget) return eventTarget;
    if (sharedRoutine.getFarmingMode() === "scatter") return sharedRoutine.getScatterTarget();
    return sharedRoutine.shouldFollowLeader()
      ? sharedRoutine.getLeaderTarget() || sharedRoutine.getEngagedTarget()
      : sharedRoutine.getPreferredTarget();
  },
  beforeTarget: async function () {
    return false;
  },
  beforeAttack: async function () {
    return false;
  },
  usePotion: async function () {
    return false;
  },
};
