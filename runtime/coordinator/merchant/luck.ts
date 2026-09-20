import type { ObservedPosition } from "../contracts/position.ts";

interface LuckCondition {
  id: string;
  source?: string;
  remainingMs?: number;
  live?: { strong?: boolean };
}

export interface LuckStatus extends ObservedPosition {
  name: string;
  conditions?: readonly (LuckCondition | null)[];
}

const luckDurationMs = 3_600_000;
export const luckTravelMarginMs = 30_000;
const crossMapLeadMs = 330_000;

function luckCondition(status: LuckStatus | undefined): LuckCondition | null | undefined {
  return status?.conditions?.find((entry) => entry?.id === "mluck");
}

function ownedCondition(condition: LuckCondition, merchant: string | null): boolean {
  return String(condition.source || "") === String(merchant || "");
}

function remainingFromCast(
  status: LuckStatus | undefined,
  castAt: number | undefined,
  now: number,
): number {
  return status && castAt ? Math.max(0, luckDurationMs - (now - castAt)) : 0;
}

export function mluckRemaining(
  status: LuckStatus | undefined,
  merchant: string | null,
  castAt: number | undefined,
  now: number,
): number {
  const condition = luckCondition(status);
  // A fresh absence overrides a saved cast timestamp, including after reconnect.
  if (Array.isArray(status?.conditions) && !condition) return 0;
  if (condition && !ownedCondition(condition, merchant)) return 0;
  const reported = condition && Number(condition.remainingMs);
  if (typeof reported === "number" && Number.isFinite(reported)) return Math.max(0, reported);
  return remainingFromCast(status, castAt, now);
}

export function hasStrongMluck(status: LuckStatus | undefined): boolean {
  return !!luckCondition(status)?.live?.strong;
}

export function mluckTravelLead(
  merchant: ObservedPosition | undefined,
  target: ObservedPosition,
): number {
  if (!merchant || merchant.map !== target.map) return crossMapLeadMs;
  const distance = Math.hypot(
    (Number(merchant.x) || 0) - (Number(target.x) || 0),
    (Number(merchant.y) || 0) - (Number(target.y) || 0),
  );
  const speed = Number(merchant.speed) > 0 ? Number(merchant.speed) : 40;
  // Double direct travel time to retain the allowance for actual smart routes.
  return Math.max(luckTravelMarginMs, (distance / speed) * 2000 + luckTravelMarginMs);
}
