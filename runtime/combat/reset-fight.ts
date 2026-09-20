import type {Fight, Member, Target} from './grouped.ts';
import type {ClaimState} from './claims.ts';
import {targetIdentity} from './lost-target.ts';
function reports(members: Member[], fight: Fight, now: number): Member[] {
  return members.filter(m => m.status && !m.status.rip && m.status.hp > 0 && now-m.status.seenAt <= 3000 &&
    m.status.server === fight.server && m.status.map === fight.map && m.status.in === fight.in);
}
function same(target: Target, fight: Fight): boolean {return target.id === fight.id && target.map === fight.map && target.in === fight.in;}
function active(member: Member, fight: Fight, now: number): boolean {
  const g = member.status!.groupedCombat;
  return !!g?.threats?.some(t => same(t,fight)) || !!g?.currentAttackers?.some(t => same(t,fight)) ||
    !!g?.evidence?.some(e => targetIdentity(e) === targetIdentity(fight) && (e.state === 'pending' || e.state === 'engaged' && now-e.at < 5000));
}
function reset(sight: Target): boolean {
  return sight.target === null && Number(sight.hp) > 0 && Number(sight.max_hp) > 0 && sight.hp === sight.max_hp;
}
/** An explicitly neutral, fully healed monster is no longer an unfinished fight. */
export function releaseResetFights(fights: Fight[], members: Member[], claims: ClaimState[], now: number): ClaimState[] {
  const result = claims.slice();
  for (const fight of fights) {
    if (fight.state !== 'engaged' || now-fight.startedAt < 5000) continue;
    const live = reports(members,fight,now);
    if (!live.length || live.some(m => active(m,fight,now))) continue;
    const sightings = live.flatMap(m => m.status!.groupedCombat?.sightings || []).filter(t => same(t,fight));
    if (![sightings.length > 0, sightings.every(reset)].every(Boolean)) continue;
    const index = result.findIndex(c => targetIdentity(c) === targetIdentity(fight));
    if (index >= 0 && result[index]!.external) continue;
    const release: ClaimState = {id:fight.id,map:fight.map,in:fight.in,server:fight.server!,at:now,external:false,releasedAt:now};
    if (index >= 0) result[index] = release; else result.push(release);
  }
  return result;
}
