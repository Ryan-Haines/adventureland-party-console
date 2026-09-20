import { createBankboiObservation } from "./bankboi.ts";

type ObservationState = Parameters<typeof createBankboiObservation>[0];
type ObservationPorts = Parameters<typeof createBankboiObservation>[1];
interface CoordinatorState {
  bankbois: ObservationState["workers"];
  bankboiTransaction: ObservationState["transaction"];
  bankboiQueue: ObservationState["requests"];
  nextCommandId: number;
  commands: Record<string, Parameters<ObservationPorts["command"]>[1] | undefined>;
  withdrawals: Record<string, ReturnType<ObservationPorts["withdrawals"]>>;
}
type CompositionPorts = Pick<ObservationPorts, "now" | "stackHomes" | "persist">;

/** Observe current BankBoi state and gather withdrawals in their existing character/slot order. */
export function createCoordinatorBankboiObservation(
  state: CoordinatorState,
  ports: CompositionPorts,
) {
  return createBankboiObservation(
    {
      get workers() {
        return state.bankbois;
      },
      get transaction() {
        return state.bankboiTransaction;
      },
      get requests() {
        return state.bankboiQueue;
      },
    },
    {
      now: () => ports.now(),
      nextCommand: () => state.nextCommandId++,
      hasCommand: (name) => !!state.commands[name],
      command: (name, command) => {
        state.commands[name] = command;
      },
      withdrawals: () => Object.values(state.withdrawals).flat(),
      stackHomes: () => ports.stackHomes(),
      persist: () => ports.persist(),
    },
  );
}
