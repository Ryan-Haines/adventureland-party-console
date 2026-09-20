import type { Role } from "../roles/types.ts";
export const role: Partial<Role> = {
  name: "merchant",
  combat: false,
  // The server rejects attack() for this class with reason "merchant".
  // Merchants can equip weapons but cannot farm through basic combat.
};
