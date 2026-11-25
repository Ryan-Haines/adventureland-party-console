// The job owner's wait for the merchant's own next report on the character. Each report
// (the lifecycle owner's `report.sent`, which the runner's registration answers) carries the merchant's state to the
// coordinator and brings its reply, so an ask that the coordinator answered `waiting` asks again then,
// with no timer. The caller's bound ends the wait when the report timer stops.
import type { WaitScope } from './game-wait.ts';

const waiting = new Set<() => void>();

/** The merchant sent a report: every waiting ask goes again. */
export function wakeReportWaits(): void {
  for (const wake of [...waiting]) wake();
}

/** Resolves at the merchant's next report, or once `bound` ms pass. */
export function nextOwnReport(scope: Pick<WaitScope, 'setTimeout' | 'clearTimeout'>, bound: number): Promise<void> {
  return new Promise<void>(resolve => {
    const wake = () => { waiting.delete(wake); scope.clearTimeout(timer); resolve(); };
    const timer = scope.setTimeout(wake, Math.max(0, bound));
    waiting.add(wake);
  });
}
