import type { InventoryEntry, Item } from "../contracts/item.ts";

import { protectedMerchantStorageStock } from "./merchant-storage-stock.ts";

/** Use the same unreserved whole stacks for planning and for the later native shortage. */
export function exchangeStorageWorkers(state: unknown) {
  const workers = new Map<string, InventoryEntry[]>();
  for (const entry of protectedMerchantStorageStock(state)) {
    if (!entry.craftLocation.startsWith("bankboi:") || !entry.item || entry.item.l || entry.item.b) continue;
    const name = entry.craftLocation.slice("bankboi:".length);
    const items = workers.get(name) || [];
    items.push(entry);
    workers.set(name, items);
  }
  return Array.from(workers, ([name, items]) => ({name, items}));
}

interface ExchangeLine {
  id: string;
  level?: number;
}
interface Shortage extends ExchangeLine {
  quantity: number;
}
interface StorageWorker {
  name: string;
  items?: readonly (InventoryEntry | null)[];
}
export interface WithdrawalRequest {
  [field: string]: unknown;
  pack: string;
  slot?: number;
  item?: Item | null;
}

function sameExchange(first: ExchangeLine, second: ExchangeLine): boolean {
  return first.id === second.id && (Number(first.level) || 0) === (Number(second.level) || 0);
}

function supplies(
  entry: InventoryEntry | null,
  shortage: Shortage,
): entry is InventoryEntry & { item: Item } {
  return (
    !!entry?.item && !entry.item.l && !entry.item.b &&
    entry.item.name === shortage.id &&
    (Number(entry.item.level) || 0) === (Number(shortage.level) || 0)
  );
}

export interface ExchangeStorageSource {
  pack: string;
  slot?: number;
  name: string;
  level: number;
}

export function matchesExchangeSource(source: ExchangeStorageSource, request: Partial<WithdrawalRequest>): boolean {
  return request.pack === source.pack && request.slot === source.slot && request.item?.name === source.name &&
    (Number(request.item.level) || 0) === source.level;
}

function requestStack(
  worker: StorageWorker,
  entry: InventoryEntry & { item: Item },
  requests: WithdrawalRequest[],
  sources: ExchangeStorageSource[],
): void {
  const pack = "bankboi:" + worker.name;
  sources.push({pack, slot: entry.slot, name: String(entry.item.name), level: Number(entry.item.level) || 0});
  if (!requests.some((request) => request.pack === pack && request.slot === entry.slot)) {
    requests.push({ pack, slot: entry.slot, item: entry.item });
  }
}

function collectShortage(
  shortage: Shortage,
  workers: readonly StorageWorker[],
  requests: WithdrawalRequest[],
  sources: ExchangeStorageSource[],
): boolean {
  let missing = Math.max(0, Number(shortage.quantity) || 0);
  let pending = false;
  for (const worker of workers) {
    for (const entry of worker.items || []) {
      if (missing <= 0) break;
      if (!supplies(entry, shortage)) continue;
      requestStack(worker, entry, requests, sources);
      missing -= Number(entry.item.q) || 1;
      pending = true;
    }
  }
  return pending;
}

/** Adds whole-stack retrievals in storage order; existing requests still count as pending supply. */
export function queueExchangeStorage(
  exchanges: readonly ExchangeLine[],
  shortages: readonly Shortage[],
  workers: readonly StorageWorker[],
  requests: WithdrawalRequest[],
  sources: ExchangeStorageSource[] = [],
): boolean {
  let pending = false;
  for (const shortage of shortages) {
    if (!exchanges.some((line) => sameExchange(line, shortage))) continue;
    if (collectShortage(shortage, workers, requests, sources)) pending = true;
  }
  return pending;
}
