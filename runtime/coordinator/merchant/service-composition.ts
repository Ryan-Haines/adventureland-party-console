import { createCoordinatorMerchantDispatcher } from "./dispatch-composition.ts";
import { createCoordinatorMerchantIdle } from "./idle-composition.ts";

type DispatchPorts = Parameters<typeof createCoordinatorMerchantDispatcher>[1];
type IdlePorts = Parameters<typeof createCoordinatorMerchantIdle>[1];
type MerchantState = Parameters<typeof createCoordinatorMerchantDispatcher>[0] &
  Parameters<typeof createCoordinatorMerchantIdle>[0];
type MerchantPorts<State extends MerchantState> = Omit<
  DispatchPorts & IdlePorts,
  "idle" | "storagePlan" | "inventoryMerge"
> & {
  storagePlan: (state: State) => unknown;
  inventoryMerge: (
    state: State,
    status: Parameters<IdlePorts["inventoryMerge"]>[0],
  ) => ReturnType<IdlePorts["inventoryMerge"]>;
};

/** Dispatch and idle share storage, collection and anniversary gates and the same live command sequence. */
export function createCoordinatorMerchantServices<State extends MerchantState>(
  state: State,
  ports: MerchantPorts<State>,
) {
  const common = { ...ports, storagePlan: () => ports.storagePlan(state) };
  const dispatcher = createCoordinatorMerchantDispatcher(state, {
    ...common,
    idle: () => {
      idle.idle();
    },
  });
  const idle = createCoordinatorMerchantIdle(state, {
    ...common,
    inventoryMerge: (status) => ports.inventoryMerge(state, status),
  });
  return { dispatcher, idle };
}
