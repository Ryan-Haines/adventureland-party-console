import { createFocusRoute } from "./focus.ts";
import { createFormationRoute } from "./formation.ts";
import { createPartyActionRoutes } from "./party-actions.ts";

type PartyState = Parameters<typeof createFocusRoute>[0] &
  Parameters<typeof createFormationRoute>[0] &
  Parameters<typeof createPartyActionRoutes>[0] & { nextCommandId: number };
type PartyPorts = Parameters<typeof createFocusRoute>[1] &
  Omit<Parameters<typeof createFormationRoute>[1], "managed"> &
  Omit<Parameters<typeof createPartyActionRoutes>[1], "nextCommand">;

/** Party configuration shares navigation authorization and the live worker registry and command sequence. */
export function createCoordinatorPartyConfiguration(
  state: PartyState,
  workers: Record<string, unknown>,
  ports: PartyPorts,
) {
  const focus = createFocusRoute(state, ports);
  const formation = createFormationRoute(state, {
    ...ports,
    managed: (name) => Object.prototype.hasOwnProperty.call(workers, name),
  });
  const actions = createPartyActionRoutes(state, {
    ...ports,
    nextCommand: () => state.nextCommandId++,
  });
  return { focus, formation, actions };
}
