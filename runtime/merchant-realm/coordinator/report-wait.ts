// The realm owner's wait for its members' word on the coordinator. A realm switch reads arrivals and
// homes from the members' reports (the status owner's `status.received`) and from their home confirmations
// (routes.ts `confirmHome`), so each wait ends on the next of those, with no timer polling the
// statuses. The caller's bound ends it when no member reports at all.

const waiting = new Set<() => void>();

/** A member's report or home confirmation arrived: every waiting read runs again. */
export function wakeReportWaits(): void {
  for (const wake of [...waiting]) wake();
}

/** Resolves at the next member report or home confirmation, or once `bound` ms pass on the realm
 *  owner's run scope. */
export function nextReport(scope: { sleep(ms: number): Promise<void> }, bound: number): Promise<void> {
  return new Promise<void>(resolve => {
    const wake = () => { waiting.delete(wake); resolve(); };
    waiting.add(wake);
    void scope.sleep(Math.max(0, bound)).then(wake);
  });
}
