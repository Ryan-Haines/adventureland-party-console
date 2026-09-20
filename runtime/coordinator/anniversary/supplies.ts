import { inventoryCounts } from "../../../dashboard/lib/account-inventory.ts";
import { anniversarySlices } from "./contracts.ts";
import { requestText } from "../http/contracts.ts";

type Inventory = NonNullable<Parameters<typeof inventoryCounts>[0]>[number];
interface Trade {
  identity?: string;
  owner?: unknown;
  sender?: unknown;
  state?: string;
}
interface SupplyState {
  statuses: Record<string, Inventory>;
  bankSnapshot: Parameters<typeof inventoryCounts>[1];
  bankbois?: Record<string, Inventory> | null;
  anniversary: { reciprocal?: Record<string, Trade | null | undefined> | null };
}

/** Prefer account identity so reciprocal trades cannot be repeated by another character on that account. */
export function anniversaryTradeIdentity(owner: unknown, sender: unknown): string {
  const ownerKey = owner === null || owner === undefined ? "" : requestText(owner).trim();
  return ownerKey ? "account:" + ownerKey : "character:" + requestText(sender || "").toLowerCase();
}

/** Read current storage snapshots and outstanding trades; completed returns release their identity. */
export function createAnniversarySupplies(state: SupplyState) {
  function counts(): Record<string, number> {
    const totals = inventoryCounts(
      Object.values(state.statuses),
      state.bankSnapshot,
      Object.values(state.bankbois || {}),
    );
    return Object.fromEntries(anniversarySlices.map((name) => [name, totals[name] || 0]));
  }
  function alreadyTraded(identity: string): boolean {
    return Object.values(state.anniversary.reciprocal || {}).some(
      (trade) =>
        trade &&
        (trade.identity || anniversaryTradeIdentity(trade.owner, trade.sender)) === identity &&
        trade.state !== "returned",
    );
  }
  return { counts, alreadyTraded };
}
