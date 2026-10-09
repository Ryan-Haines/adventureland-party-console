// Achievement Hunt settings and blacklist (docs/achievement-hunt.md).

/** Achievement Hunt runs while farmingPolicy is "achievements"; these are its choices. */
export interface AchievementHuntSettings {
  /** Selected monster ids. The bestiary sets the list order. */
  monsters: string[];
  blacklistDeaths: boolean;
  deathThreshold: number;
  /** Fight nearby, weaker monsters while the target respawns (docs/achievement-hunt.md § Filling respawn waits). */
  fillIdle: boolean;
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
}

// A rotation visits many easy monsters; one unlucky death should not skip one.
export const defaultAchievementHuntSettings: AchievementHuntSettings = {
  monsters: [],
  blacklistDeaths: true,
  deathThreshold: 3,
  fillIdle: true,
};

const optionalBoolean = (value: unknown) => value === undefined || typeof value === "boolean";
const validThreshold = (value: unknown) =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 100);
const validMonsters = (value: unknown) =>
  value === undefined ||
  (Array.isArray(value) && value.length <= 500 && value.every((id) => typeof id === "string" && /^[a-z0-9_]+$/i.test(id)));

export function validAchievementHuntSettings(value: unknown): value is Partial<AchievementHuntSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return optionalBoolean(settings.blacklistDeaths) && optionalBoolean(settings.fillIdle) &&
    validThreshold(settings.deathThreshold) && validMonsters(settings.monsters);
}
