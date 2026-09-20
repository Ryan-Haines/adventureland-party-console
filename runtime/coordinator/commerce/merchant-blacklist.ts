import type { MerchantBlock, MerchantIdentity } from "./market-types.ts";

export function merchantIdentityKey(entry: MerchantIdentity | null | undefined): string {
  return [entry && (entry.seller || entry.name), entry?.serverRegion, entry?.serverIdentifier]
    .map((value) => String(value || ""))
    .join("|");
}

export function merchantBlocked(
  records: Readonly<Record<string, MerchantBlock>>,
  entry: MerchantIdentity | null | undefined,
  now: number,
  automatic = true,
): boolean {
  const exact = records[merchantIdentityKey(entry)];
  const wildcard =
    records[[String((entry && (entry.seller || entry.name)) || ""), "", ""].join("|")];
  return [exact, wildcard].some(
    (record) =>
      !!record &&
      (automatic || record.reason === "manual") &&
      (Number(record.until) === -1 || Number(record.until) > now),
  );
}

/** Retains lifetime strikes after the retry cooldown expires; only explicit clearing resets them. */
export function recordMerchantFailure(
  records: Record<string, MerchantBlock>,
  listing: MerchantIdentity,
  reason: string,
  now: number,
): MerchantBlock {
  const key = merchantIdentityKey(listing),
    previous = records[key] || {};
  const failures = Math.max(0, Number(previous.failures) || 0) + 1;
  const cooldownMinutes = Math.pow(2, failures - 1);
  return (records[key] = {
    seller: listing.seller,
    serverRegion: listing.serverRegion,
    serverIdentifier: listing.serverIdentifier,
    reason,
    failures,
    until: now + cooldownMinutes * 60000,
    cooldownMinutes,
    updatedAt: now,
  });
}
