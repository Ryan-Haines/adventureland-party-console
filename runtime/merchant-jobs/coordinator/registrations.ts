// The job owner's registrations on the coordinator:
// the `job` source, which describes the merchant group's `merchant-job` task from the
// current job and decides nothing. The tasks owner's rule table ranks it (runtime/tasks/rules.ts); a suspend
// pauses the job at its next checkpoint. It also
// answers the reads an add-on may ask: the current job, the ready jobs and a reason's job kind record, and
// `member.holder` for a walk member its errand holds.
import type { MemberHold, Registration } from '../../hooks/registry.ts';
import { merchantKind, merchantLine } from '../rules.ts';
import type { MerchantWork } from './owner.ts';
import type { ReadyJob } from './dispatch.ts';
import { wakeJobWaits } from './report-wait.ts';

export function merchantJobSource(current: () => (MerchantWork & { phase?: string }) | null | undefined, status: (name: string) => unknown,
  ready: () => ReadyJob[]): Registration {
  return { name: 'core:merchant-jobs', folder: 'core', author: 'adventureland-party-console', holder: '08',
    summary: "Answers the merchant's current and ready jobs, a reason's kind record, a walk member's errand hold and the merchant group's task.",
    hooks: {
    'jobs.current': () => {
      const job = current();
      return job ? { id: String(job.id), reason: String(job.reason), target: String(job.target), phase: job.phase } : null;
    },
    'jobs.ready': () => ready(),
    // A member's report runs the retries and rechecks that wait for it (report-wait.ts).
    'status.received': payload => wakeJobWaits(String((payload as { character?: unknown }).character)),
    'merchant.kind': reason => ({ ...merchantKind(reason) }),
    // A member whose own report names an errand's live request as what holds it from the walk is
    // coming once the errand ends, which its next report shows.
    'member.holder': ({ member }) => {
      const named = (status(member) as { commandHold?: { owner: string; reason: string } | null } | undefined)?.commandHold;
      return named?.owner === '08' ? [{ owner: '08', reason: named.reason, coming: true, endsOn: 'report' } satisfies MemberHold] : [];
    },
    'task.request': view => {
      if ((view as { groupKind?: string }).groupKind !== 'merchant') return [];
      const job = current();
      // The task's label is the merchant's card line: the job with its bank stage.
      return [{ slot: 'job', end: 'job-done', ask: job ? { kind: 'merchant-job', owner: `job:${job.id}`,
        phase: job.reason, label: merchantLine(job, false).label } : null }];
    } } };
}
