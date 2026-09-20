import type {
  FarmNavigationState,
  FarmNavigationPorts,
  FarmReport,
  FarmingArea,
} from "./farm-area-types.ts";
import { huntSettings } from "../hunt/settings.ts";
export interface FarmCompetitionObservation {
  at: number;
  runtimeId: string;
  revision: number;
  areaId: string;
  map: string;
  in: string;
  server: string;
  radius: number;
  monsters: Record<string, number>;
  players: string[];
}
function sameContext(
  report: FarmReport,
  o: FarmCompetitionObservation,
  area: FarmingArea,
  revision: number,
): boolean {
  return (
    !!o.runtimeId &&
    o.runtimeId === report.combatSelection?.runtimeId &&
    o.revision === revision &&
    o.areaId === area.id &&
    o.map === report.map &&
    o.map === area.map &&
    o.in === String(report.in ?? report.map) &&
    o.server === report.server
  );
}
function validObservation(o: FarmCompetitionObservation): boolean {
  return (
    Number.isFinite(o.radius) &&
    o.radius > 0 &&
    !!o.monsters &&
    Array.isArray(o.players) &&
    Object.values(o.monsters).every((n) => Number.isSafeInteger(n) && n >= 0)
  );
}
function fresh(
  report: FarmReport | undefined,
  area: FarmingArea,
  revision: number,
  now: number,
): boolean {
  const o = report?.farmCompetition;
  if (
    !report ||
    !o ||
    report.rip ||
    now - report.seenAt > 3000 ||
    now - o.at > 3000 ||
    o.at > now + 500
  )
    return false;
  return validObservation(o) && sameContext(report, o, area, revision);
}
/** Absence is established by every active member, never by a missing report. */
export function competitionHold(
  party: FarmNavigationState,
  ports: FarmNavigationPorts,
  names: string[],
  area: FarmingArea,
  ids: string[],
  actor: string,
  now: number,
): string | null {
  if (party.farmingPolicy === "hunt" && !huntSettings(party).relocateIfCompeting)
    return "Conflict relocation disabled in Hunt settings";
  const reports = names.map((name) => party.statuses[name]);
  if (
    !names.length ||
    reports.some((r, i) => !fresh(r, area, ports.intent(names[i]!).revision, now))
  )
    return "Waiting for fresh farming radius observations";
  const observations = reports.map((r) => r!.farmCompetition!);
  if (
    observations.some(
      (o, i) =>
        o.radius !== (Number(party.monsterSearchRadiusByCharacter?.[names[i]!]) || 400) ||
        o.server !== observations[0]!.server ||
        o.in !== observations[0]!.in,
    )
  )
    return "Waiting for matching farming radius observations";
  if (observations.some((o) => ids.some((id) => (o.monsters[id] || 0) > 0)))
    return "Sharing zone: hunt monsters remain within a party member’s radius";
  if (!observations.some((o) => o.players.includes(actor)))
    return "Competing farmer is no longer nearby";
  return null;
}
