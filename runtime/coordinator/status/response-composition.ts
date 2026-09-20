import { createHeartbeatResponse } from "./response.ts";
import type { HeartbeatState, HeartbeatResponsePorts } from "./response-types.ts";
import type { resolve } from "../../../dashboard/lib/farming-zones.ts";

interface ResponseState extends HeartbeatState {
  bankSnapshot: unknown;
}
type ComposedPorts =
  | "navigationRevision"
  | "convoySignal"
  | "partyLocation"
  | "navigationIntent"
  | "huntTurnInOwnsTravel"
  | "bankStackHomes"
  | "selectedEvents";
type ResponsePorts = Omit<HeartbeatResponsePorts, ComposedPorts> & {
  intent: (name: string) => { revision: number };
  convoySignal: (state: ResponseState, name: string) => unknown;
  waypoint: (name: string) => Parameters<typeof resolve>[2];
  resolveArea: typeof resolve;
  huntOwns: (hunt: ResponseState["monsterHunt"]) => boolean;
  stackHomes: (bank: unknown, bankbois: ResponseState["bankbois"]) => unknown;
  selectedEvents: (state: ResponseState, name: string) => unknown;
};

/** Heartbeats project the current farming authority, navigation intent and storage ownership. */
export function createCoordinatorHeartbeatResponse(state: ResponseState, ports: ResponsePorts) {
  return createHeartbeatResponse(state, {
    ...ports,
    navigationRevision: (name) => ports.intent(name).revision,
    convoySignal: (name) => ports.convoySignal(state, name),
    partyLocation: (name) =>
      ports.resolveArea(
        state.monsterChoices || [],
        state.farmingPolicy === "hunt" && state.monsterHunt?.target
          ? [state.monsterHunt.target]
          : state.monsterFocus || [],
        ports.waypoint(name),
      ),
    navigationIntent: (name) => ports.intent(name),
    huntTurnInOwnsTravel: () => ports.huntOwns(state.monsterHunt),
    bankStackHomes: () => ports.stackHomes(state.bankSnapshot, state.bankbois),
    selectedEvents: (name) => ports.selectedEvents(state, name),
  });
}
