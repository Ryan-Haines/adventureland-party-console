import { createMerchantRecovery } from "./recovery.ts";

type RecoveryState = Parameters<typeof createMerchantRecovery>[0];
type RecoveryPorts = Parameters<typeof createMerchantRecovery>[1];
interface CoordinatorState {
  merchantCurrent: RecoveryState["current"];
  merchantQueue: RecoveryState["queue"];
  nextCommandId: number;
}
type CompositionPorts = Omit<RecoveryPorts, "nextCommand" | "clearCommand"> & {
  clearOwnedCommand: (name: string, matches: (command: { jobId?: string }) => boolean) => unknown;
};

/** Recovery may clear only the command belonging to the job it completes or replaces. */
export function createCoordinatorMerchantRecovery(
  state: CoordinatorState,
  ports: CompositionPorts,
) {
  return createMerchantRecovery(
    {
      get current() {
        return state.merchantCurrent;
      },
      set current(value) {
        state.merchantCurrent = value;
      },
      get queue() {
        return state.merchantQueue;
      },
    },
    {
      ...ports,
      nextCommand: () => state.nextCommandId++,
      clearCommand: (name, jobId) => {
        ports.clearOwnedCommand(name, (command) => command.jobId === jobId);
      },
    },
  );
}
