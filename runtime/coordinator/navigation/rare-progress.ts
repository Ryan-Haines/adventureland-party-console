import type {Encounter,Status} from './rare-types.ts';
import type {ApproachReport} from '../../combat/pursuit.ts';
function valid(e:Encounter,s:Status,now:number):boolean {
  const a=s.groupedCombat?.approach;
  if(!a?.active || now-s.seenAt>3000 || now-a.at>3000 || a.at>now+500)return false;
  return a.target===JSON.stringify([s.server,e.target.map,e.target.in,e.target.id]);
}
function progress(old:NonNullable<Encounter['approachSamples']>[string],s:Status,a:ApproachReport):boolean {
  if(Math.hypot(s.x-old.x,s.y-old.y)<2)return false;
  if(old.deficit-a.deficit>=8)return true;
  return !!old.waypoint && old.waypoint.key===a.waypoint?.key && old.waypoint.remaining-a.waypoint.remaining>=8;
}
export function refreshRareApproach(e:Encounter,statuses:Status[],now:number):void {
  const samples=e.approachSamples ||= {};
  for(const [i,s] of statuses.entries()) {
    if(!s || !valid(e,s,now))continue;
    const a=s.groupedCombat!.approach!, old=samples[i];
    if(old && !progress(old,s,a))continue;
    if(old)e.progress=now;
    samples[i]={x:s.x,y:s.y,deficit:a.deficit,waypoint:a.waypoint};
  }
}
