import type { Target } from "../../combat/grouped.ts";
import type { HuntCycle, HuntStatus, HuntTickPorts, HuntTickState } from "./contracts.ts";

function identity(t: Pick<Target, "id" | "map" | "in">, server?: string): string {
  return JSON.stringify([server, t.map, String(t.in ?? t.map), t.id]);
}

/** Candidates have passed the observing character's eligibility checks; sightings alone cannot authorize a pull. */
export function nearbyHuntTarget(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): (Target & { server: string }) | undefined {
  const now = ports.now(), lead = state.statuses[String(state.leader)];
  const invalid = excludedTargets(hunt, state, now);
  for (const name of hunt.participants) {
    const s = state.statuses[name];
    if (!available(s, lead, now)) continue;
    for (const target of s.groupedCombat?.candidates || []) {
      if (ports.intent(name).cancelled) continue;
      if (eligible(target, hunt.target, s, Number(state.monsterSearchRadiusByCharacter[name]) || 400) && !invalid.has(identity(target, s.server)))
        return { ...target, server: s.server! };
    }
  }
}

function available(s: HuntStatus | undefined, lead: HuntStatus | undefined, now: number): s is HuntStatus {
  return !!s && !!lead && !!s.server && !s.rip && s.hp !== 0 && now - s.seenAt <= 3000 && s.seenAt <= now + 500 &&
    samePlace(s, lead) && !event(s);
}
function event(s: HuntStatus): boolean { return !!(s.activeEvent || s.joinedEvent); }
function samePlace(s: HuntStatus, lead: HuntStatus): boolean {
  return s.server === lead.server && s.map === lead.map && String(s.in ?? s.map) === String(lead.in ?? lead.map);
}
function eligible(t: Target, type: string | null, s: HuntStatus, radius: number): boolean {
  return t.mtype === type && t.hp !== 0 && t.map === s.map && String(t.in ?? t.map) === String(s.in ?? s.map) &&
    Math.hypot(t.x - s.x, t.y - s.y) <= radius;
}
function excludedTargets(hunt: HuntCycle, state: HuntTickState, now: number): Set<string> {
  const deaths = [...state.groupedCombat?.deaths || [], ...hunt.participants.flatMap(n => state.statuses[n]?.groupedCombat?.deaths || [])];
  const claims = hunt.participants.flatMap(n => state.statuses[n]?.groupedCombat?.claims || []);
  return new Set([...deaths, ...claims.filter(c => c.external && now - c.at <= 3000)].map(t => identity(t, t.server)));
}
