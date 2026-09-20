import { routineEnabled } from './routines.ts';
import { createMerchantQueue } from "./queue.ts";
import { standSyncSignature } from "./stand-sync-signature.ts";
import type { InventoryEntry } from "../contracts/item.ts";

type QueueState = Parameters<typeof createMerchantQueue>[0];
type QueuePorts = Parameters<typeof createMerchantQueue>[1];
interface CoordinatorQueueState {
  merchantQueue: QueueState["queue"];
  merchantCurrent: QueueState["current"];
  merchantJobBlocks: QueueState["blocks"];
  merchantAutomations?: Record<string, boolean | undefined>;
  merchantCharacter: string | null;
  bankbois?: Record<string, unknown>;
  bankSnapshot?: { gold?: unknown } | null;
  statuses: Record<string, { gold?: unknown; items?: (InventoryEntry | null)[] }>;
  nextCommandId: number;
  standListings?: ({ state?: string; bankPack?: unknown } | null)[] | null;
}
type CompositionPorts = Pick<
  QueuePorts,
  | "now"
  | "collectionReady"
  | "capacitySignature"
  | "routinePriority"
  | "priority"
  | "stamp"
  | "persist"
  | "dispatch"
  | "log"
>;

/** Compose queue policy against live coordinator collections, balances and command sequencing. */
export function createCoordinatorMerchantQueue(
  state: CoordinatorQueueState,
  ports: CompositionPorts,
) {
  return createMerchantQueue(
    {
      get queue() {
        return state.merchantQueue;
      },
      get current() {
        return state.merchantCurrent;
      },
      get blocks() {
        return state.merchantJobBlocks;
      },
    },
    {
      merchant: () => state.merchantCharacter,
      collectionReady: ports.collectionReady,
      enabled: reason => routineEnabled({reason}, state.merchantAutomations || {}),
      bankboi: (name) => !!state.bankbois?.[name],
      capacitySignature: (name) => ports.capacitySignature(name),
      gold: () => ({
        bank: Number(state.bankSnapshot?.gold) || 0,
        merchant: Number(state.statuses[String(state.merchantCharacter)]?.gold) || 0,
      }),
      nextId: () => "merchant-" + ports.now() + "-" + state.nextCommandId++,
      now: () => ports.now(),
      routinePriority: (reason) => ports.routinePriority(reason),
      priority: (job) => ports.priority(job),
      stamp: (job) => ports.stamp(job),
      hasPendingStandInventory: () =>
        (state.standListings || []).some(
          (listing) => listing && listing.state !== "paused" && listing.state !== "live" && !listing.bankPack,
        ),
      standInventorySignature: () => standSyncSignature(state.merchantCharacter, state.standListings || [],
        state.statuses[String(state.merchantCharacter)]?.items || []),
      persist: () => ports.persist(),
      dispatch: () => ports.dispatch(),
      log: (message, level, details) => ports.log(message, level, details),
    },
  );
}
