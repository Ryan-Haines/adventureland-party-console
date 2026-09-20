import { gatheringCastActive } from "../merchant/gathering.ts";

interface StoragePlan<R> {
  candidate: { name: string; state?: string };
  retrievals: R[];
  requests: { id: string }[];
}
export interface StorageTransaction<R> {
  id: string;
  bankboi: string;
  mode: "provision" | "retrieve" | "store";
  phase: "switching" | "waiting-for-bankboi" | "processing";
  slot: number;
  requestIds: string[];
  retrievals: R[];
  startedAt: number;
  commandId?: number;
}
interface StorageState<R> {
  transaction: StorageTransaction<R> | null;
}
interface StoragePorts<R> {
  now(): number;
  merchant(): string | null;
  plan(): StoragePlan<R> | null;
  merchantStatus(): { seenAt: number; gatheringPhase?: string; anniversaryState?: { busy?: boolean } } | undefined;
  merchantBusy(): boolean;
  slots(): (string | null)[];
  clearSlot(index: number): void;
  assignSlot(slot: number, name: string): void;
  stop(name: string): Promise<void>;
  persistRoster(): void;
  persistBank(): void;
  hasNormalWithdrawals(): boolean;
  collectWithdrawals(): void;
  log(message: string, level: "info" | "error" | "success", details?: unknown): void;
  workerStatus?(name: string): { seenAt: number; banking?: boolean } | undefined;
  interrupted?(name: string): void;
  clearCommand?(name: string): void;
}

/** Owns the merchant/BankBoi slot transaction and its concurrent-call latch. */
export function createBankboiService<R>(state: StorageState<R>, ports: StoragePorts<R>) {
  let switching = false;
  let starting: Promise<void> | null = null;
  let restoring: Promise<void> | null = null;
  let steamRelease = false;

  function ready(): boolean {
    const status = ports.merchantStatus();
    return (
      !!status &&
      !gatheringCastActive(status, ports.now()) &&
      !(status.seenAt < ports.now() - 10_000) &&
      !ports.merchantBusy() &&
      !status.anniversaryState?.busy
    );
  }

  function transaction(plan: StoragePlan<R>, index: number): StorageTransaction<R> {
    return {
      id: "bankboi-" + ports.now(),
      bankboi: plan.candidate.name,
      mode:
        plan.candidate.state === "provisioning"
          ? "provision"
          : plan.retrievals.length
            ? "retrieve"
            : "store",
      phase: "switching",
      slot: index + 1,
      requestIds: plan.requests.map((request) => request.id),
      retrievals: plan.retrievals,
      startedAt: ports.now(),
    };
  }

  async function begin(): Promise<void> {
    if (switching || state.transaction) return;
    const plan = ports.plan();
    if (!plan || !ready()) return;
    const merchant = ports.merchant(),
      index = ports.slots().indexOf(merchant);
    if (!merchant || index < 0) return;
    switching = true;
    const active = transaction(plan, index);
    state.transaction = active;
    ports.persistBank();
    try {
      ports.clearSlot(index);
      ports.persistRoster();
      await ports.stop(merchant);
      ports.assignSlot(index + 1, plan.candidate.name);
      active.phase = "waiting-for-bankboi";
      ports.persistBank();
      ports.log(
        "Switched merchant slot to " + plan.candidate.name + " for overflow storage",
        "info",
      );
    } catch (error) {
      switching = false;
      state.transaction = null;
      ports.persistBank();
      if (!ports.slots()[index]) ports.assignSlot(index + 1, merchant);
      ports.log(
        "Could not start bankboi storage cycle",
        "error",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function finish(active: StorageTransaction<R>): Promise<void> {
    if (state.transaction !== active) return;
    const slot = Number(active.slot);
    await ports.stop(active.bankboi);
    if (state.transaction !== active || steamRelease) return;
    ports.clearSlot(slot - 1);
    const merchant = ports.merchant();
    if (merchant && !steamRelease) ports.assignSlot(slot, merchant);
    ports.clearCommand?.(active.bankboi);
    state.transaction = null;
    ports.persistBank();
    ports.log(
      merchant
        ? "Bankboi storage cycle completed; merchant restored, stand return pending"
        : "Bankboi storage cycle completed; slot released, no merchant selected",
      "success",
      { bankboi: active.bankboi },
    );
    switching = false;
    if (!steamRelease && ports.hasNormalWithdrawals()) ports.collectWithdrawals();
  }

  function restore(active: StorageTransaction<R>): Promise<void> {
    if (steamRelease) return Promise.resolve();
    if (restoring) return restoring;
    restoring = finish(active).finally(() => { restoring = null; });
    return restoring;
  }
  function abandoned(active: StorageTransaction<R>): boolean {
    const age = ports.now() - active.startedAt;
    if (age > 600_000) return true;
    if (age < 120_000 || !ports.workerStatus) return false;
    const status = ports.workerStatus(active.bankboi);
    return !status || status.seenAt < ports.now() - 30_000 || status.banking === false;
  }
  async function start(): Promise<void> {
    if (steamRelease || starting || restoring) return;
    const active = state.transaction;
    if (active && abandoned(active)) {
      ports.interrupted?.(active.bankboi);
      ports.log("Recovering abandoned BankBoi transaction", "error", { bankboi: active.bankboi });
      await restore(active);
      return;
    }
    starting = begin().finally(() => { starting = null; });
    await starting;
  }
  async function releaseForSteam(confirmOffline: (name: string) => Promise<boolean>): Promise<void> {
    steamRelease = true;
    try {
      if (starting) await starting;
      if (restoring) await restoring;
      const active = state.transaction;
      if (!active) return;
      await ports.stop(active.bankboi);
      if (!await confirmOffline(active.bankboi)) throw new Error("BankBoi is still stopping; its slot remains reserved");
      if (state.transaction !== active) return;
      ports.interrupted?.(active.bankboi);
      ports.clearCommand?.(active.bankboi);
      if (ports.slots()[active.slot - 1] === active.bankboi) ports.clearSlot(active.slot - 1);
      state.transaction = null;
      switching = false;
      ports.persistRoster();
      ports.persistBank();
      ports.log("BankBoi storage paused for Steam login; pending items retained", "info", { bankboi: active.bankboi });
    } finally { steamRelease = false; }
  }
  return { start, restore, releaseForSteam, busy: () => switching || steamRelease || !!restoring };
}
