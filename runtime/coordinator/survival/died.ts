import { fresh as freshReport } from '../../protocol/reports.ts';
// The one death counter on the coordinator:
// each report's death is read once, `lastDeath` against `combatDeathSeen`, and published
// as `survival.died`; the party death recovery reads its list of deaths from the same scan, so the
// console counts each death once. The hunting owner's Hunt counts on the notice.

export interface DiedStatus {
  seenAt: number; rip?: boolean; hp?: number; map?: string; x?: number; y?: number;
  lastDeath?: { at?: unknown; message?: unknown; details?: Record<string, unknown>; eventTrip?: { event?: unknown } | null } | null;
}
// `survival.died`'s payload; `publishSurvival` adds its `by`.
export interface DiedNotice { name: string; at: number; cause: string; map?: string; x?: number; y?: number; event: string | null; by?: string }
export interface DiedPorts {
  now(): number;
  status(name: string): DiedStatus | undefined;
  // The saved record of each member's last death read (`combatDeathSeen`, a record of survival's saved fields).
  seen(): Record<string, { at: number; dead: boolean }>;
  publish: SurvivalPublish;
}
// Where a survival notice goes (3.10): the hook bus, and the coordinator log of the party's leader,
// or of the member the notice names while the party has none, through install.ts's one `log`.
export interface SurvivalPublish {
  notify(hook: 'survival.died' | 'survival.escaped', payload: Record<string, unknown>): void;
  log(entry: { at: number; type: string; message: string; details?: Record<string, unknown> }, member: string): void;
}
export function publishSurvival(p: SurvivalPublish, hook: 'survival.died' | 'survival.escaped', member: string, line: string, notice: object, at: number, by = 'core:survival'): void {
  p.notify(hook, { ...notice, by });
  p.log({ at, type: 'survival', message: hook + ' ' + line, details: { ...notice } as Record<string, unknown> }, member);
}
// What the party recovery's scan brings (recovery.ts): the hunting owner's event death rule
// (runtime/hunting/rules.ts `eventDeath`), since an event's death starts no party
// death recovery; and when the grouped fight started (`targeting.fight`),
// after which a death counts for a member with no record yet (today's rule).
export interface ScanRules {
  eventDeath(name: string, status: DiedStatus, at: number, reported: boolean): boolean;
  fightStartedAt(): number;
}
const fresh = (now: number, s: DiedStatus | undefined) => !!s && freshReport(s.seenAt, now);
const dead = (s: DiedStatus) => !!s.rip || Number(s.hp) <= 0;

export function createDied(ports: DiedPorts) {
  // The deaths among `names` the party recovery starts for, and one notice per newly reported death.
  function scan(names: readonly string[], rules: ScanRules): string[] {
    const deaths: string[] = [], now = ports.now(), seen = ports.seen();
    for (const name of names) {
      const s = ports.status(name);
      if (!s || !fresh(now, s)) continue;
      const prior = seen[name], stamp = Number(s.lastDeath?.at) || 0, reported = stamp > (prior?.at || 0);
      if (!rules.eventDeath(name, s, reported ? stamp : now, reported) &&
          (!prior ? dead(s) || stamp > rules.fightStartedAt() : !prior.dead && (dead(s) || stamp > prior.at))) deaths.push(name);
      // A member's first record with an old death and no rip names no new death.
      if (reported && (prior || dead(s))) {
        const details = s.lastDeath?.details ?? {};
        const notice: DiedNotice = { name, at: stamp, cause: String(s.lastDeath?.message ?? 'Killed by unknown monster'),
          map: (details.map as string | undefined) ?? s.map, x: (details.x as number | undefined) ?? s.x, y: (details.y as number | undefined) ?? s.y,
          event: s.lastDeath?.eventTrip?.event ? String(s.lastDeath.eventTrip.event) : null };
        publishSurvival(ports.publish, 'survival.died', name, name + ': ' + notice.cause, notice, now);
      }
      seen[name] = { at: Math.max(prior?.at || 0, stamp), dead: dead(s) };
    }
    return deaths;
  }
  // `survival.life`: the time of the member's last death this scan read, or 0
  // before any. The scan reads each death once, so the life changes once per death.
  function life(name: string): number { return ports.seen()[name]?.at || 0; }
  return { scan, life };
}
