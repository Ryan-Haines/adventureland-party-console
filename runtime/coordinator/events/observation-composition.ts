import { createEventObservations } from "./observations.ts";
import { ownsWorkflowWalk } from "./walk-ownership.ts";
import type { ReturnConvoy } from "./return-types.ts";

type ObservationState = Parameters<typeof createEventObservations>[0];
type ObservationPorts = Parameters<typeof createEventObservations>[1];
interface CoordinatorState {
  activeConvoy?: ReturnConvoy | null;
  eventSessions: ObservationState["sessions"];
  eventReturn: ObservationState["current"];
  deferredEventReturns: ObservationState["deferred"];
  anniversary: ObservationState["anniversary"];
  merchantCharacter: string | null;
  statuses: ReturnType<ObservationPorts["statuses"]>;
  commands: Record<string, Record<string, unknown> | undefined>;
  nextCommandId: number;
}
type CompositionPorts = Pick<
  ObservationPorts,
  | "now"
  | "activeNames"
  | "enabled"
  | "checkpoint"
  | "persist"
  | "log"
  | "goobrawlStillFighting"
  | "begin"
  | "finishIfReady"
  | "releaseAnniversary"
> & {
  cancelConvoy(): void;
  navigation: Pick<ObservationPorts, "capture" | "location" | "intent">;
};

/** Live event reports and deferred reconnections share the coordinator's current command/recovery state. */
export function createCoordinatorEventObservations(
  state: CoordinatorState,
  ports: CompositionPorts,
) {
  return createEventObservations(
    {
      get sessions() {
        return state.eventSessions;
      },
      get current() {
        return state.eventReturn;
      },
      get deferred() {
        return state.deferredEventReturns;
      },
      get anniversary() {
        return state.anniversary;
      },
    },
    {
      ...ports,
      releaseAnniversary: (cycle) => {
        const convoy = state.activeConvoy;
        if (convoy?.walkingActivity === "anniversary-staging" &&
            ownsWorkflowWalk(convoy, cycle, ports.navigation.capture())) {
          ports.cancelConvoy();
          ports.persist();
        }
        ports.releaseAnniversary?.(cycle);
      },
      merchant: () => state.merchantCharacter,
      statuses: () => state.statuses,
      capture: () => ports.navigation.capture(),
      location: (recovery, name) => ports.navigation.location(recovery, name),
      intent: (name) => ports.navigation.intent(name),
      hasCommand: (name) => !!state.commands[name],
      command: (name, command) => {
        state.commands[name] = command;
      },
      nextCommand: () => state.nextCommandId++,
    },
  );
}
