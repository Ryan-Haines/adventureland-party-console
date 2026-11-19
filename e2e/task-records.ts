// The group owners' records for the live rows. Shared harness: the records row and the UP-1 rows read the same diagnostics.
import {expect,type LiveGame} from './live-fixtures';

export const groupOf=(read:any,name:string)=>read.groups.find((g:any)=>g.members.includes(name));
export const snapshotsOf=(read:any,group:string,trigger:string)=>(read.snapshots[group]??[]).filter((s:any)=>s.trigger===trigger).length;
const ask=(group:string,kind:string,owner:string,deadline?:number)=>({op:'request',args:[group,{kind,owner,...(deadline===undefined?{}:{deadline})}]});
// The fill and churn tasks carry a deadline, so only the planted tasks break invariant 1.
const bound=()=>Date.now()+600_000;

// The planted breaks that prove the per-tick check. No provider asks in this row, so the row drives
// the leader's group owner directly and ends every task it starts.
export async function taskRecords(live:LiveGame,leader:string,replies:()=>string[]){
  const group=`party:${leader}`;
  await expect.poll(async()=>groupOf(await live.tasks(),leader)?.id,{timeout:30_000}).toBe(group);
  const count=async(trigger:string)=>snapshotsOf(await live.tasks(),group,trigger);
  const before={churn:await count('churn'),failed:await count('task-failed'),safe:await count('safe-point')};
  // A live trip with no deadline, walk or due step, and a waiting Hunt with no expiry.
  live.expectTaskBreak('manual has no deadline, walk or due ladder step');
  live.expectTaskBreak('waiting hunt-mission e2e:f3 has no expiry');
  const [trip]=await live.taskOps([ask(group,'manual','e2e:f1')]);
  const [hunt]=await live.taskOps([ask(group,'hunt-mission','e2e:f3')]);
  expect([trip.status,hunt.status]).toEqual(['granted','waiting']);
  await expect.poll(async()=>{const read=await live.tasks();return [1,3].filter(n=>read.breaks.some((b:any)=>b.group===group&&b.invariant===n));},
    {timeout:30_000,message:'The task tick must record both planted breaks'}).toEqual([1,3]);
  await live.taskOps([{op:'release',args:[hunt]},{op:'release',args:[trip]}]);
  // 150 asks of the live identity fill the ring past its bound of 128; a kept ask is a decision.
  // The fill and churn tasks rank as add-on tasks (60), above the farming the party's own provider
  // asks from the tasks owner step 3c, so each one takes the group.
  const [fill]=await live.taskOps([ask(group,'addon:e2e','e2e:fill',bound())]);
  expect(fill.status).toBe('granted');
  const kept=await live.taskOps(Array.from({length:150},()=>ask(group,'addon:e2e','e2e:fill',bound())));
  expect(kept.every((handle:any)=>handle.status==='kept')).toBe(true);
  // Triggers 2 and 3 on the same task: the safe point rung (two failures with no alternative),
  // then an end with failed:<code>.
  await live.taskOps([{op:'fail',args:[fill,'e2e']},{op:'fail',args:[fill,'e2e']},{op:'release',args:[fill,'failed:e2e']}]);
  // Trigger 4: an identity that takes the group a second time with no progress since it
  // last held it loops, and writes one churn snapshot; distinct identities write none.
  for(let i=0;i<3;i++){const [handle]=await live.taskOps([ask(group,'addon:e2e','e2e:once:'+i,bound())]);await live.taskOps([{op:'release',args:[handle]}]);}
  for(let i=0;i<2;i++){const [handle]=await live.taskOps([ask(group,'addon:e2e','e2e:churn',bound())]);await live.taskOps([{op:'release',args:[handle]}]);}
  // Decided 2026-10-29: a member on Manual refuses a merchant visit under Carries on, and
  // under Follows me the merchant delivers where it stands (the Manual case).
  const member=groupOf(await live.tasks(),leader).members.find((n:string)=>n!==leader)??leader;
  const visits=await live.taskOps([{op:'allows',args:['merchant-visit',member]},
    {op:'hold',args:[member,'manual',{reason:'On Manual',party:'carries-on'}]},{op:'allows',args:['merchant-visit',member]},{op:'hold',args:[member,'manual',null]},
    {op:'hold',args:[member,'manual',{reason:'On Manual',party:'follows-me'}]},{op:'allows',args:['merchant-visit',member]},{op:'hold',args:[member,'manual',null]}]);
  expect([visits[0],visits[2],visits[5]],'idle, Carries on, Follows me').toEqual([true,false,true]);
  const read=await live.tasks(),ring=groupOf(read,leader).ring;
  expect(ring).toHaveLength(128);
  ring.forEach((entry:any,index:number)=>{expect(entry.part).toBe('tasks');if(index)expect(entry.seq).toBe(ring[index-1].seq+1);});
  expect({churn:snapshotsOf(read,group,'churn')-before.churn,failed:snapshotsOf(read,group,'task-failed')-before.failed,
    safe:snapshotsOf(read,group,'safe-point')-before.safe},'one snapshot per trigger').toEqual({churn:1,failed:1,safe:1});
  // The party's own provider holds it again once the row's tasks end (farming from step 3c).
  expect(groupOf(read,leader).live.owner,'the row ends every task it started').not.toMatch(/^e2e:/);
  // The ring reaches neither the dashboard state nor the heartbeat replies.
  expect(JSON.stringify(await live.state())).not.toContain('"part":"tasks"');
  expect(replies().length).toBeGreaterThan(0);
  for(const body of replies())expect(body).not.toContain('"part":"tasks"');
}

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
