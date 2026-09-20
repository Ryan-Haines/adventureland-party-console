export interface EntityRefreshSample {
  enabled: boolean;
  context: string;
  target: string | null;
  accepted: number;
}
export interface EntityRefreshDiagnostic {
  at: number;
  target: string;
  requests: number;
  reason: string;
}
interface Ports {
  now(): number;
  request(): boolean;
  report(diagnostic: EntityRefreshDiagnostic): void;
}

/** Reconcile cached sprites through the game's full snapshot; never infer death from age. */
export function createEntityRefresh(ports: Ports) {
  let context = '', accepted = 0, stalledAt: number | null = null;
  let requestedAt = -Infinity, requests = 0;
  function tick(sample: EntityRefreshSample): void {
    const now = ports.now();
    if (!sample.enabled || !sample.target) { stalledAt = null; return; }
    if (context !== sample.context || accepted !== sample.accepted || stalledAt === null) {
      context = sample.context; accepted = sample.accepted; stalledAt = now;
    }
    // Target churn must not keep renewing the grace period for a phantom blocker.
    if (now - stalledAt < 5000 || now - requestedAt < 10000) return;
    requestedAt = now;
    if (!ports.request()) return;
    ports.report({ at: now, target: sample.target, requests: ++requests,
      reason: 'no accepted basic attack for five seconds; requested full entity snapshot' });
  }
  return { tick };
}
