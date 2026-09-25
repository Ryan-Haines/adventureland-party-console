import { createHuntResume } from "./hunt-resume.ts";
import { createEventReturns } from "./returns.ts";
import { createHuntReturnHandoff, type HuntReturnState } from "./hunt-return.ts";
import type {
  EventReturnPorts,
  EventReturnState,
  EventRecovery,
  ReturnLocation,
  CommandView,
} from "./return-types.ts";

interface ReturnCommand extends CommandView {
  id?: number;
  event?: string;
  checkpoint?: ReturnLocation | null;
}
interface CoordinatorReturnState extends Omit<HuntReturnState, "activeConvoy"> {
  eventReturn: EventReturnState["current"];
  eventReturnLast: EventReturnState["last"];
  deferredEventReturns: EventReturnState["deferred"];
  nextCommandId: number;
  merchantCharacter: string | null;
  statuses: ReturnType<EventReturnPorts["statuses"]>;
  commands: Record<string, ReturnCommand | undefined>;
  abtestingStrategy: unknown;
  activeConvoy: (NonNullable<ReturnType<EventReturnPorts["convoy"]>> & NonNullable<HuntReturnState["activeConvoy"]>) | null;
  townCycle: unknown;
  anniversary: { eventCycle?: ReturnType<EventReturnPorts["anniversary"]> };
  eventSessions: Record<string, { event: string }>;
}
interface ReturnCompositionPorts {
  now: () => number;
  activeNames: () => string[];
  enabled: EventReturnPorts["enabled"];
  checkpoint: EventReturnPorts["checkpoint"];
  cancelConvoy: () => void;
  startConvoy: (
    destination: ReturnLocation,
    label: string,
    names: string[],
    purpose: string,
  ) => boolean;
  anniversaryParticipants: () => string[];
  persist: () => void;
  navigation: {
    capture: EventReturnPorts["capture"];
    dispatch: (owner: EventRecovery, purpose: string, names: string[]) => boolean;
    reconcile: (owner: EventRecovery, purpose: string) => boolean;
    finish: EventReturnPorts["finish"];
  };
}

/** Keep recovery state attached to the coordinator while centralizing event-return command and navigation wiring. */
export function createCoordinatorEventReturns(
  state: CoordinatorReturnState,
  ports: ReturnCompositionPorts,
) {
  const huntReturn = createHuntReturnHandoff(state, {
    now: ports.now, capture: ports.navigation.capture, cancelConvoy: ports.cancelConvoy,
  });
  const huntResume = createHuntResume(state, {
    now: ports.now, capture: ports.navigation.capture, cancelConvoy: ports.cancelConvoy,
  });
  return createEventReturns(
    {
      get current() {
        return state.eventReturn;
      },
      set current(value) {
        state.eventReturn = value;
      },
      get last() {
        return state.eventReturnLast;
      },
      set last(value) {
        state.eventReturnLast = value;
      },
      get deferred() {
        return state.deferredEventReturns;
      },
    },
    {
      now: ports.now,
      nextCommandId: () => state.nextCommandId++,
      activeNames: ports.activeNames,
      merchant: () => state.merchantCharacter,
      enabled: (name, event) => ports.enabled(name, event),
      statuses: () => state.statuses,
      commands: () => state.commands,
      clearCommand: (name) => {
        delete state.commands[name];
      },
      town: (name, recovery) => {
        if (huntReturn.preservesTravel(name)) return;
        state.commands[name] = {
          id: state.nextCommandId++,
          type: "event-return-town",
          cycleId: recovery.cycleId,
          event: recovery.event,
          checkpoint: recovery.checkpoint,
        };
      },
      huntHandoffPending: huntResume.pending,
      handoffToHunt: recovery => huntReturn.complete(recovery) || huntResume.complete(recovery),
      checkpoint: () => ports.checkpoint(),
      capture: (names) => ports.navigation.capture(names),
      clearABStrategy: () => {
        state.abtestingStrategy = null;
      },
      convoy: () => state.activeConvoy,
      cancelConvoy: ports.cancelConvoy,
      startExit: (names) =>
        ports.startConvoy({ map: "main", x: 0, y: 0 }, "Mainland exit", names, "franky-exit"),
      townBusy: () => !!state.townCycle,
      anniversary: () => state.anniversary.eventCycle,
      anniversaryParticipants: ports.anniversaryParticipants,
      sessions: () => Object.values(state.eventSessions),
      dispatch: (owner, names) => ports.navigation.dispatch(owner, "event-return", names),
      reconcile: (owner) => ports.navigation.reconcile(owner, "event-return"),
      finish: (owner, reason) => ports.navigation.finish(owner, reason),
      persist: ports.persist,
    },
  );
}
