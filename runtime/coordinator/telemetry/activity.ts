export interface ActivityEntry {
  at: number;
  level: unknown;
  message: string;
  details: unknown;
}

export function appendActivity(
  entries: ActivityEntry[],
  message: string,
  level: unknown,
  details: unknown,
  now: () => number,
): void {
  entries.push({ at: now(), level, message, details: details || null });
  if (entries.length > 500) entries.splice(0, entries.length - 500);
}

/** Suppresses repeated gathering cooldown notices, retaining all other activity. */
export function appendMerchantActivity(
  entries: ActivityEntry[],
  message: string,
  level: unknown,
  details: unknown,
  now: () => number,
): boolean {
  if (
    /cooling down; will resume automatically$/i.test(String(message)) &&
    entries.slice(-50).some((entry) => entry.message === message && now() - entry.at < 300_000)
  )
    return false;
  appendActivity(entries, message, level, details, now);
  return true;
}
