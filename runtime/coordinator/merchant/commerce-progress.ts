import type { MerchantWork } from './work.ts';

/** Dispatch fencing is opt-in for durable commerce; legacy routines retain their wire contract. */
export function currentMerchantReport(job: MerchantWork | null, body: Record<string, unknown>): job is MerchantWork {
  if (!job || body.jobId !== job.id) return false;
  if (job.commerceProgressVersion !== 2) return true;
  return body.commandId === job.commandId;
}

export function buyUpgradeOrder(job: MerchantWork): boolean {
  const order = job.order as { buys?: {level?: number}[] } | undefined;
  return job.reason === 'merchant commerce' && !!order?.buys?.some(line => Number(line.level) > 0);
}

export function commerceRouteFailure(job: MerchantWork, body: {success?: unknown; failureKind?: unknown}): boolean {
  return !body.success && buyUpgradeOrder(job) && body.failureKind === 'commerce_movement';
}

export function commerceRetryDelay(attempt: number): number {
  return [10000, 30000, 60000, 300000][Math.min(3, Math.max(0, attempt - 1))]!;
}
