import { createBankboiStorageRoutes } from "./bankboi-storage.ts";
import { createBankUnlockRoute } from "./bank-unlock.ts";
import { createRestockRoute } from "./restock.ts";

type BankState<Transaction extends { bankboi: string }> = Parameters<
  typeof createBankboiStorageRoutes<Transaction>
>[0] &
  Parameters<typeof createBankUnlockRoute>[0] &
  Parameters<typeof createRestockRoute>[0] & { nextCommandId: number };
type StoragePorts<Transaction extends { bankboi: string }> = Parameters<
  typeof createBankboiStorageRoutes<Transaction>
>[1];
type BankPorts<Transaction extends { bankboi: string }> = Omit<
  StoragePorts<Transaction>,
  "signature" | "pending" | "persist"
> &
  Omit<Parameters<typeof createBankUnlockRoute>[1], "nextCommand"> &
  Parameters<typeof createRestockRoute>[1] & {
    persistBank: () => void;
    signature: (
      state: BankState<Transaction>,
      ...args: Parameters<StoragePorts<Transaction>["signature"]>
    ) => unknown;
    plan: (state: BankState<Transaction>) => unknown;
  };

/** Storage receipts persist bank snapshots; bank requests and restock settings use settings persistence. */
export function createCoordinatorBankActions<Transaction extends { bankboi: string }>(
  state: BankState<Transaction>,
  ports: BankPorts<Transaction>,
) {
  const storage = createBankboiStorageRoutes(state, {
    ...ports,
    signature: (entry) => ports.signature(state, entry),
    pending: () => !!ports.plan(state),
    persist: () => ports.persistBank(),
    persistJobs: () => ports.persist(),
  });
  const unlock = createBankUnlockRoute(state, {
    ...ports,
    nextCommand: () => state.nextCommandId++,
  });
  const restock = createRestockRoute(state, ports);
  return { storage, unlock, restock };
}
