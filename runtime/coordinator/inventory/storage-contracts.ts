import type { BankboiInventory } from "./bankboi-completion.ts";
import type { StorageTransaction } from "./bankboi-service.ts";
import type { WithdrawalRequest } from "./exchange-storage.ts";
import type { InventoryEntry } from "../contracts/item.ts";
import type { CargoRequest } from "./reserved-cargo.ts";

export interface BankSnapshot {
  [field: string]: unknown;
  seenAt?: number;
  gold?: number;
  packs?: Record<string, (InventoryEntry | null)[] | undefined>;
}

/** Persisted BankBoi inventory may contain empty slots, just like character reports. */
export interface StoredBankboi extends BankboiInventory {
  [field: string]: unknown;
}

export interface StoredBankRequest extends CargoRequest {
  bankboi?: string;
  [field: string]: unknown;
}

export interface SavedBankState {
  bankSnapshot?: BankSnapshot | null;
  bankbois?: Record<string, StoredBankboi> | null;
  bankboiQueue?: StoredBankRequest[] | null;
  bankboiTransaction?: StorageTransaction<unknown> | null;
  bankboiReservedMigrated?: unknown;
  withdrawals?: Record<string, WithdrawalRequest[]> | null;
}
