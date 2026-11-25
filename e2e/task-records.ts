// The group owners' records for the live rows. Shared harness: the records row and the UP-1 rows read the same diagnostics.
import {expect,type LiveGame} from './live-fixtures';

export const groupOf=(read:any,name:string)=>read.groups.find((g:any)=>g.members.includes(name));
export const snapshotsOf=(read:any,group:string,trigger:string)=>(read.snapshots[group]??[]).filter((s:any)=>s.trigger===trigger).length;

// Section 6 trigger 1 for a death the heartbeat reports: the dead member's group ring names it
// once, and its group writes one death snapshot per death it names.
export async function taskDeathBaseline(live:LiveGame,name:string){
  const read=await live.tasks(),group=groupOf(read,name);
  return {group:group.id,seq:group.ring.at(-1)?.seq??0,deaths:snapshotsOf(read,group.id,'death')};
}
export async function expectTaskDeath(live:LiveGame,name:string,base:{group:string;seq:number;deaths:number}){
  const died=async()=>{const read=await live.tasks(),group=read.groups.find((g:any)=>g.id===base.group);
    return {named:(group?.ring??[]).filter((e:any)=>e.seq>base.seq&&e.decision==='died').map((e:any)=>e.by),snapshots:snapshotsOf(read,base.group,'death')-base.deaths};};
  await expect.poll(async()=>(await died()).named.filter((n:string)=>n===name).length,{timeout:30_000,message:'The group ring names the death once'}).toBe(1);
  const seen=await died();
  expect(seen.snapshots,'one death snapshot per death the ring names').toBe(seen.named.length);
}

// The task decisions a group made after `seq` (its ring, section 6), as [decision, kind, code or
// by], for the providers' rows of the tasks owner step 3. Labels are not decisions, so a provider that asks
// every report adds nothing here while its task stands.
export async function taskTrail(live:LiveGame,group:string,seq:number):Promise<{live:string|undefined;trail:[string,string,string][]}>{
  const read=await live.tasks(),g=read.groups.find((x:any)=>x.id===group);
  return {live:g?.live?.kind as string|undefined,trail:(g?.ring??[]).filter((e:any)=>e.seq>seq&&e.kind!=='idle'&&e.decision!=='kept')
    .map((e:any)=>[e.decision,e.kind,e.code??e.by??''] as [string,string,string])};
}
export const taskSeq=async(live:LiveGame,group:string)=>((await live.tasks()).groups.find((x:any)=>x.id===group)?.ring.at(-1)?.seq??0) as number;

// The group's ring entries after `seq`, with their coordinator times (`at`).
export async function ringFrom(live:LiveGame,group:string,seq:number):Promise<any[]>{
  return ((await live.tasks()).groups.find((x:any)=>x.id===group)?.ring??[]).filter((e:any)=>e.seq>seq);
}
// The party's walks as the coordinator starts them, read from the active convoy while the row
// runs. A convoy's id carries its start on the coordinator's clock (runtime/movement/coordinator/walk.ts
// `start`: "convoy-<now>-<n>"), the clock the ring's `at` uses; the leader's combat log keeps
// only its last 200 entries, so formation lines push the start record out.
export function convoyWatch(live:LiveGame){
  const seen=new Map<string,any>();let running=true;
  const loop=(async()=>{while(running){
    const c=(await live.state().catch(()=>null))?.activeConvoy;
    if(c?.id&&!seen.has(c.id))seen.set(c.id,{id:c.id,startedAt:Number(String(c.id).split('-')[1]),label:c.label,purpose:c.purpose,
      requester:c.requester,walkingActivity:c.walkingActivity,walkingEvent:c.walkingEvent,huntTarget:c.huntTarget});
    else if(c?.id){const k=seen.get(c.id);k.walkingActivity??=c.walkingActivity;k.walkingEvent??=c.walkingEvent;}
    await new Promise(r=>setTimeout(r,100));
  }})();
  return {walks:()=>[...seen.values()],async stop(){running=false;await loop;return [...seen.values()];}};
}
// One coordinator tick: the owner ticks once per status report (application.ts `askProviders`),
// so a tick is at most the slowest member's report interval.
export async function reportTick(live:LiveGame):Promise<number>{
  const intervals=Object.values((await live.state()).characters??{}).map((c:any)=>Number(c?.reportIntervalMs)).filter(n=>n>0);
  if(!intervals.length)throw Error('No member reports its report interval');
  return Math.max(...intervals);
}
