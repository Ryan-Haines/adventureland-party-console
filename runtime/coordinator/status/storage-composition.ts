import { createCoordinatorBankboiObservation } from "./bankboi-composition.ts";
import { createMerchantObservation } from "./merchant-observation.ts";
import type { consumeBankReport } from "./bank.ts";

type BankState = Parameters<typeof consumeBankReport>[1];
type BankPorts = Parameters<typeof consumeBankReport>[2];
type MerchantPorts = Parameters<typeof createMerchantObservation>[1];
type StorageState = Parameters<typeof createCoordinatorBankboiObservation>[0] & {
  bankbois: Record<string, import("../inventory/bankboi-completion.ts").BankboiInventory>;
  bankSnapshot: BankState["snapshot"];
  bankObserver: BankState["observer"];
  standListings: Parameters<typeof createMerchantObservation>[0]["listings"];
};
type StoragePorts = {
  now: BankPorts["now"];
  adoptReservedCargo: BankPorts["adoptReservedCargo"];
  persistBank: BankPorts["persist"];
  persist: MerchantPorts["persist"];
  log: MerchantPorts["log"];
  publish: MerchantPorts["publish"];
  stackHomes: (
    bank: StorageState["bankSnapshot"],
    bankbois: StorageState["bankbois"],
  ) => ReturnType<Parameters<typeof createCoordinatorBankboiObservation>[1]["stackHomes"]>;
};

/** Share live storage views while keeping bank persistence separate from merchant settings. */
export function createCoordinatorStorageObservations(state: StorageState, ports: StoragePorts) {
  const bankboi = createCoordinatorBankboiObservation(state, {
    now: () => ports.now(),
    stackHomes: () => ports.stackHomes(state.bankSnapshot, state.bankbois),
    persist: () => ports.persistBank(),
  });
  const merchant = createMerchantObservation(
    {
      get listings() {
        return state.standListings;
      },
    },
    {
      log: (message, level, details) => ports.log(message, level, details),
      persist: () => ports.persist(),
      publish: () => ports.publish(),
    },
  );
  const bankState: BankState = {
    get snapshot() {
      return state.bankSnapshot;
    },
    set snapshot(value) {
      state.bankSnapshot = value;
    },
    get observer() {
      return state.bankObserver;
    },
    set observer(value) {
      state.bankObserver = value;
    },
  };
  const bankPorts: BankPorts = {
    now: () => ports.now(),
    adoptReservedCargo: () => ports.adoptReservedCargo(),
    persist: () => ports.persistBank(),
  };
  return { bankboi, merchant, bankState, bankPorts };
}
