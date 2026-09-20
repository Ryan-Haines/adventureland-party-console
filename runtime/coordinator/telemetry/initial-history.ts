interface SavedLog {
  [key: string]: unknown;
  message?: string;
  type?: string;
  at?: unknown;
  details?: { xp?: unknown } | null;
}
interface HistorySource {
  merchantActivity?: unknown;
  combatLogs?: Record<string, unknown>;
}

function visible(entry: SavedLog | null): entry is SavedLog {
  return (
    !!entry &&
    entry.message !== "Used HP potion" &&
    entry.message !== "Used MP potion" &&
    !(entry.type === "kill" && !(entry.details && Number.isFinite(Number(entry.details.xp))))
  );
}
function repeatedSkill(entry: SavedLog, previous: SavedLog | undefined): boolean {
  return (
    entry.type === "skill" &&
    !!previous &&
    previous.type === "skill" &&
    previous.message === entry.message &&
    Math.abs(Number(entry.at) - Number(previous.at)) < 1000
  );
}
function cleanLogs(entries: unknown): SavedLog[] {
  if (!Array.isArray(entries)) return [];
  const cleaned: SavedLog[] = [];
  for (const entry of (entries as (SavedLog | null)[]).filter(visible)) {
    if (!repeatedSkill(entry, cleaned[cleaned.length - 1])) cleaned.push(entry);
  }
  return cleaned.slice(-500);
}

/** Preserve history-document precedence, migrate noisy legacy entries, and keep the latest 500. */
export function initialCoordinatorHistory(history: HistorySource, settings: HistorySource) {
  const activity = history.merchantActivity || settings.merchantActivity;
  const combatLogs: Record<string, SavedLog[]> = {};
  for (const [name, entries] of Object.entries(history.combatLogs || settings.combatLogs || {}))
    combatLogs[name] = cleanLogs(entries);
  return { merchantActivity: Array.isArray(activity) ? activity.slice(-500) : [], combatLogs };
}
