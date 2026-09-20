interface RestartJob {
  [key: string]: unknown;
  reason?: string;
  target?: string | null;
  queuedAt?: number;
  handoff?: { banked?: unknown[]; gold?: unknown };
  order?: { buys?: unknown[]; crafts?: unknown[] };
}
interface RestartState<T extends RestartJob> {
  merchantCurrent: T | null;
  merchantQueue: T[];
  merchantCargo: { bank: { owner?: string | null; mark: unknown }[]; gold: number };
}

/** Recover durable cargo and intent after process exit, then collapse repeated commerce orders. */
export function recoverMerchantQueue<T extends RestartJob>(
  state: RestartState<T>,
  now: () => number,
  stamp: (job: T) => T,
): void {
  const current = state.merchantCurrent;
  if (current) {
    if (current.handoff) {
      for (const mark of current.handoff.banked || [])
        state.merchantCargo.bank.push({ owner: current.target, mark });
      state.merchantCargo.gold += Number(current.handoff.gold) || 0;
    }
    const resumed = {
      ...current,
      reason: current.reason || "resumed service",
      queuedAt: current.queuedAt || now(),
    };
    delete resumed.phase;
    delete resumed.startedAt;
    delete resumed.handoff;
    state.merchantQueue.unshift(resumed);
    state.merchantCurrent = null;
  }
  const seen = new Set<string>();
  state.merchantQueue = state.merchantQueue.filter((job) => retainCommerce(job, seen)).map(stamp);
}

function retainCommerce(job: RestartJob, seen: Set<string>): boolean {
  if (job.reason !== "merchant commerce" || !job.order) return true;
  const signature = JSON.stringify({ buys: job.order.buys || [], crafts: job.order.crafts || [] });
  if (seen.has(signature)) return false;
  seen.add(signature);
  return true;
}
