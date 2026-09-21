import type {Fight, Member} from './grouped.ts';
export interface LostTarget extends Fight {retiredAt:number;reason:string}
export interface SearchState {missingSince:number;coverageAt?:number;lastObservation?:number;unseenMs?:number;lastUnseenAt?:number}
export const targetIdentity=(t:{id:string;server?:string;map:string;in?:string|number})=>JSON.stringify([t.server,t.map,t.in,String(t.id)]);
/** Absence is evidence only after an actual entity observation near the last sighting. */
export function recoverLostTargets(fights:Fight[], members:Member[], previous:Record<string,SearchState>, now:number) {
 const searches:Record<string,SearchState>={},lost:LostTarget[]=[];
 for(const f of fights){
  const key=targetIdentity(f),same=members.filter(m=>m.status&&!m.status.rip&&m.status.hp>0&&now-m.status.seenAt<=3000&&m.status.server===f.server&&m.status.map===f.map&&m.status.in===f.in);
  const positive=same.some(m=>[...(m.status!.groupedCombat?.sightings||[]),...(m.status!.groupedCombat?.threats||[]),...(m.status!.groupedCombat?.currentAttackers||[])].some(t=>t.id===f.id&&t.map===f.map&&t.in===f.in)||
    (m.status!.groupedCombat?.evidence||[]).some(e=>targetIdentity(e)===key&&e.state!=='rejected'&&now-e.at<=3000));
  if(positive)continue;
  const search={...(previous[key]||{missingSince:now})};
  const observations=same.filter(m=>Math.hypot(m.status!.x-f.x,m.status!.y-f.y)<=180).map(m=>m.status!.groupedCombat?.observationAt||0).filter(at=>at>=search.missingSince&&now-at<=3000&&at<=now+500);
  const latest=Math.max(0,...observations);
  if(latest){search.coverageAt??=latest;search.lastObservation=Math.max(search.lastObservation||0,latest);}
  const everyoneObserved=members.length>0&&members.every(m=>m.status&&!m.status.rip&&m.status.hp>0&&now-m.status.seenAt<=3000&&m.status.seenAt<=now+500&&
    m.status.server===f.server&&m.status.map===f.map&&m.status.in===f.in&&(m.status.groupedCombat?.observationAt||0)>=search.missingSince&&now-(m.status.groupedCombat?.observationAt||0)<=3000);
  if(everyoneObserved&&now-search.missingSince>=8000&&search.coverageAt!==undefined&&(search.lastObservation||0)-search.coverageAt>=1000)
   lost.push({...f,retiredAt:now,reason:'bounded search exhausted with fresh local absence observations'});
  else searches[key]=search;
 }
 return {searches,lost};
}
