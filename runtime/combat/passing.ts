import type { Member, Target } from './grouped.ts';

export interface PassingEncounter extends Target { server?: string; at: number; startedAt?: number; reserved?: boolean; admission?: {scope: string; token: string} }
export const passingIdentity = (t: {server?:string;map:string;in?:string|number;id:string}) =>
  JSON.stringify([t.server,t.map,String(t.in ?? t.map),String(t.id)]);

const recent = (at:number,now:number,age=60000) => Number.isFinite(at) && now-at<age && at<=now+500;
function sameLocation(e:PassingEncounter,s:NonNullable<Member['status']>):boolean {
  return e.server===s.server && e.map===s.map && String(e.in??e.map)===String(s.in??s.map);
}
function memberReservations(member:Member,now:number):PassingEncounter[] {
  const s=member.status;
  if(!s || !recent(s.seenAt,now,3001))return [];
  return (s.groupedCombat?.passingEncounters||[]).filter(e=>sameLocation(e,s) && recent(e.at,now));
}
/** Exact, recent encounter reservations suppress retaliation ownership. */
export function collectPassing(members: Member[], previous: PassingEncounter[], now: number): PassingEncounter[] {
  const result = new Map<string,PassingEncounter>();
  const reservationKey=(e:PassingEncounter)=>JSON.stringify([passingIdentity(e),e.admission?.token]);
  const deaths=members.flatMap(m=>m.status?.groupedCombat?.deaths||[]);
  for (const entry of previous) if (recent(entry.at,now))
    result.set(reservationKey(entry),entry);
  for (const member of members) {
    for (const e of memberReservations(member,now)) {
      const key=reservationKey(e), old=result.get(key);
      if (!old || old.at<e.at) result.set(key,e);
    }
  }
  return [...result.values()].filter(e=>!deaths.some(d=>passingIdentity(d)===passingIdentity(e) &&
    d.at>=(e.startedAt??e.at))).sort((a,b)=>a.at-b.at).slice(-128);
}
