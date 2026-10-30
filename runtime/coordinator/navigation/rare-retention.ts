/**
 * Monster instance ids (realm|map|instance|id) key rare pursuit progress and
 * retry evidence, and every spawn brings a new id. No window in
 * rare-hunting.ts bounds how long an instance can live, so both keep the
 * newest entries up to this count. A live console collected 25 progress
 * entries and 5 rejections in 13 days.
 */
export const RARE_RECORD_LIMIT = 100;

/** Drops the oldest entries, by `at`, beyond RARE_RECORD_LIMIT. */
export function keepNewestRare<T>(records: Record<string, T> | null | undefined, at: (entry: T) => number): void {
  if (!records) return;
  const keys = Object.keys(records);
  if (keys.length <= RARE_RECORD_LIMIT) return;
  keys.sort((a, b) => (Number(at(records[a]!)) || 0) - (Number(at(records[b]!)) || 0));
  for (const key of keys.slice(0, keys.length - RARE_RECORD_LIMIT)) delete records[key];
}
