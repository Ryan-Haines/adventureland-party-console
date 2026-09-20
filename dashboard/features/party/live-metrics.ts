// Bounded, memory-only diagnostics for the rollout. No item data or credentials are retained.
const pending = new Map<
  string,
  { sampledAt: number; receivedAt: number; receivedMono: number }
>();
export const dashboardLiveMetrics = {
  bytes: 0,
  messages: 0,
  commits: 0,
  receiveToCommitMs: [] as number[],
  sampleToCommitMs: [] as number[],
};
let serverOffset = 0;
export function synchronizeDashboardClock(
  serverNow: number,
  sentAt: number,
  receivedAt: number,
) {
  serverOffset = serverNow - (sentAt + receivedAt) / 2;
}
export function receivedLiveRecord(name: string, sampledAt: number) {
  pending.set(name, {
    sampledAt,
    receivedAt: Date.now(),
    receivedMono: performance.now(),
  });
}
export function committedLiveRecord(name: string) {
  const sample = pending.get(name);
  if (!sample) return;
  pending.delete(name);
  dashboardLiveMetrics.commits++;
  const elapsed = performance.now() - sample.receivedMono;
  dashboardLiveMetrics.receiveToCommitMs.push(elapsed);
  dashboardLiveMetrics.sampleToCommitMs.push(
    Math.max(0, sample.receivedAt + serverOffset - sample.sampledAt + elapsed),
  );
  for (const values of [
    dashboardLiveMetrics.receiveToCommitMs,
    dashboardLiveMetrics.sampleToCommitMs,
  ])
    if (values.length > 100) values.shift();
}
export function clearLiveMetrics() {
  pending.clear();
}
