import type { Member, Target } from './grouped.ts';

export interface PassingEncounter extends Target { server?: string; at: number; startedAt?: number; reserved?: boolean;
  /** Explicit passive keep-moving reservation; retaliation cannot acquire travel ownership. */
  keepMoving?: boolean;
  admission?: {scope: string; token: string} }
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
function latestReservations(members: Member[], previous: PassingEncounter[], now: number): Map<string,PassingEncounter> {
  const result = new Map<string,PassingEncounter>();
  const reservationKey=(e:PassingEncounter)=>JSON.stringify([passingIdentity(e),e.admission?.token]);
  for (const entry of previous) if (recent(entry.at,now))
    result.set(reservationKey(entry),entry);
  for (const member of members) {
    for (const e of memberReservations(member,now)) {
      const key=reservationKey(e), old=result.get(key);
      if (!old || old.at<e.at) result.set(key,e);
    }
  }
  return result;
}
// Responses call collectPassing twice per report and most reports carry no encounter, so
// collectPassing reads the death lists only when an encounter needs them, once per call.
function deathTimes(encounters: PassingEncounter[], members: Member[]): Map<string,number[]> {
  const times=new Map<string,number[]>(encounters.map(e=>[passingIdentity(e),[]]));
  for (const member of members)
    for (const d of member.status?.groupedCombat?.deaths||[]) times.get(passingIdentity(d))?.push(d.at);
  return times;
}
/** Exact, recent encounter reservations suppress retaliation ownership. */
export function collectPassing(members: Member[], previous: PassingEncounter[], now: number): PassingEncounter[] {
  const encounters=[...latestReservations(members,previous,now).values()];
  if (!encounters.length) return [];
  const deaths=deathTimes(encounters,members);
  return encounters.filter(e=>!deaths.get(passingIdentity(e))!.some(at=>at>=(e.startedAt??e.at)))
    .sort((a,b)=>a.at-b.at).slice(-128);
}
