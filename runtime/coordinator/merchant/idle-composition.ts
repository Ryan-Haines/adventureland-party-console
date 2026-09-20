import { activeStandSales } from "./stand-reconciliation.ts";
import { createMerchantIdle } from "./idle.ts";
import type { MerchantWork } from "./work.ts";

type IdlePorts = Parameters<typeof createMerchantIdle>[0];
interface IdleState {
  bankboiTransaction: unknown;
  merchantCharacter: string | null;
  statuses: Record<string, ReturnType<IdlePorts["status"]>>;
  merchantCurrent: unknown;
  merchantForceStand: unknown;
  merchantQueue: MerchantWork[];
  gatheringModes: string[];
  gatheringCooldowns?: Record<string, number | undefined>;
  standListings?: ReturnType<IdlePorts["listings"]>;
  commands: Record<string, ReturnType<IdlePorts["command"]>>;
  nextCommandId: number;
  activeRealm: string;
}
type CompositionPorts = Pick<IdlePorts, "now" | "anniversary" | "ensureHome" | "inventoryMerge"> & {
  storageBusy: () => boolean;
  storagePlan: () => unknown;
  capacityBlocked: (job: MerchantWork) => boolean;
  collectionReady: (job: MerchantWork) => boolean;
};

/** Keep idle decisions attached to current queues and commands, sharing dispatch's readiness rules. */
export function createCoordinatorMerchantIdle(state: IdleState, ports: CompositionPorts) {
  return createMerchantIdle({
    storagePending: () =>
      !!(ports.storageBusy() || state.bankboiTransaction || ports.storagePlan()),
    merchant: () => state.merchantCharacter,
    status: (name) => state.statuses[String(name)],
    anniversary: () => ports.anniversary(),
    currentJob: () => !!state.merchantCurrent,
    ensureHome: (reason) => ports.ensureHome(reason),
    forcedStand: () => !!state.merchantForceStand,
    readyQueuedWork: () =>
      state.merchantQueue.some(
        (job) =>
          !job.realmBlockedReason &&
          Number(job.retryAt || 0) <= ports.now() &&
          !job.blockedOnBankboi &&
          !ports.capacityBlocked(job) &&
          ports.collectionReady(job),
      ),
    modes: () => state.gatheringModes,
    cooldown: (mode) => state.gatheringCooldowns?.[mode],
    now: () => ports.now(),
    listings: () => activeStandSales(state.standListings || []),
    inventoryMerge: (status) => ports.inventoryMerge(status),
    command: (name) => state.commands[String(name)],
    issue: (name, command) => {
      state.commands[name] = command;
    },
    nextCommand: () => state.nextCommandId++,
    realm: () => state.activeRealm,
  });
}
