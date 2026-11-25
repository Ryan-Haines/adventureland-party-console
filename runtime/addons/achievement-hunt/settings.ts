// Achievement Hunt settings and blacklist (README.md here).

/** Achievement Hunt runs while the target mode is "achievements"; these are its choices. */
export interface AchievementHuntSettings {
  /** Selected monster ids. The bestiary sets the list order. */
  monsters: string[];
  blacklistDeaths: boolean;
  deathThreshold: number;
  /** Fight nearby, weaker monsters while the target respawns (README.md here). */
  fillIdle: boolean;
  /** Fill only with selected monsters; off, any regular monster on the target's ground can fill. */
  fillSelectedOnly: boolean;
  /** Leave the target for a stand-in when an avoided boss attacks; off keeps farming it (user, 2026-11-09). */
  leaveOnBossAttack: boolean;
  /** Minutes a boss-held target is left before the party goes back to check (README.md here). */
  bossRecheckMinutes: number;
}
export interface AchievementBlacklistEntry {
  monsterId: string;
  at: number;
  reason: string;
  deaths?: number;
  characters?: string[];
}
export interface AchievementTargetState {
  id: string;
  step: number;
  milestone: number;
  startedAt: number;
  deaths: number;
  /** Last counted `lastDeath.at` per character, so one death counts once. */
  counted: Record<string, number>;
  /** The target and its fillers, as set in the monster focus. */
  focus?: string[];
  /** Each member's priority for every touched monster before the target set it; null when unset. */
  savedPriorities?: Record<string, Record<string, number | null>>;
  /** Bosses that spawn on the target's ground; fighters keep away from them (README.md here). */
  avoid?: string[];
  /** The target this one stands in for while a boss holds that target's ground. */
  standInFor?: string;
}

// The live test ran with 6, and the hunt blacklisted White Wolf on its sixth death.
export const defaultAchievementHuntSettings: AchievementHuntSettings = {
  monsters: [],
  blacklistDeaths: true,
  deathThreshold: 6,
  fillIdle: true,
  fillSelectedOnly: true,
  leaveOnBossAttack: true,
  bossRecheckMinutes: 10,
};

// The ranges of the player's two numbers, which the settings check and the dashboard's fields both
// read. They are the fork's ranges (972c9fce runtime/coordinator/hunt/achievement-settings.ts
// `validThreshold`, `validMinutes`), kept so every value the fork saved still loads.
export const DEATH_THRESHOLD_RANGE = { min: 1, max: 100 } as const;
export const RECHECK_MINUTES_RANGE = { min: 1, max: 120 } as const;
/** True for a whole number inside the range. */
export const inRange = (value: unknown, range: { min: number; max: number }) =>
  Number.isSafeInteger(value) && Number(value) >= range.min && Number(value) <= range.max;

const optionalBoolean = (value: unknown) => value === undefined || typeof value === "boolean";
const validThreshold = (value: unknown) => value === undefined || inRange(value, DEATH_THRESHOLD_RANGE);
const validMinutes = (value: unknown) => value === undefined || inRange(value, RECHECK_MINUTES_RANGE);
// The list's length needs no cap: the settings route refuses an id outside the known monster list
// (index.ts `target.settings`), which bounds it.
const validMonsters = (value: unknown) =>
  value === undefined || (Array.isArray(value) && value.every((id) => typeof id === "string" && /^[a-z0-9_]+$/i.test(id)));

export function validAchievementHuntSettings(value: unknown): value is Partial<AchievementHuntSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return optionalBoolean(settings.blacklistDeaths) && optionalBoolean(settings.fillIdle) &&
    optionalBoolean(settings.fillSelectedOnly) && optionalBoolean(settings.leaveOnBossAttack) && validThreshold(settings.deathThreshold) &&
    validMinutes(settings.bossRecheckMinutes) && validMonsters(settings.monsters);
}
