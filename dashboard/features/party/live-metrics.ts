// Bounded, memory-only diagnostics for the rollout. No item data or credentials are retained.
export type LiveDomain = 'vitals' | 'position' | 'inventory';
const pending = new Map<
  string,
  { sampledAt: number; receivedAt: number; receivedMono: number }
>();
export const dashboardLiveMetrics = {
  utf16CodeUnits: 0,
  messages: 0,
  commits: 0,
  domainCommits: { vitals: 0, position: 0, inventory: 0 },
  receiveToCommitMs: [] as number[],
  sampleToCommitMs: [] as number[],
};
let serverOffset = 0;
/** String storage units, deliberately not a UTF-8 network-byte estimate. */
export function receivedLiveMessage(data: string) {
  dashboardLiveMetrics.messages++;
  dashboardLiveMetrics.utf16CodeUnits += data.length;
}
export function synchronizeDashboardClock(
  serverNow: number,
  sentAt: number,
  receivedAt: number,
) {
  serverOffset = serverNow - (sentAt + receivedAt) / 2;
}
export function receivedLiveRecord(name: string, sampledAt: number, domain: LiveDomain = 'vitals') {
  pending.set(JSON.stringify([name, domain]), {
    sampledAt,
    receivedAt: Date.now(),
    receivedMono: performance.now(),
  });
}
export function committedLiveRecord(name: string, domain: LiveDomain = 'vitals') {
  const key = JSON.stringify([name, domain]);
  const sample = pending.get(key);
  if (!sample) return;
  pending.delete(key);
  dashboardLiveMetrics.commits++;
  dashboardLiveMetrics.domainCommits[domain]++;
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
