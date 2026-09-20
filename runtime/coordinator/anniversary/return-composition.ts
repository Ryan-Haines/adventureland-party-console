import { createAnniversaryReturns } from "./returns.ts";
import type { AnniversaryRecoveryPorts, AnniversaryRecoveryState } from "./return-contracts.ts";

type RecoveryPorts = AnniversaryRecoveryPorts;
interface CoordinatorState {
  anniversary: AnniversaryRecoveryState;
  merchantCharacter: string | null;
  deferredEventReturns: Record<string, Parameters<RecoveryPorts["defer"]>[1]>;
  activeConvoy: unknown;
  townCycle: unknown;
}
type CompositionPorts = Pick<
  RecoveryPorts,
  "now" | "participants" | "activeNames" | "log" | "persist" | "schedule"
> & {
  navigation: Pick<RecoveryPorts, "intent" | "location" | "capture"> & {
    dispatch: (
      cycle: Parameters<RecoveryPorts["dispatch"]>[0],
      purpose: string,
      names: string[],
    ) => boolean;
    reconcile: (cycle: Parameters<RecoveryPorts["reconcile"]>[0], purpose: string) => unknown;
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
    townBusy: () => !!state.townCycle,
    dispatch: (cycle, names) => ports.navigation.dispatch(cycle, "anniversary-return", names),
    capture: (names) => ports.navigation.capture(names),
    reconcile: (cycle) => ports.navigation.reconcile(cycle, "anniversary-return"),
    schedule: () => ports.schedule(),
  });
}
