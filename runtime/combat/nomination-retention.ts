import type {Fight,Member,Target} from './grouped.ts';
export interface Retention extends Target {eligible:boolean;reason?:string;at:number}

/** Absence needs every member's fresh observation; positive party sight wins. */
export function retainNominations(queue:Fight[],members:Member[],now:number):Fight[] {
  const fresh=(m:Member)=>!!m.status && now-m.status.seenAt<=3000;
  if(members.some(m=>fresh(m)&&m.status!.groupedCombat?.retentionPaused))return [];
  return queue.filter(t=>t.state==='planned').flatMap(t=>{
    const votes=members.map(m=>{
      const s=m.status;if(!s||!fresh(m)||s.server!==t.server||s.map!==t.map||s.in!==t.in)return undefined;
      return s.groupedCombat?.retentions?.find(v=>v.id===t.id&&v.map===t.map&&v.in===t.in&&now-v.at<=3000&&v.at<=now+500&&v.at>=t.startedAt);
    });
    const positive=votes.filter(v=>v?.eligible).sort((a,b)=>b!.at-a!.at)[0];
    if(positive)return [{...t,...positive}];
    if(votes.some(v=>v&&v.reason!=='not visible'))return [];
    if(votes.every(Boolean))return [];
    // Legacy clients cannot establish retention; upgraded missing observers hold it.
    return members.some(m=>m.status?.groupedCombat?.retentions)?[t]:[];
  });
}
