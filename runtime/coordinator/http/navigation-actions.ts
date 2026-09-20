import { createEventAcknowledgementRoutes } from "./event-acknowledgements.ts";
import { createConvoyEngagementRoutes } from "./convoy-engagement.ts";
import { createFarmingReturnRoute } from "./farming-return.ts";
import { createConvoyAcknowledgementRoutes } from "./convoy-acknowledgements.ts";
import type { NavigationRoutePorts } from "../navigation/route-types.ts";

type NavigationState = Parameters<typeof createEventAcknowledgementRoutes>[0] &
  Parameters<typeof createConvoyEngagementRoutes>[0] &
  Parameters<typeof createConvoyAcknowledgementRoutes>[0] & { nextCommandId: number };
type AcknowledgementPorts = Parameters<typeof createConvoyAcknowledgementRoutes>[1];
type NavigationPorts = Omit<Parameters<typeof createEventAcknowledgementRoutes>[1], "nextCommand"> &
  Omit<NavigationRoutePorts, "huntOwns" | "engage" | "acceptArrival"> &
  Omit<AcknowledgementPorts, "nextCommand" | "valid" | "hold"> & {
    huntOwns: (hunt: NavigationState["monsterHunt"]) => boolean;
    engage: (
      state: NavigationState,
      ...args: Parameters<NavigationRoutePorts["engage"]>
    ) => boolean;
    acceptArrival: (
      hunt: NavigationState["monsterHunt"],
      ...args: Parameters<NavigationRoutePorts["acceptArrival"]>
    ) => boolean;
    valid: (state: NavigationState, ...args: Parameters<AcknowledgementPorts["valid"]>) => boolean;
    hold: (state: NavigationState, ...args: Parameters<AcknowledgementPorts["hold"]>) => void;
  };

/** Movement reports share current Hunt ownership and command allocation across event and farming returns. */
export function createCoordinatorNavigationActions(state: NavigationState, ports: NavigationPorts) {
  const shared = { ...ports, nextCommand: () => state.nextCommandId++ };
  const events = createEventAcknowledgementRoutes(state, shared);
  const travel = {
    ...shared,
    huntOwns: () => ports.huntOwns(state.monsterHunt),
    engage: (...args: Parameters<NavigationRoutePorts["engage"]>) => ports.engage(state, ...args),
    acceptArrival: (...args: Parameters<NavigationRoutePorts["acceptArrival"]>) =>
      ports.acceptArrival(state.monsterHunt, ...args),
  };
  const engagement = createConvoyEngagementRoutes(state, travel);
  const farmingReturn = createFarmingReturnRoute(state, travel);
  const acknowledgements = createConvoyAcknowledgementRoutes(state, {
    ...shared,
    valid: (body) => ports.valid(state, body),
    hold: (message, code) => ports.hold(state, message, code),
  });
  return { events, engagement, farmingReturn, acknowledgements };
}
