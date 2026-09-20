import type { Condition } from "./condition";

export type StatusDuration = { observed: number; at: number; total: number; source: Condition["source"] };
export function observeStatus(condition: Condition, previous: StatusDuration | undefined, now: number): StatusDuration | undefined {
  const remaining = condition.remainingMs;
  if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0) return undefined;
  if (previous && previous.observed === remaining && previous.source === condition.source) return previous;
  const refreshed = !previous || previous.source !== condition.source || remaining > previous.observed;
  const defined = Number(condition.definition?.duration);
  return {
    observed: remaining, at: now, source: condition.source,
    total: Math.max(remaining, Number.isFinite(defined) && defined > 0 ? defined : 0, refreshed ? 0 : previous.total),
  };
}
export function statusRemaining(value: StatusDuration | undefined, now: number) {
  if (!value) return null;
  return Math.max(0, value.observed - Math.max(0, now - value.at));
}
