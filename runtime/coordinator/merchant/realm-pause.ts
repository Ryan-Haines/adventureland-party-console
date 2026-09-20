interface PausedJob {
  [field: string]: unknown;
  queuedAt?: unknown;
  target?: string | null;
}

/** Preserve job intent at the front of the queue while dropping the old worker's progress. */
export function pauseMerchantForRealm<T extends PausedJob>(
  state: {
    merchantCurrent: T | null;
    merchantQueue: T[];
    commands: Record<string, unknown>;
  },
  now: () => number,
  stamp: (job: T) => T,
): void {
  const current = state.merchantCurrent;
  if (!current) return;
  const paused = { ...current, queuedAt: Number(current.queuedAt) || now() };
  for (const key of ["phase", "startedAt", "heartbeatAt", "progressAt", "handoff"])
    delete paused[key];
  state.merchantQueue.unshift(stamp(paused));
  if (current.target) delete state.commands[current.target];
  state.merchantCurrent = null;
}
