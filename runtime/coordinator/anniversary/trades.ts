import { anniversarySlices as slices, sliceQuantity } from "./contracts.ts";
import type { InventoryEntry } from "../contracts/item.ts";
import { requestObject } from "../http/contracts.ts";

/** Replace the merchant's stale heartbeat counts with the inventory seen during the trade. */
export function currentTradeCounts(
  counts: Record<string, number>,
  reported: unknown,
  items: (InventoryEntry | null)[] | undefined,
): Record<string, number> {
  const result = { ...counts },
    incoming = requestObject(reported);
  for (const name of slices) {
    const quantity = Number(incoming[name]);
    if (Number.isFinite(quantity) && quantity >= 0)
      result[name] = Math.max(
        0,
        (result[name] || 0) - sliceQuantity(items, name) + Math.floor(quantity),
      );
  }
  return result;
}

/** Reserve complete sets before offering a native slice, and keep flavor counts balanced. */
export function canSwapSlice(
  native: string | null,
  incoming: string,
  counts: Record<string, number>,
): boolean {
  if (!native) return false;
  const nativeCount = counts[native] || 0,
    flavorCount = counts[incoming] || 0;
  const total = slices.reduce((sum, name) => sum + (counts[name] || 0), 0);
  const target = Math.floor(total / slices.length);
  const sets = Math.min(...slices.map((name) => counts[name] || 0));
  return nativeCount - sets >= 1 && flavorCount <= target && flavorCount <= nativeCount - 1;
}

export interface SliceTrade {
  key: string;
  identity: string;
  owner: unknown;
  at: number;
  sender: string;
  incoming: string;
  outgoing: string;
  state: string;
  map: unknown;
  x: number;
  y: number;
  server: unknown;
  completedAt?: number;
}

export function tradeCompletionMessage(trade: SliceTrade): string {
  if (trade.state === "completed") return "Completed slice swap with " + trade.sender;
  if (trade.state === "returned")
    return "Returned " + trade.sender + "'s slice after an incomplete swap";
  return "Return owed to " + trade.sender + "; GoldMajesty will retry";
}
