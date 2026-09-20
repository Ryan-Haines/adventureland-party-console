interface DropRate {
  rate: number;
  quantity: number;
  originRate?: number;
  sourceType?: string;
  acquisitionPath?: string[];
}

export function effectiveDropRate(drop: DropRate): number {
  // Direct item sources retain the original count even when their chance was capped.
  return drop.sourceType === "monster" && (drop.acquisitionPath?.length ?? 0) <= 1
    ? drop.originRate ?? drop.rate
    : drop.rate;
}

export function formatDropRate(drop: DropRate): string {
  const rate = Math.max(0, effectiveDropRate(drop));
  const quantity = Math.max(1, drop.quantity || 1);
  const percent = (chance: number) => `${Number((chance * 100).toPrecision(6))}%`;
  const count = (value: number) => value > 1 ? ` ×${value.toLocaleString()}` : "";
  if (rate <= 1) return `${percent(rate)}${count(quantity)}`;
  const guaranteed = Math.floor(rate);
  const remainder = rate - guaranteed;
  return `100%${count(guaranteed * quantity)}${remainder > 0 ? ` + ${percent(remainder)}${count(quantity)}` : ""}`;
}
