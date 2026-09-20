import type { Member, Target } from './grouped.ts';

export interface PassingEncounter extends Target { server?: string; at: number }
export const passingIdentity = (t: {server?:string;map:string;in?:string|number;id:string}) =>
  JSON.stringify([t.server,t.map,String(t.in ?? t.map),String(t.id)]);

/** Only actual, recently reported passing encounters suppress retaliation ownership. */
export function collectPassing(members: Member[], previous: PassingEncounter[], now: number): PassingEncounter[] {
  const result = new Map<string,PassingEncounter>();
  for (const entry of previous) if (now-entry.at < 60000 && entry.at <= now+500)
    result.set(passingIdentity(entry),entry);
  for (const member of members) {
    const s=member.status;
    if (!s || now-s.seenAt>3000 || s.seenAt>now+500) continue;
    for (const e of s.groupedCombat?.passingEncounters || []) {
      if (e.server!==s.server || e.map!==s.map || String(e.in??e.map)!==String(s.in??s.map) ||
          !Number.isFinite(e.at) || now-e.at>=60000 || e.at>now+500) continue;
      const key=passingIdentity(e), old=result.get(key);
      if (!old || old.at<e.at) result.set(key,e);
    }
  }
  return [...result.values()].sort((a,b)=>a.at-b.at).slice(-128);
}
