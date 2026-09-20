import type { PrioritizedJob } from './priority.ts';

const automaticPickups = new Set(['auto upgrade', 'auto compound', 'auto npc sale pickup']);
export function pickupReason(reason: string, target: string | null | undefined, merchant: string | null | undefined): string {
  return target && target !== merchant && (automaticPickups.has(reason) || reason === 'deconstruction pickup') ? 'marked items' : reason;
}
/** Never apply to a running command: this migration is for pending work only. */
export function normalizePickupJob<T extends PrioritizedJob>(job: T, merchant: string | null | undefined): T {
  const reason = pickupReason(job.reason, job.target, merchant);
  if (reason === job.reason && reason !== 'marked items') return job;
  const normalized = {...job, reason, routine: 'party collection', operationStage: undefined};
  delete normalized.priorityOverride;
  return normalized;
}
function mergeTiming(previous: PrioritizedJob, job: PrioritizedJob): void {
  const age = Math.min(previous.queuedAt ?? Infinity, job.queuedAt ?? Infinity);
  if (Number.isFinite(age)) previous.queuedAt = age;
  previous.retryAt = Math.max(previous.retryAt || 0, job.retryAt || 0);
  if (job.realmBlockedReason) previous.realmBlockedReason = job.realmBlockedReason;
}
export function mergePickupJobs<T extends PrioritizedJob>(jobs: T[], merchant: string | null | undefined): T[] {
  const collections = new Map<string, T>();
  const result: T[] = [];
  for (const original of jobs) {
    const job = normalizePickupJob(original, merchant);
    if (job.reason !== 'marked items' || !job.target) { result.push(job); continue; }
    const previous = collections.get(job.target);
    if (!previous) { collections.set(job.target, job); result.push(job); continue; }
    mergeTiming(previous, job);
  }
  return result;
}
