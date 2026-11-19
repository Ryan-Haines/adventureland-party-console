import type { Role } from "../role-types.ts";
// Absorb and the support casts are the turns owner's requests; the heal and the
// potions are the survival owner's needs. The Curse is one option of the
// damage ranking (skills/ranking.ts, TRN-Q-DPS), scored by the damage its `cursed` condition adds.
export const role: Partial<Role> = { name: "priest", combat: true };
