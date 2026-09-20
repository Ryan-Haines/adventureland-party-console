import type { Member } from '../../combat/grouped.ts';
import type { Status } from './rare-types.ts';

/** Patrol observations are combat nominations, even while client convoy gates are closed. */
export function phoenixCandidates(members: Member[], now: number): Member[] {
  return members.map(member => {
    const status = member.status;
    if (!status) return member;
    const observation = (status as unknown as Status).rareObservation;
    if (!observation || !validObservation(member, observation, now)) return member;
    const group = status.groupedCombat || {};
    const reported = (group.candidates || []).map(candidate => candidate.mtype === 'phoenix'
      ? {...candidate, priority:100.5, passiveRare:true} : candidate);
    const sightings = observation.sightings.filter(s => s.mtype === 'phoenix' && s.visible && s.hp > 0 &&
      Number.isFinite(s.x) && Number.isFinite(s.y)).map(s => ({...s,map:observation.map,in:observation.in,
        server:observation.server,priority:100.5,passiveRare:true}));
    return {...member,status:{...status,groupedCombat:{...group,candidates:[...reported,...sightings]}}};
  });
}
function validObservation(member: Member, o: NonNullable<Status['rareObservation']>, now: number): boolean {
  const s=member.status!;
  return Array.isArray(o.sightings) && Number.isFinite(o.at) && o.at >= now-3000 && o.at <= now+500 &&
    o.runtimeId === s.combatSelection?.runtimeId && o.map === s.map && o.in === String(s.in ?? s.map) && o.server === s.server;
}
