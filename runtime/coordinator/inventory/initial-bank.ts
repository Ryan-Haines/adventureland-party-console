import type { SavedBankState } from "./storage-contracts.ts";

/** Restore durable storage work while refreshing the current bank observer and vault catalog. */
export function initialBankState<Vaults>(saved: SavedBankState, vaults: () => Vaults) {
  return {
    bankSnapshot: saved.bankSnapshot || null,
    bankbois: saved.bankbois || {},
    bankboiQueue: Array.isArray(saved.bankboiQueue) ? saved.bankboiQueue : [],
    bankboiTransaction: saved.bankboiTransaction || null,
    bankboiReservedMigrated: saved.bankboiReservedMigrated === true,
    bankVaults: vaults(),
    withdrawals: saved.withdrawals || {},
    bankObserver: null as string | null,
  };
}
