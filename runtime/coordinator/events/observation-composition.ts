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
      capture: (names) => ports.navigation.capture(names || ports.activeNames()),
      location: (recovery, name) => ports.navigation.location(recovery, name),
      intent: (name) => ports.navigation.intent(name),
      hasCommand: (name) => !!state.commands[name],
      retireDeferredWalk: (name, cycleId) => {
        const convoy = state.activeConvoy;
        if (state.deferredEventReturns[name]?.cycleId !== cycleId) return;
        if (!convoy || !convoy.participants.includes(name) ||
            !(ownsDeferredWalk(convoy, cycleId) || ownsActiveReturn(convoy, cycleId))) return;
        ports.cancelConvoy();
      },
      retireDeferredCommand: (name, cycleId) => {
        const command = state.commands[name];
        if (command?.cycleId === cycleId &&
            ['event-return-town', 'event-resume-travel'].includes(String(command.type))) delete state.commands[name];
      },
      command: (name, command) => {
        state.commands[name] = command;
      },
      nextCommand: () => state.nextCommandId++,
    },
  );

  function ownsDeferredWalk(convoy: ReturnConvoy, cycleId: string): boolean {
    if (convoy.nonPreemptible || convoy.purpose !== "shared-walk-return" ||
        convoy.walkingActivity !== "event-return" || !convoy.participants.length) return false;
    return convoy.participants.every(name => {
      const parent = convoy.walkingParents?.[name], deferred = state.deferredEventReturns[name];
      return !!parent && parent.command?.cycleId === cycleId &&
        (!deferred || deferred.cycleId === cycleId && parent.revision === deferred.navigationRevision) &&
        parent.revision === ports.navigation.intent(name).revision && ports.activeNames().includes(name) &&
        deferredCommandOwned(convoy, name, cycleId);
    });
  }
  function ownsActiveReturn(convoy: ReturnConvoy, cycleId: string): boolean {
    // Checkpoint convoys carry ownership in returnRoutes, rather than the
    // walking parents used by a deferred command's shared return walk.
    const recovery = state.eventReturn;
    if (!recovery || recovery.cycleId !== cycleId || convoy.nonPreemptible ||
        convoy.purpose !== 'event-return' || !convoy.participants.length) return false;
    return convoy.participants.every(name => {
      const route = recovery.returnRoutes?.[name];
      return recovery.participants.includes(name) && route?.convoyId === convoy.id &&
        route.revision === ports.navigation.intent(name).revision && ports.activeNames().includes(name) &&
        deferredCommandOwned(convoy, name, cycleId);
    });
  }
  function deferredCommandOwned(convoy: ReturnConvoy, name: string, cycleId: string): boolean {
    const command = state.commands[name];
    return !command || command.convoyId === convoy.id || command.cycleId === cycleId &&
      ['event-return-town', 'event-resume-travel'].includes(String(command.type));
  }
}
