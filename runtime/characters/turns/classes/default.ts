import type { Role } from "../role-types.ts";
// The class role every class starts from: no spend before its attack. The
// target choices are targeting's (E03-t3, runtime/characters/targeting/selection.ts `classTarget`).
export const defaultRole: Role = {
  name: "adventurer",
  combat: true,
  beforeAttack: async function () {
    return false;
  },
};
