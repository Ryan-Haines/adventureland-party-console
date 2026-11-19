import { scopeOwner } from "../../runtime/tasks/api.ts";

export interface RoutingFormation {
  leader?: string | null;
  followers?: Record<string, boolean>;
  merchantCharacter?: string | null;
}

export const FOLLOWER_ROUTE_MESSAGE = 'only leader can route to monster';

// The console offers a route only to a character that owns its farming scope (the tasks owner's
// `scopeOwner`); a follower walks with its leader.
export function canRouteToMonster(formation: RoutingFormation, character: string): boolean {
  return scopeOwner(formation, character) === character;
}
