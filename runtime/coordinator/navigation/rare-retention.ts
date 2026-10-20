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
  keepNewest(records, at, RARE_RECORD_LIMIT);
}

/**
 * Monster ids key the Achievement Hunt blacklist, so the game data bounds it.
 * The cap matches the 500-monster limit of validAchievementHuntSettings
 * (hunt/achievement-settings.ts) and bounds a corrupt or hand-edited journal.
 */
export const ACHIEVEMENT_BLACKLIST_LIMIT = 500;

/** Drops the oldest blacklist entries, by `at`, beyond ACHIEVEMENT_BLACKLIST_LIMIT. */
export function keepNewestAchievementBlacklist(records: Record<string, { at?: number }> | null | undefined): void {
  keepNewest(records, (entry) => Number(entry?.at), ACHIEVEMENT_BLACKLIST_LIMIT);
}

function keepNewest<T>(records: Record<string, T> | null | undefined, at: (entry: T) => number, limit: number): void {
  if (!records) return;
  const keys = Object.keys(records);
  if (keys.length <= limit) return;
  keys.sort((a, b) => (Number(at(records[a]!)) || 0) - (Number(at(records[b]!)) || 0));
  for (const key of keys.slice(0, keys.length - limit)) delete records[key];
}
