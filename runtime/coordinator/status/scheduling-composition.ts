import { createMerchantScheduling } from "./merchant-scheduling.ts";

type SchedulingState = Parameters<typeof createMerchantScheduling>[0];
type SchedulingPorts = Parameters<typeof createMerchantScheduling>[1];
interface CoordinatorState extends SchedulingState {
  statuses: Record<
    string,
    (NonNullable<SchedulingState["statuses"][string]> & { gold: number }) | undefined
  >;
}
type CompositionPorts = Omit<SchedulingPorts, "bankboi" | "clearCommand" | "activeGold"> & {
  startStorage: () => Promise<unknown>;
  logStorageError: (message: string, level: string, details: string) => void;
  clearOwnedCommand: (name: string, matches: (command: { type: string }) => boolean) => unknown;
  activeNames: () => string[];
};

/** Adapt heartbeat scheduling to shared storage ownership and current party balances. */
export function createCoordinatorMerchantScheduling(
  state: CoordinatorState,
  ports: CompositionPorts,
) {
  return createMerchantScheduling(state, {
    ...ports,
    bankboi: () => {
      ports
        .startStorage()
        .catch((error: Error) =>
          ports.logStorageError(
            "Bankboi scheduler failed",
            "error",
            String(error.message || error),
          ),
        );
    },
    clearCommand: (name) => {
      ports.clearOwnedCommand(name, (command) => command.type === "bank");
    },
    activeGold: () =>
      ports.activeNames().map((name) => ({ name, gold: state.statuses[name]!.gold })),
  });
}
