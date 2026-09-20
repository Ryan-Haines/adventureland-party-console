import type { InventoryEntry } from "../contracts/item.ts";
import type { WithdrawalRequest } from "../inventory/exchange-storage.ts";
import type { StorageTransaction } from "../inventory/bankboi-service.ts";
import type { MerchantCommand } from "../merchant/work.ts";

interface StorageWorker {
  state?: string;
  error?: unknown;
  retryAt?: number;
  items?: (InventoryEntry | null)[];
  slots?: unknown;
  gold?: number;
  seenAt?: number;
}
interface StorageReport {
  name: string;
  items?: (InventoryEntry | null)[];
  slots?: unknown;
  gold?: number;
}
interface StorageRequest {
  id: string;
  [field: string]: unknown;
}
interface StorageState {
  workers: Record<string, StorageWorker>;
  transaction: StorageTransaction<unknown> | null;
  requests: StorageRequest[];
}
interface StoragePorts {
  now(): number;
  nextCommand(): number;
  hasCommand(name: string): boolean;
  command(name: string, command: MerchantCommand): void;
  withdrawals(): WithdrawalRequest[];
  stackHomes(): unknown;
  persist(): void;
}

function recordInventory(worker: StorageWorker, report: StorageReport, now: number): void {
  worker.items = Array.isArray(report.items) ? report.items : worker.items || [];
  worker.slots = report.slots || {};
  worker.gold = Number(report.gold) || 0;
  worker.seenAt = now;
}

/** Dispatches the storage transaction once the replacement worker first reports ready. */
export function createBankboiObservation(state: StorageState, ports: StoragePorts) {
  function dispatch(name: string): void {
    const transaction = state.transaction;
    if (
      !transaction ||
      transaction.bankboi !== name ||
      transaction.phase !== "waiting-for-bankboi" ||
      ports.hasCommand(name)
    )
      return;
    const requests = state.requests.filter((request) =>
      transaction.requestIds.includes(request.id),
    );
    transaction.commandId = ports.nextCommand();
    const worker = state.workers[name];
    if (worker) { worker.state = "working"; worker.error = null; worker.retryAt = 0; }
    ports.command(name, {
      id: transaction.commandId,
      type: "bankboi-service",
      provision: transaction.mode === "provision",
      requests,
      retrievals: transaction.retrievals || [],
      unload: true,
      protectedItems: ports
        .withdrawals()
        .filter((request) => request.pack === "bankboi:" + name)
        .map((request) => request.item),
      reservedLocations: ports
        .withdrawals()
        .filter((request) => !String(request.pack).startsWith("bankboi:")),
      stackHomes: ports.stackHomes(),
    });
    transaction.phase = "processing";
    ports.persist();
  }

  function observe(report: StorageReport): void {
    const worker = state.workers[report.name];
    if (!worker) return;
    recordInventory(worker, report, ports.now());
    dispatch(report.name);
  }

  return { observe };
}
