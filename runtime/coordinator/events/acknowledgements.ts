import type { ReturnLocation } from "./return-types.ts";
import { endHuntEventTrip, type HuntEventTrips } from "./hunt-trip.ts";

export interface ReturnCommand {
  id: number;
  type: string;
  cycleId?: string;
  event?: string;
  location?: ReturnLocation;
  navigationRevision?: number;
  label?: string;
  convoyHandoff?: unknown;
}
export interface DeferredReturn {
  cycleId: string;
  navigationRevision?: number;
  checkpoint?: ReturnLocation | null;
  event?: string;
  phase?: string;
}
export interface ReturnIntent {
  revision: number;
  cancelled?: boolean;
}
export interface AcknowledgementState extends HuntEventTrips {
  commands: Record<string, ReturnCommand | undefined>;
  deferredEventReturns: Record<string, DeferredReturn | undefined>;
}
interface AcknowledgementPorts {
  intent(name: string): ReturnIntent;
  nextCommand(): number;
}

/** A deferred Town acknowledgement can only resume the still-authorized checkpoint. */
export function createDeferredAcknowledgements(
  state: AcknowledgementState,
  ports: AcknowledgementPorts,
) {
  function town(name: string, deferred: DeferredReturn): void {
    const intent = ports.intent(name);
    if (intent.cancelled || Number(deferred.navigationRevision || 0) !== intent.revision)
      deferred.checkpoint = null;
    if (!deferred.checkpoint) {
      endHuntEventTrip(state, name, deferred.event, Date.now());
      delete state.deferredEventReturns[name];
      if (state.commands[name]?.cycleId === deferred.cycleId) delete state.commands[name];
    } else
      state.commands[name] = {
        id: ports.nextCommand(),
        type: "event-resume-travel",
        cycleId: deferred.cycleId,
        event: deferred.event,
        location: deferred.checkpoint,
        navigationRevision: ports.intent(name).revision,
        label: "the saved pre-event checkpoint",
      };
    deferred.phase = "returning-to-checkpoint";
  }
  function resumed(name: string, command: ReturnCommand): void {
    if (state.deferredEventReturns[name]?.cycleId === command.cycleId)
      endHuntEventTrip(state, name, command.event, Date.now());
    delete state.commands[name];
    if (state.deferredEventReturns[name]?.cycleId === command.cycleId)
      delete state.deferredEventReturns[name];
  }
  return { town, resumed };
}
