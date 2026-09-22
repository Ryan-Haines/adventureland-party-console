import { createBankboiService, type StorageTransaction } from "./bankboi-service.ts";
import { merchantEventReserved, type MerchantEventState } from '../merchant/event-control.ts';

type ServicePorts<Retrieval> = Parameters<typeof createBankboiService<Retrieval>>[1];
interface BankboiCoordinatorState<Retrieval> extends MerchantEventState {
  bankboiTransaction: StorageTransaction<Retrieval> | null;
  merchantCharacter: string | null;
  statuses: Record<string, (NonNullable<ReturnType<ServicePorts<Retrieval>["merchantStatus"]>> & { banking?: boolean }) | undefined>;
  merchantCurrent: unknown;
  bankbois?: Record<string, { state?: string; error?: unknown; retryAt?: number }>;
  commands?: Record<string, { type: string } | undefined>;
  merchantQueue?: { id: string }[];
  headlessSlots: (string | null)[];
  withdrawals: Record<string, { pack?: string | number | null; craftJobId?: string }[]>;
}
interface CompositionPorts<Retrieval, Block> {
  now: () => number;
  plan: ServicePorts<Retrieval>["plan"];
  assignSlot: ServicePorts<Retrieval>["assignSlot"];
  stop: (block: Block) => Promise<unknown>;
  persistRoster: () => void;
  persistBank: () => void;
  collect: (names: (string | null)[], reason: string) => unknown;
  log: ServicePorts<Retrieval>["log"];
}

/** All callbacks read current merchant state, including after a slot handoff or settings change. */
export function createCoordinatorBankboiService<Retrieval, Block extends { enabled?: boolean }>(
  state: BankboiCoordinatorState<Retrieval>,
  workers: Record<string, Block>,
  ports: CompositionPorts<Retrieval, Block>,
) {
  return createBankboiService(
    {
      get transaction() {
        return state.bankboiTransaction;
      },
      set transaction(value) {
        state.bankboiTransaction = value;
      },
    },
    {
      now: ports.now,
      merchant: () => state.merchantCharacter,
      plan: () => {
        for (const [name, requests] of Object.entries(state.withdrawals)) {
          const retained = requests.filter((request) => !request.craftJobId ||
            state.merchantQueue?.some((job) => job.id === request.craftJobId));
          if (retained.length !== requests.length) {
            state.withdrawals[name] = retained;
            ports.persistBank();
          }
        }
        return ports.plan();
      },
      merchantStatus: () => state.statuses[String(state.merchantCharacter)],
      workerStatus: (name) => state.statuses[name],
      clearCommand: (name) => {
        if (state.commands?.[name]?.type === "bankboi-service") delete state.commands[name];
      },
      interrupted: (name) => {
        const worker = state.bankbois?.[name];
        if (worker) { worker.state = "error"; worker.error = "interrupted"; worker.retryAt = ports.now() + 10_000; }
      },
      merchantBusy: () => !!state.merchantCurrent || merchantEventReserved(state, ports.now()),
      slots: () => state.headlessSlots,
      clearSlot: (index) => {
        state.headlessSlots[index] = null;
      },
      assignSlot: (slot, name) => ports.assignSlot(slot, name),
      stop: async (name) => {
        const block = workers[name];
        if (block) {
          block.enabled = false;
          await ports.stop(block);
        }
      },
      persistRoster: ports.persistRoster,
      persistBank: ports.persistBank,
      hasNormalWithdrawals: () =>
        (state.withdrawals[String(state.merchantCharacter)] || []).some(
          (request) => String(request.pack || "").indexOf("bankboi:") !== 0,
        ),
      collectWithdrawals: () => {
        ports.collect([state.merchantCharacter], "manual bank exchange");
      },
      log: (message, level, details) => ports.log(message, level, details),
    },
  );
}
