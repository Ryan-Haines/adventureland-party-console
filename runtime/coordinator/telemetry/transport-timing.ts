import { monitorEventLoopDelay } from 'node:perf_hooks';

const delay = monitorEventLoopDelay({resolution: 20});
delay.enable();
let resetAt = Date.now();

/** Bounded histogram, read on existing requests; no diagnostic request loop. */
export function transportTiming(receivedAt: number, sentAt: number) {
  const eventLoopMaxMs = Math.round(delay.max / 1e6);
  if (sentAt - resetAt >= 10000) { delay.reset(); resetAt = sentAt; }
  return {receivedAt, sentAt, eventLoopMaxMs, statusStages: {...stages}};
}

/** Bounded, aggregate last/max timings; no payloads or extra request loop. */
const stages: Record<string, {lastMs: number; maxMs: number; count: number}> = {};
export function measureStatusStage<T>(name: string, run: () => T): T {
  const start = performance.now();
  try { return run(); } finally {
    const ms = Math.round((performance.now() - start) * 10) / 10;
    const old = stages[name];
    stages[name] = {lastMs: ms, maxMs: Math.max(old?.maxMs || 0, ms), count: Math.min(1000000, (old?.count || 0) + 1)};
  }
}
