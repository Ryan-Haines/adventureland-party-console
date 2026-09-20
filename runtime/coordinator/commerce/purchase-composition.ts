import { createLocalMarket } from "./local-market.ts";
import { createBidPurchases } from "./bids.ts";

type PurchaseState = Parameters<typeof createLocalMarket>[0] &
  Parameters<typeof createBidPurchases>[0] & {
    nextCommandId: number;
    statuses: Record<string, { server?: string } | undefined>;
  };
type BidPorts = Parameters<typeof createBidPurchases>[1];
type PurchasePorts = Omit<BidPorts, "nextCommand" | "planPonty"> & {
  priority: (job: { reason: string; bidItemId: string }) => number;
  planPonty: (
    ...args: [...Parameters<BidPorts["planPonty"]>, string | undefined, true]
  ) => ReturnType<BidPorts["planPonty"]>;
};

/** Local and remote offers share pending-bid detection, command IDs and the merchant's current realm. */
export function createCoordinatorPurchases(state: PurchaseState, ports: PurchasePorts) {
  const shared = { ...ports, nextCommand: () => state.nextCommandId++ };
  const local = createLocalMarket(state, {
    ...shared,
    pending: (itemId) => bids.pending(itemId),
    priority: (itemId) => ports.priority({ reason: "stand bid purchases", bidItemId: itemId }),
  });
  const bids = createBidPurchases(state, {
    ...shared,
    planPonty: (candidates, quantity) =>
      ports.planPonty(
        candidates,
        quantity,
        state.statuses[String(state.merchantCharacter)]?.server,
        true,
      ),
  });
  return { local, bids };
}
