import type { Role } from "../roles/types.ts";
export const role: Partial<Role> = { name: "ranger", combat: true,
  beforeAttack: target => sharedRoutine.skillOffense?.(target) ?? Promise.resolve(false),
};
