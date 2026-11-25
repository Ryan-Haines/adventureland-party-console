// The queue's lost and unseen targets:
// `recoverLostTargets` keeps its wall time since `missingSince` and its coverage
// span, and `releaseUnseenPrimary` keeps its accumulated `unseenMs`, as two functions.
import type { Fight, Member, Target } from './api.ts';
import { fresh, reportClockError, reportInterval } from '../../protocol/reports.ts';
import { pick } from '../../characters/targeting/saved-fields.ts';
import { targetIdentity } from '../../characters/targeting/rules.ts';

// `until`: an unreachable lock's failed-approach mark expiry, from the leader's notice (queue.ts).
export interface LostTarget extends Fight {retiredAt:number;reason:string;until?:number}
export interface SearchState {missingSince:number;coverageAt?:number;lastObservation?:number;unseenMs?:number;lastUnseenAt?:number}
/** Absence is evidence only after an actual entity observation near the last sighting. */
export function recoverLostTargets(fights:Fight[], members:Member[], previous:Record<string,SearchState>, now:number) {
 const searches:Record<string,SearchState>={},lost:LostTarget[]=[];
 for(const f of fights){
  const key=targetIdentity(f),same=members.filter(m=>m.status&&!m.status.rip&&m.status.hp>0&&fresh(m.status.seenAt,now)&&m.status.server===f.server&&m.status.map===f.map&&m.status.in===f.in);
  const positive=same.some(m=>[...(m.status!.groupedCombat?.sightings||[]),...(m.status!.groupedCombat?.threats||[]),...(m.status!.groupedCombat?.currentAttackers||[])].some(t=>t.id===f.id&&t.map===f.map&&t.in===f.in)||
    (m.status!.groupedCombat?.evidence||[]).some(e=>targetIdentity(e)===key&&e.state!=='rejected'&&fresh(e.at,now,'report',reportClockError(m.status))));
  if(positive)continue;
  const search={...(previous[key]||{missingSince:now})};
  const near=same.filter(m=>Math.hypot(m.status!.x-f.x,m.status!.y-f.y)<=pick('lostTargetRadius'));
  const observations=near.map(m=>m.status!.groupedCombat?.observationAt||0).filter((at,i)=>at>=search.missingSince&&fresh(at,now,'report',reportClockError(near[i]!.status)));
  const latest=Math.max(0,...observations);
  if(latest){search.coverageAt??=latest;search.lastObservation=Math.max(search.lastObservation||0,latest);}
  const everyoneObserved=members.length>0&&members.every(m=>m.status&&!m.status.rip&&m.status.hp>0&&fresh(m.status.seenAt,now)&&
    m.status.server===f.server&&m.status.map===f.map&&m.status.in===f.in&&(m.status.groupedCombat?.observationAt||0)>=search.missingSince&&fresh(m.status.groupedCombat?.observationAt||0,now,'report',reportClockError(m.status)));
  if(everyoneObserved&&now-search.missingSince>=pick('unseenGoneMs')&&search.coverageAt!==undefined&&(search.lastObservation||0)-search.coverageAt>=Math.max(...members.map(m=>reportInterval(m.status))))
   lost.push({...f,retiredAt:now,reason:'bounded search exhausted with fresh local absence observations'});
  else searches[key]=search;
 }
 return {searches,lost};
}

// A member the unseen release and the pursuit count: alive, not cancelled, owned by no event and on no
// travel command.
export function memberAvailable(member: Member): boolean {
  const s = member.status;
  if (!s || member.cancelled || s.rip || s.hp <= 0) return false;
  return !s.presence && !s.groupedCombat?.travelCommand;
}
function observed(member: Member, target: Fight, since: number, now: number): boolean {
  if (!memberAvailable(member)) return false;
  const s = member.status!, observation = s.groupedCombat?.observationAt || 0;
  return s.server === target.server && s.map === target.map && s.in === target.in &&
    fresh(s.seenAt, now) && fresh(observation, now, 'report', reportClockError(s)) && observation >= since;
}
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
  if (!elapsed(search, eligible, now, Math.max(...members.map(m => reportInterval(m.status)))) || !visibleAlternative(candidates, members)) return null;
  return {...fight, retiredAt:now, reason:"unseen primary released after bounded search; visible alternative available"};
}
// `sampleMs` caps one sample's credit at one report interval of the slowest member. A sample
// earns credit only while the one before it is still a fresh report (`reports.fresh`).
function elapsed(search: SearchState, eligible: boolean, now: number, sampleMs: number): boolean {
  const prior = search.lastUnseenAt;
  search.lastUnseenAt = eligible ? now : undefined;
  if (!eligible) return false;
  if (prior !== undefined && fresh(prior, now))
    search.unseenMs = (search.unseenMs || 0) + Math.min(sampleMs, Math.max(0, now - prior));
  return (search.unseenMs || 0) >= pick('unseenGoneMs');
}
