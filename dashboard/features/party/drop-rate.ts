interface DropRate {
  rate: number;
  quantity: number;
  originRate?: number;
  sourceType?: string;
  acquisitionPath?: string[];
}

export function effectiveDropRate(drop: DropRate): number {
  return (drop.sourceType === "monster" || drop.sourceType === "home") && (drop.acquisitionPath?.length ?? 0) <= 1
    ? drop.originRate ?? drop.rate : drop.rate;
}

export function formatDropRate(drop: DropRate): string {
  const rate = Math.max(0, effectiveDropRate(drop));
  const quantity = Math.max(1, drop.quantity || 1);
  const count = quantity > 1 ? ` ×${quantity.toLocaleString("en-US")}` : "";
  if (rate <= 0) return `0/1${count}`;
  if (rate >= 1) return `1/1${count}${rate > 1 ? ` (roll weight ×${Number(rate.toPrecision(6)).toLocaleString("en-US")})` : ""}`;
  const denominator = 1 / rate;
  const rounded = Number(denominator.toPrecision(6));
  const approximate = Math.abs(rounded - denominator) > denominator * 1e-9;
  return `${approximate ? "≈" : ""}1/${rounded.toLocaleString("en-US", {maximumFractionDigits: 6})}${count}`;
}
