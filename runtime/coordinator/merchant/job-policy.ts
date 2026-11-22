import { matchesExchangeSource, type WithdrawalRequest } from '../inventory/exchange-storage.ts';
import { routineFor } from './routines.ts';
import { bankStagingReserved } from '../inventory/reserved-cargo.ts';
import { hasMarkedWithdrawals } from './marked-withdrawals.ts';
import { merchantJobPriority } from "./priority.ts";
import type { PrioritizedJob } from "./priority.ts";

interface BankCapacity {
  bankbois?: Record<string, unknown> | null;
  merchantCharacter: string | null;
  bankSnapshot?: { packs?: Record<string, Record<number, unknown> | undefined> } | null;
}
interface PriorityState<Bid extends { priorityOverride?: number }> extends BankCapacity {
  merchantRoutinePriorities: Record<string, number>;
  merchantAutomations?: Record<string, boolean | undefined>;
  standBids?: Record<string, Bid> | null;
  withdrawals: Record<string, { pack?: string; slot?: number; improvement?: string; autoNpcRuleKey?: string }[] | undefined>;
}
interface InventoryCapacity extends BankCapacity {
  marked?: Record<string, readonly unknown[] | undefined>;
  npcSaleMarks?: readonly {source?: string; state?: string}[];
  withdrawals?: Record<string, Partial<WithdrawalRequest>[] | undefined>;
  statuses: Record<string, { items?: unknown } | undefined>;
}

function completesStorageHandoff<Bid extends { priorityOverride?: number }>(
  state: PriorityState<Bid>,
  job: PrioritizedJob,
): boolean {
  if (!bankStagingReserved(state)) return false;
  if (job.target !== state.merchantCharacter || !["withdrawals", "bank collection", "manual bank exchange", "upgrades and compounds", "manual upgrades", "auto upgrade", "manual compounds", "auto compound"].includes(job.reason)) return false;
  return (state.withdrawals?.[String(state.merchantCharacter)] || []).some(
    (request) =>
      (routineFor(job) === routineFor({reason: request.improvement || "manual bank exchange"}) ||
        ['withdrawals','bank collection'].includes(job.reason) && hasMarkedWithdrawals([request])) &&
      request.pack === "items1" &&
      Number(request.slot) >= 35 &&
      state.bankSnapshot?.packs?.items1?.[Number(request.slot)],
  );
}

/** Outbound staging retrieval outranks optional jobs only while its reserved slot is occupied. */
export function coordinatorMerchantPriority<Bid extends { priorityOverride?: number }>(
  state: PriorityState<Bid>,
  job: PrioritizedJob,
): number {
  const policy = {
    routines: state.merchantRoutinePriorities,
    bids: state.standBids || {},
    completesStorageHandoff: (candidate: PrioritizedJob) => completesStorageHandoff(state, candidate),
  };
  const priority = merchantJobPriority(job, policy);
  if (job.reason === "auto compound" && job.target === state.merchantCharacter) {
    const packs = Object.entries(state.bankSnapshot?.packs || {});
    const staging = bankStagingReserved(state);
    const full = packs.length > 0 && packs.every(([pack, slots]) =>
      Array.from({length: staging && pack === "items1" ? 35 : 42}, (_, slot) => slots?.[slot]).every(Boolean));
    if (full) return Math.max(priority, 100);
  }
  // Retrieval is a dependency of the sale. Keep the withdrawal/threshold
  // enable gates intact, but do not let unrelated party work invert priority.
  if (job.target !== state.merchantCharacter || !['withdrawals', 'bank collection'].includes(job.reason) ||
      state.merchantAutomations?.['auto npc sales'] === false ||
      !(state.withdrawals[String(state.merchantCharacter)] || []).some(mark => mark.autoNpcRuleKey && hasMarkedWithdrawals([mark]))) return priority;
  return Math.max(priority, merchantJobPriority({reason: 'auto npc sales'}, policy));
}

export function coordinatorPrioritizedBids<Bid extends { priorityOverride?: number }>(
  state: PriorityState<Bid>,
  reason: string,
): [string, Bid][] {
  return Object.entries(state.standBids || {}).sort(
    ([first], [second]) =>
      coordinatorMerchantPriority(state, { reason, bidItemId: second }) -
      coordinatorMerchantPriority(state, { reason, bidItemId: first }),
  );
}

export function coordinatorMerchantTransferBlocked(
  state: InventoryCapacity,
  job: PrioritizedJob | null | undefined,
): boolean {
  if (job?.reason === 'exchange' && job.exchangeStorageSources?.length) {
    const requests = state.withdrawals?.[String(job.target)] || [];
    if (job.exchangeStorageSources.every(source => requests.some(request => matchesExchangeSource(source, request)))) return true;
  }
  if (job?.reason === 'exchange' && job.exchangeCapacitySignature !== undefined &&
      job.exchangeCapacitySignature === coordinatorMerchantCapacitySignature(state, job.target || null)) return true;
  const items = state.statuses[String(state.merchantCharacter)]?.items;
  if (job?.target === state.merchantCharacter && ['withdrawals','bank collection','auto npc withdrawals'].includes(job.reason) && Array.isArray(items)) {
    const free = items.filter(entry => !entry).length;
    const canSwap = state.marked?.[String(job.target)]?.length && state.withdrawals?.[String(job.target)]?.some(mark => mark.autoNpcRuleKey && /^items\d+$/.test(String(mark.pack)));
    if (free <= 3) return job.reason !== 'auto npc withdrawals' || (free === 0 && !canSwap) ||
      !!state.npcSaleMarks?.some(mark => mark.source === 'merchant' && mark.state === 'queued');
  }
  // Improvement staging needs both the lucky cell and a separate movement
  // buffer. Leave freeing work eligible even when its configured priority is
  // lower: it is a dependency, not another production attempt.
  if (job?.target === state.merchantCharacter &&
      ['upgrades and compounds','manual upgrades','auto upgrade','manual compounds','auto compound'].includes(job.reason) &&
      Array.isArray(items) && items.filter(entry => !entry).length < 2) return true;
  if (
    !job ||
    job.target === state.merchantCharacter ||
    !["marked items", "inventory cleanout", "exchange pickup"].includes(job.reason)
  )
    return false;
  return Array.isArray(items) && items.filter((entry) => !entry).length <= 3;
}

/** Movement, gold and heartbeat timestamps must not retry a job whose storage capacity is unchanged. */
export function coordinatorMerchantCapacitySignature(
  state: InventoryCapacity,
  name: string | null,
): string {
  return JSON.stringify([
    state.statuses[String(state.merchantCharacter)]?.items || [],
    state.statuses[String(name)]?.items || [],
    state.bankSnapshot?.packs || {},
  ]);
}
