import type { Role } from "../roles/types.ts";
export const role: Partial<Role> = {
  name: "merchant",
  combat: true,
  // Use current equipment for events; never acquire ordinary farming targets.
  chooseTarget: () => sharedRoutine.getEventTarget(),
};
