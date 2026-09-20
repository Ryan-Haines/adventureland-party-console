import type { Role } from "../roles/types.ts";
export const role: Partial<Role> = { name: "rogue", combat: true,
  beforeTarget: () => sharedRoutine.skillSupport?.() ?? Promise.resolve(false),
  beforeAttack: target => sharedRoutine.skillOffense?.(target) ?? Promise.resolve(false),
};
