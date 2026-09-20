import { routineFor, type RoutineJob } from './routines.ts';
/** Keep separately prioritized work out of another routine's command. */
export function scopeWork<T extends Record<string, unknown>>(job: RoutineJob, value: T): T {
  const result: Record<string, unknown> = {...value}, routine = routineFor(job);
  const allowed: Record<string, boolean> = {
    upgrades: routine === 'manual upgrades' || routine === 'auto upgrade', statScrolls: routine === 'manual upgrades',
    preloadStatScrolls: routine === 'manual upgrades', bankUpgradeRules: routine === 'auto upgrade',
    compounds: routine === 'manual compounds', autoCompounds: routine === 'auto compound',
    purchases: routine === 'manual buying',
    npcSales: routine === 'npc sales' || routine === 'auto npc sales',
  };
  for (const [key, permit] of Object.entries(allowed)) if (!permit && key in result) result[key] = [];
  if (Array.isArray(result.upgrades)) result.upgrades = result.upgrades.filter(mark => Boolean(mark?.auto) === (routine === "auto upgrade"));
  if (Array.isArray(result.npcSales)) result.npcSales = result.npcSales.filter(mark => Boolean(mark.auto) === (routine === 'auto npc sales'));
  return result as T;
}
