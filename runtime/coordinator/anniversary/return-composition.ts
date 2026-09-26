import { handoffAnniversaryToHunt } from './hunt-handoff.ts';
import { createAnniversaryReturns } from "./returns.ts";
import type { AnniversaryRecoveryPorts, AnniversaryRecoveryState } from "./return-contracts.ts";
import { ownsWorkflowWalk } from "../events/walk-ownership.ts";
import type { ReturnConvoy } from "../events/return-types.ts";

type RecoveryPorts = AnniversaryRecoveryPorts;
interface CoordinatorState {
  anniversary: AnniversaryRecoveryState;
  merchantCharacter: string | null;
  deferredEventReturns: Record<string, Parameters<RecoveryPorts["defer"]>[1]>;
  activeConvoy: ReturnConvoy | null;
  townCycle: unknown;
}
type CompositionPorts = Pick<
  RecoveryPorts,
  "now" | "participants" | "activeNames" | "log" | "persist" | "schedule"
> & {
  cancelConvoy(): void;
  navigation: Pick<RecoveryPorts, "intent" | "location" | "capture"> & {
    dispatch: (
      cycle: Parameters<RecoveryPorts["dispatch"]>[0],
      purpose: string,
      names: string[],
    ) => boolean;
    reconcile: (cycle: Parameters<RecoveryPorts["reconcile"]>[0], purpose: string) => unknown;
    finish?: (cycle: Parameters<RecoveryPorts["dispatch"]>[0], reason: string) => void;
  };
};

/** Preserve anniversary recovery ownership while routing travel through the shared navigation service. */
export function createCoordinatorAnniversaryReturns(
  state: CoordinatorState,
  ports: CompositionPorts,
) {
  return createAnniversaryReturns(state.anniversary, {
    now: () => ports.now(),
    merchant: () => state.merchantCharacter,
    participants: () => ports.participants(),
    activeNames: () => ports.activeNames(),
    intent: (name) => ports.navigation.intent(name),
    location: (cycle, name) => ports.navigation.location(cycle, name),
    defer: (name, recovery) => {
      state.deferredEventReturns[name] = recovery;
    },
    log: (message, level) => ports.log(message, level),
    persist: () => ports.persist(),
    convoyBusy: () => !!state.activeConvoy,
    releaseFarmingWalk: cycle => {
      const convoy = state.activeConvoy;
      if (!convoy || !["farm-recovery", "anniversary-staging"].includes(convoy.walkingActivity || "")) return;
      if (convoy.participants.some(name => ports.navigation.intent(name).cancelled)) return;
      if (!ownsWorkflowWalk(convoy, cycle, ports.navigation.capture(convoy.participants))) return;
      ports.cancelConvoy();
      ports.persist();
    },
    townBusy: () => !!state.townCycle,
    dispatch: (cycle, names) => handoffAnniversaryToHunt(state,cycle,ports) || ports.navigation.dispatch(cycle, "anniversary-return", names),
    capture: (names) => ports.navigation.capture(names),
    reconcile: (cycle) => handoffAnniversaryToHunt(state,cycle,ports) || ports.navigation.reconcile(cycle, "anniversary-return"),
    schedule: () => ports.schedule(),
  });
}
