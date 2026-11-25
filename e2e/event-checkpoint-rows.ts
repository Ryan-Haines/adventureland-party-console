import {expect,type LiveGame} from './live-fixtures';
import type {Route,TestInfo} from '@playwright/test';
import {observeNativeTransport} from './native-transport-observer';
import {observeNativeStatus} from './native-status-observer';
import {taskSeq,taskTrail} from './task-records';
import {W,P,fighters,seedBoss,endEvent,type Boss} from './event-death-helpers';

// W27a's Halloween checkpoint plays (test-windows DESIGN.md 2.2 W27). Each starts with the party's
// walk to the checkpoint and seeds its own event bosses there.
const checkpoint={map:'halloween',x:-550,y:-290};
async function toCheckpoint(live:LiveGame){
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await live.post('/travel',checkpoint);
  await expect.poll(async()=>{const s=await live.state();return !s.activeConvoy&&fighters.every(name=>
    s.characters[name]?.map===checkpoint.map&&Math.hypot(s.characters[name].x-checkpoint.x,s.characters[name].y-checkpoint.y)<100);},{timeout:240_000,message:'The party must reach the Halloween checkpoint'}).toBe(true);
}

// T22's play, W27a's last round: a member left out of its party's event never walks to it and
// waits in Main where the party lands (UP-3). The priest's own trip during the event walk skips its
// occurrence (attendance-limits.ts `skipManualEventOccurrences`), the one way a follower, whose
// events are the leader's, is left out without a death limit.
export async function leftOutPlay(live:LiveGame,info:TestInfo){
  await toCheckpoint(live);
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const seed=await seedBoss(live,'checkpointPumpkin'),samples:any[]=[];
  let cleared=false;
  const sample=async()=>{const s=await live.state();samples.push({at:Date.now(),convoy:s.activeConvoy&&{phase:s.activeConvoy.phase,participants:s.activeConvoy.participants,activity:s.activeConvoy.walkingActivity},
    attendance:s.eventAttendance?.[P]?.mrpumpkin??null,characters:Object.fromEntries(fighters.map(n=>[n,{map:s.characters[n]?.map,x:Math.round(s.characters[n]?.x),y:Math.round(s.characters[n]?.y)}]))});
    if(samples.length>200)samples.splice(1,1);return s;};
  try{
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await expect.poll(async()=>{const s=await sample();return s.activeConvoy?.walkingActivity==='event'&&s.activeConvoy.participants.includes(P);},
      {timeout:120_000,message:'precondition: the event walk starts with the priest'}).toBe(true);
    // A player's move leaves only an occurrence the member already owns: its admission records the
    // session the leave reads (attendance.ts `manualOccurrenceParticipating`, as v1.5.0's
    // attendance-limits.ts). The walk lists the follower before its own report is admitted, so
    // the trip waits for the admission.
    await expect.poll(async()=>{const a=(await sample()).characters[P]?.eventAdmission;return a?.event==='mrpumpkin'&&a.allowed===true;},
      {timeout:60_000,message:'precondition: the priest is admitted to the occurrence'}).toBe(true);
    // The trip goes off Halloween, the Pumpkin's map, through its door to Spooky Town. A move to a
    // point on the map the member stands on keeps only an occurrence it attends (`playerMoved`,
    // A10), so the trip leaves the occurrence wherever the priest's walk to the event has reached.
    const trip=await live.admin(`output=(()=>{const door=G.maps.halloween.doors.find(d=>d[4]==='spookytown'),spawn=G.maps.spookytown.spawns[door[5]];
      return {map:'spookytown',x:spawn[0],y:spawn[1]};})()`);
    const joined=(await live.state()).characters[P]?.joinedEvent??null;
    await live.post('/command',{character:P,type:'character-travel',location:trip,label:'Player trip during the event walk'});
    samples.push({at:Date.now(),trip,joined});
    await expect.poll(async()=>{const s=await sample(),a=s.eventAttendance?.[P]?.mrpumpkin;return !!a&&!a.ended&&!!a.ignored;},
      {timeout:60_000,message:'precondition: the trip skips the priest\u2019s occurrence'}).toBe(true);
    // The priest's assignment stays the party's attendance, apart and waiting (rule 2.3.2).
    const task=async()=>live.clients[P].run('(()=>{const t=globalThis.partyTasks.assignment.memberTask();return t&&t.task;})()');
    await expect.poll(async()=>{const t=await task();return t&&[t.kind,t.apart??null,t.event??null];},{timeout:60_000,message:'the left-out priest keeps the attendance and waits'})
      .toEqual(['event-attendance','wait',null]);
    await expect.poll(async()=>(await sample()).eventAttendance?.[W]?.mrpumpkin?.attending===true,{timeout:180_000,message:'the warrior attends'}).toBe(true);
    // The priest stands in Main, and never joins the walk again or attends.
    await expect.poll(async()=>(await sample()).characters[P]?.map,{timeout:240_000,message:'the left-out priest goes to Main'}).toBe('main');
    // Attendance reads the member's map (attendance.ts `recordAttendance`, the report's `mapEvent`,
    // status/character/report.ts), and the trip starts on the Pumpkin's map, so the priest reads
    // attending until its walk leaves Halloween: in final-gate-closing9's pair run its first report
    // under the trip read attending for one second at (-550,-290). The count starts once the
    // ignored priest stands off Halloween.
    const ignoredAt=samples.find(y=>y.attendance?.ignored)!.at;
    const leftAt=samples.find(y=>y.at>ignoredAt&&y.characters?.[P]?.map&&y.characters[P].map!==checkpoint.map)?.at??Infinity;
    const after=samples.filter(x=>x.at>=leftAt);
    expect(after.filter(x=>x.attendance?.attending).length,'samples where the left-out priest attends').toBe(0);
    // F42 joins here (its setup is this left-out member): the event's end starts a return that
    // never lists the priest, and the priest's assignment is still its group's task throughout.
    await endEvent(live,'mrpumpkin');cleared=true;
    const kinds:any[]=[];
    await expect.poll(async()=>{const s=await live.state(),t=await task();kinds.push({kind:t?.kind??null,apart:t?.apart??null,listed:!!s.eventReturn?.participants?.includes(P)});
      return !!t&&t.kind!=='event-attendance';},{timeout:120_000,intervals:[500],message:'F42: after the event the priest has its group task'}).toBe(true);
    expect(kinds.filter(k=>!k.kind).length,'samples where the left-out priest has no task').toBe(0);
    expect(kinds.some(k=>k.listed),'samples where the return lists the left-out priest').toBe(false);
  }finally{
    await info.attach('event-rendezvous-left-out',{body:JSON.stringify({seed,samples:samples.slice(-60)}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    if(!cleared)await endEvent(live,'mrpumpkin');
  }
}

// W27's one play (test-windows DESIGN.md 2.2 W27): one checkpoint round that T16-T20 observe as
// its steps. From the Halloween checkpoint the party walks to a seeded Mr. Pumpkin with the
// priest's walk point moved (T20), turns to Mr. Green, leaves Green for Pumpkin (T16), splits with
// the priest on Green under a Pumpkin leader and follows again (T17), turns to Green once more and
// is deselected, so a real Green return walks the party to the checkpoint. An escape suspends that
// return and Resume picks it up (T19's escape half), and the coordinator restarts during the
// resumed return (T18, DESIGN.md 4.3: a real restart during a real return in place of the planted
// persisted return). Pumpkin then takes both with no return holding either, and its deselection
// walks both back to the checkpoint.
export async function checkpointRoundPlay(live:LiveGame,info:TestInfo){
  await toCheckpoint(live);
  const transport=await observeNativeTransport(live.clients[W].page);
  let status:Awaited<ReturnType<typeof observeNativeStatus>>|null=null;
  try{status=await observeNativeStatus(live.clients,fighters);}
  catch(error){await info.attach('native-status-observer-install-error',{body:String(error),contentType:'text/plain'});throw error;}
  const seeds:Record<string,Boss>={mrgreen:await seedBoss(live,'checkpointGreen'),mrpumpkin:await seedBoss(live,'checkpointPumpkin')};
  const hits=async(name:string,event:string,after=0)=>live.clients[name].frame.evaluate(({name,id,after})=>
    ((window as any).__e2eEvents || []).some((packet:any)=>packet.event==='hit'&&String(packet.data?.id)===id&&
      packet.data?.hid===name&&packet.data?.damage>0&&packet.at>=after),{name,id:seeds[event].id,after});
  const samples:any[]=[],steps:any[]=[],submissions:any[]=[];
  const step=(name:string)=>{steps.push({at:Date.now(),name});return Date.now();};
  const noReturnHolds=(s:any)=>fighters.every(name=>!s.eventReturn?.participants?.includes(name))&&
    !Object.values(s.farmingProfiles||{}).some((profile:any)=>profile.eventReturn?.participants?.some((name:string)=>fighters.includes(name)));
  const bothOnPumpkin=async(after:number)=>{
    const s=await live.state(),damaged=await Promise.all(fighters.map(name=>hits(name,'mrpumpkin',after)));
    samples.push({at:Date.now(),return:s.eventReturn,convoy:s.activeConvoy&&{purpose:s.activeConvoy.purpose,activity:s.activeConvoy.walkingActivity,phase:s.activeConvoy.phase,participants:s.activeConvoy.participants},
      characters:Object.fromEntries(fighters.map(name=>[name,{map:s.characters[name]?.map,event:s.characters[name]?.joinedEvent}]))});
    if(samples.length>200)samples.splice(1,1);
    return damaged.every(Boolean)&&noReturnHolds(s);
  };
  // The return walk is the event-return convoy that both members walk.
  const returning=(s:any)=>(s.activeConvoy?.purpose==='event-return'||s.activeConvoy?.walkingActivity==='event-return')&&
    fighters.every(name=>s.activeConvoy.participants.includes(name));
  const context=live.clients[W].page.context();
  // T20: a boss that moved between two members' requests, each froze its own point.
  let moving=true;
  const moved=async(route:Route)=>{
    const body=route.request().method()==='POST'?route.request().postDataJSON():null;
    if(!moving||body?.character!==P||body.activity!=='event'||body.key!=='mrpumpkin')return route.fallback();
    submissions.push({at:Date.now(),cancel:!!body.cancel,destination:body.destination});
    await route.fallback({postData:JSON.stringify({...body,destination:{...body.destination,x:body.destination.x+40}})});
  };
  await context.route('**/party-api/shared-travel',moved);
  try{
    step('T20 walk to Pumpkin with a moved destination');
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await expect.poll(async()=>{const s=await live.state();
      return s.activeConvoy?.walkingActivity==='event'&&s.activeConvoy.walkingEvent==='mrpumpkin'&&fighters.every(n=>s.activeConvoy.participants.includes(n));
    },{timeout:120_000,message:'The event walk must start within the rendezvous window'}).toBe(true);
    await expect.poll(async()=>{const s=await live.state();return fighters.every(n=>s.eventAttendance?.[n]?.mrpumpkin?.attending===true);},
      {timeout:180_000,message:'The walkers must join the boss fight'}).toBe(true);
    moving=false;
    // T16's start: both on Green.
    // The first Green hits of the play, so the read needs no start time.
    step('Green');
    await live.post('/formation',{character:W,eventSelections:['mrgreen']});
    await expect.poll(async()=>Promise.all(fighters.map(name=>hits(name,'mrgreen'))).then(values=>values.every(Boolean)),{timeout:120_000}).toBe(true);
    const leaving=step('T16 leaving Green');
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await expect.poll(()=>bothOnPumpkin(leaving),{timeout:120_000,message:'Both native fighters must damage Pumpkin without an active return holding either member'}).toBe(true);
    const split=step('T17 split: the priest on Green under a Pumpkin leader');
    await live.post('/formation',{character:P,follow:false,eventSelections:['mrgreen']});
    await expect.poll(async()=>await hits(W,'mrpumpkin',split)&&await hits(P,'mrgreen',split),{timeout:120_000,message:'The warrior must damage Pumpkin and the priest Green'}).toBe(true);
    const following=step('T17 following the Pumpkin leader');
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(()=>bothOnPumpkin(following),{timeout:120_000,message:'Both native fighters must damage Pumpkin without an active return holding either member'}).toBe(true);
    const back=step('Green again');
    await live.post('/formation',{character:W,eventSelections:['mrgreen']});
    await expect.poll(async()=>Promise.all(fighters.map(name=>hits(name,'mrgreen',back))).then(values=>values.every(Boolean)),{timeout:120_000,message:'Both fighters must damage Green'}).toBe(true);
    step('T19 the Green return, an escape and Resume');
    await live.post('/formation',{character:W,eventSelections:[]});
    await expect.poll(async()=>returning(await live.state()),{timeout:60_000,message:'The deselection must start the Green return with both members'}).toBe(true);
    await info.attach('active-checkpoint-return-before-handoff',{body:JSON.stringify(await live.state()),contentType:'application/json'});
    const group=`party:${W}`,from=await taskSeq(live,group);
    await live.post('/escape',{});
    await expect.poll(async()=>(await taskTrail(live,group,from)).trail.some(([d,k,by])=>d==='suspended'&&k==='event-return'&&by==='escape'),
      {timeout:30_000,message:'The escape suspends the event return'}).toBe(true);
    expect(returning(await live.state()),'no event return walk under the escape').toBe(false);
    await live.post('/escape/resume',{});
    await expect.poll(async()=>(await taskTrail(live,group,from)).trail.some(([d,k])=>d==='resumed'&&k==='event-return'),
      {timeout:60_000,message:'The event return resumes after the escape'}).toBe(true);
    await expect.poll(async()=>returning(await live.state()),{timeout:60_000,message:'The resumed return must walk both members'}).toBe(true);
    step('T18 restart during the return');
    const cycle=(await live.state()).eventReturn?.cycleId;
    expect(cycle,'precondition: the return is live before the restart').toBeTruthy();
    await live.restartCoordinator();
    const restarted=Date.now();
    await expect.poll(async()=>{const s=await live.state();return fighters.every(name=>
      s.characters[name]?.seenAt>restarted&&s.eventReturn?.participants?.includes(name));},{timeout:30_000,message:'The restored return must list both members'}).toBe(true);
    expect((await live.state()).eventReturn?.cycleId,'the restart keeps the cycle of the return').toBe(cycle);
    const pumpkin=step('Pumpkin after the restored return');
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await expect.poll(()=>bothOnPumpkin(pumpkin),{timeout:120_000,message:'Both native fighters must damage Pumpkin without an active return holding either member'}).toBe(true);
    await info.attach('active-return-handoff-combat',{body:JSON.stringify({seeds,steps,samples:samples.slice(-60),submissions,state:await live.state()}),contentType:'application/json'});
    step('back to the checkpoint');
    await live.post('/formation',{character:W,eventSelections:[]});
    await expect.poll(async()=>{const s=await live.state();return !s.eventReturn&&fighters.every(name=>
      s.characters[name]?.map===checkpoint.map&&!s.characters[name]?.joinedEvent&&Math.hypot(s.characters[name].x-checkpoint.x,s.characters[name].y-checkpoint.y)<100);},
      {timeout:240_000,message:'After Pumpkin attendance, both fighters must actually return to their saved navigation checkpoint'}).toBe(true);
  }finally{
    moving=false;
    await context.unroute('**/party-api/shared-travel',moved);
    await info.attach('active-return-handoff-final',{body:JSON.stringify({steps,samples:samples.slice(-60),submissions,state:await live.state()}),contentType:'application/json'});
    await info.attach('native-event-http-transport',{body:JSON.stringify(await transport.finish()),contentType:'application/json'});
    if(status)await info.attach('native-event-status-metadata',{body:JSON.stringify(await status.finish()),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.post('/formation',{character:P,follow:true,eventSelections:[]}).catch(()=>{});
    for(const type of ['mrgreen','mrpumpkin'])await endEvent(live,type);
  }
}
