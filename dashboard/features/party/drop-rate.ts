interface DropRate {
  rate: number;
  quantity: number;
  originRate?: number;
  sourceType?: string;
  acquisitionPath?: string[];
}

export function isDirectDrop(drop: { acquisitionPath?: string[] }): boolean {
  // Native "open" entries choose the reward inside the monster's chest. An
  // exchangeable item followed by another reward requires a separate exchange
  // and is not a drop of that final item. Keep compatibility with saved catalogs
  // that predate acquisition paths, plus the native world-table annotations.
  return (drop.acquisitionPath || []).slice(0, -1).every(step =>
    step.startsWith("open ") || step === "World drop" || step === "HP-scaled world drop");
}

export function effectiveDropRate(drop: DropRate): number {
  return (drop.sourceType === "monster" || drop.sourceType === "home") && (drop.acquisitionPath?.length ?? 0) <= 1
    ? drop.originRate ?? drop.rate : drop.rate;
}

export function formatDropRate(drop: DropRate): string {
  const rate = Math.min(1, Math.max(0, effectiveDropRate(drop)));
  const quantity = Math.max(1, drop.quantity || 1);
  const count = quantity > 1 ? ` ×${quantity.toLocaleString("en-US")}` : "";
  if (!Number.isFinite(rate) || rate <= 0) return `0/1\n(0%)${count}`;
  if (rate >= 1) return `1/1\n(100%)${count}`;
  const [numerator, denominator] = probabilityRatio(rate);
  // Significant digits keep rare drops readable without rounding them to 0%.
  const percent = (rate * 100).toLocaleString("en-US", { maximumSignificantDigits: 6 });
  return `${numerator.toLocaleString("en-US")}/${denominator.toLocaleString("en-US")}\n(${percent}%)${count}`;
}

function probabilityRatio(rate: number): [bigint, bigint] {
  // Native tables include expressions such as 15/100000 and weighted nested
  // tables. Recover their reduced ratio to floating-point precision rather than
  // forcing a numerator of one and rounding a noninteger reciprocal.
  let remainder = rate, previousNumerator = 0, numerator = 1,
    previousDenominator = 1, denominator = 0;
  for (let iteration = 0; iteration < 64; iteration++) {
    const whole = Math.floor(remainder);
    const nextNumerator = whole * numerator + previousNumerator;
    const nextDenominator = whole * denominator + previousDenominator;
    if (!Number.isSafeInteger(nextNumerator) || !Number.isSafeInteger(nextDenominator)) break;
    [previousNumerator, numerator] = [numerator, nextNumerator];
    [previousDenominator, denominator] = [denominator, nextDenominator];
    if (denominator && Math.abs(numerator / denominator - rate) <= rate * Number.EPSILON * 4)
      return [BigInt(numerator), BigInt(denominator)];
    const fraction = remainder - whole;
    if (!fraction) break;
    remainder = 1 / fraction;
  }
  // Very small or complicated reported probabilities may exceed safe numeric
  // convergents. Preserve their decimal value exactly, including exponents.
  const [decimal, exponent = "0"] = rate.toString().split("e");
  const [integer, fractional = ""] = decimal.split(".");
  let top = BigInt(integer + fractional), bottom = BigInt(1);
  const scale = fractional.length - Number(exponent);
  if (scale >= 0) bottom = BigInt(10) ** BigInt(scale);
  else top *= BigInt(10) ** BigInt(-scale);
  let a = top, b = bottom;
  while (b) [a, b] = [b, a % b];
  return [top / a, bottom / a];
}
