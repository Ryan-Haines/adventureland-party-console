import type { Condition } from "./condition";

export type StatusDuration = { observed: number; at: number; source: Condition["source"] };
export function durationSignature(conditions: Condition[]) {
  return JSON.stringify(conditions.map(condition => [condition.id, condition.remainingMs, condition.source]));
}
export function reconcileDurations(signature: string, previous: Record<string, StatusDuration | undefined>, now: number) {
  const inputs: [string, number | null, Condition['source']][] = JSON.parse(signature);
  const next = Object.fromEntries(inputs.map(([id, remainingMs, source]) =>
    [id, observeStatus({ remainingMs, source }, previous[id], now)]));
  return Object.keys(previous).length === inputs.length && inputs.every(([id]) => next[id] === previous[id]) ? previous : next;
}
export function observeStatus(condition: Pick<Condition, 'remainingMs' | 'source'>, previous: StatusDuration | undefined, now: number): StatusDuration | undefined {
  const remaining = condition.remainingMs;
  if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0) return undefined;
  if (previous && previous.observed === remaining && previous.source === condition.source) return previous;
  return { observed: remaining, at: now, source: condition.source };
}
export function statusRemaining(value: StatusDuration | undefined, now: number) {
  if (!value) return null;
  return Math.max(0, value.observed - Math.max(0, now - value.at));
}
