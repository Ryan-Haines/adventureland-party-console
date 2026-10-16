// Achievement Hunt settings and blacklist (docs/achievement-hunt.md).

/** Achievement Hunt runs while farmingPolicy is "achievements"; these are its choices. */
export interface AchievementHuntSettings {
  /** Selected monster ids. The bestiary sets the list order. */
  monsters: string[];
  blacklistDeaths: boolean;
  deathThreshold: number;
  /** Fight nearby, weaker monsters while the target respawns (docs/achievement-hunt.md § Filling respawn waits). */
  fillIdle: boolean;
  /** Fill only with selected monsters; off, any regular monster on the target's ground can fill. */
  fillSelectedOnly: boolean;
  /** Minutes a boss-held target is left before the party goes back to check (docs/achievement-hunt.md § Bosses). */
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
  /** Bosses that spawn on the target's ground; fighters keep away from them (docs/achievement-hunt.md § Bosses). */
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
  bossRecheckMinutes: 10,
};

const optionalBoolean = (value: unknown) => value === undefined || typeof value === "boolean";
const validThreshold = (value: unknown) =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 100);
const validMinutes = (value: unknown) =>
  value === undefined || (Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 120);
const validMonsters = (value: unknown) =>
  value === undefined ||
  (Array.isArray(value) && value.length <= 500 && value.every((id) => typeof id === "string" && /^[a-z0-9_]+$/i.test(id)));

export function validAchievementHuntSettings(value: unknown): value is Partial<AchievementHuntSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return optionalBoolean(settings.blacklistDeaths) && optionalBoolean(settings.fillIdle) &&
    optionalBoolean(settings.fillSelectedOnly) && validThreshold(settings.deathThreshold) &&
    validMinutes(settings.bossRecheckMinutes) && validMonsters(settings.monsters);
}
