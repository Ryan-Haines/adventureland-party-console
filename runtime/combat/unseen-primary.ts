import type { Fight, Member, Target } from "./grouped.ts";
import { targetIdentity, type SearchState, type LostTarget } from "./lost-target.ts";

function available(member: Member): boolean {
  const s = member.status;
  if (!s || member.cancelled || s.rip || s.hp <= 0) return false;
  return !s.activeEvent && !s.joinedEvent && !s.mapEvent && !s.groupedCombat?.travelCommand;
}
function observed(member: Member, target: Fight, since: number, now: number): boolean {
  if (!available(member)) return false;
  const s = member.status!, observation = s.groupedCombat?.observationAt || 0;
  return s.server === target.server && s.map === target.map && s.in === target.in &&
    fresh(s.seenAt, now) && fresh(observation, now) && observation >= since;
}
function fresh(at: number, now: number): boolean { return now - at <= 3000 && at <= now + 500; }
function visibleAlternative(candidates: Fight[], members: Member[]): boolean {
  return candidates.some(t => members.some(m =>
    m.status?.groupedCombat?.sightings?.some(s => targetIdentity({...s, server:m.status!.server}) === targetIdentity(t))));
}

/** Release the queue obligation, not the monster's life, when bounded searching cannot regain sight. */
export function releaseUnseenPrimary(
  target: Target | null | undefined, fights: Fight[], candidates: Fight[], members: Member[],
  searches: Record<string, SearchState>, now: number, paused: boolean,
): LostTarget | null {
  const fight = fights.find(f => target && targetIdentity(f) === targetIdentity(target));
  if (!fight) return null;
  const search = searches[targetIdentity(fight)];
  // Sightings, current attackers, or fresh attack evidence remove the absence search upstream.
  if (!search) return null;
  const eligible = !paused && members.length > 0 && members.every(m => observed(m, fight, search.missingSince, now));
  if (!elapsed(search, eligible, now) || !visibleAlternative(candidates, members)) return null;
  return {...fight, retiredAt:now, reason:"unseen primary released after bounded search; visible alternative available"};
}
function elapsed(search: SearchState, eligible: boolean, now: number): boolean {
  const prior = search.lastUnseenAt;
  search.lastUnseenAt = eligible ? now : undefined;
  if (!eligible) return false;
  if (prior !== undefined && now - prior <= 3000)
    search.unseenMs = (search.unseenMs || 0) + Math.min(1000, Math.max(0, now - prior));
  return (search.unseenMs || 0) >= 8000;
}
