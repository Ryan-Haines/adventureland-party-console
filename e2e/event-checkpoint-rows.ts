import {expect,type LiveGame} from './live-fixtures';
import type {Route,TestInfo} from '@playwright/test';
import type {Row} from './scenario-table';
import {observeNativeTransport} from './native-transport-observer';
import {observeNativeStatus} from './native-status-observer';
import {taskSeq,taskTrail} from './task-records';
import {W,P,fighters,seedBoss,endEvent,type Boss} from './event-death-helpers';

// The Halloween checkpoint rows, moved in the tasks owner step 8 (the test cut) from
// live-event-return-handoff.spec.ts and live-event-rendezvous.spec.ts into the default fixture's
// table. Each row starts with the party's walk to the checkpoint, where those files' fixtures
// logged the party in, and seeds its own event bosses there.
const checkpoint={map:'halloween',x:-550,y:-290};
async function toCheckpoint(live:LiveGame){
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await live.post('/travel',checkpoint);
  await expect.poll(async()=>{const s=await live.state();return !s.activeConvoy&&fighters.every(name=>
    s.characters[name]?.map===checkpoint.map&&Math.hypot(s.characters[name].x-checkpoint.x,s.characters[name].y-checkpoint.y)<100);},{timeout:240_000,message:'The party must reach the Halloween checkpoint'}).toBe(true);
}

// The native transport observer watches the two variants whose return leaves through a door;
// the status observer watches all four.
async function handoff(live:LiveGame,info:TestInfo,variant:'leaving Green'|'following a Pumpkin leader'|'restoring a held Green return'|'interrupting a checkpoint return'){
  const transport=['leaving Green','following a Pumpkin leader'].includes(variant)?await observeNativeTransport(live.clients[W].page):null;
  let status:Awaited<ReturnType<typeof observeNativeStatus>>|null=null;
  try{status=await observeNativeStatus(live.clients,fighters);}
  catch(error){await info.attach('native-status-observer-install-error',{body:String(error),contentType:'text/plain'});throw error;}
  try{await handoffBody(live,info,variant);}
  finally{
    if(transport)await info.attach('native-event-http-transport',{body:JSON.stringify(await transport.finish()),contentType:'application/json'});
    await info.attach('native-event-status-metadata',{body:JSON.stringify(await status.finish()),contentType:'application/json'});
  }
}
async function handoffBody(live:LiveGame,info:TestInfo,variant:string){
  // Failure inventory: docs/testing-event-return-handoff.md. Initial native
  // monsters are declared inputs; damage, commands and return arrival are real.
  const seeds:Record<string,Boss>={mrgreen:await seedBoss(live,'checkpointGreen'),mrpumpkin:await seedBoss(live,'checkpointPumpkin')};
  const samples:any[]=[];
  const hits=async(name:string,event:string,after=0)=>live.clients[name].frame.evaluate(({name,id,after})=>
    ((window as any).__e2eEvents || []).some((packet:any)=>packet.event==='hit'&&String(packet.data?.id)===id&&
      packet.data?.hid===name&&packet.data?.damage>0&&packet.at>=after),{name,id:seeds[event].id,after});
  try{
    if(variant!=='following a Pumpkin leader'){
      await live.post('/formation',{character:W,eventSelections:['mrgreen']});
      await expect.poll(async()=>Promise.all(fighters.map(name=>hits(name,'mrgreen'))).then(values=>values.every(Boolean)),{timeout:120_000}).toBe(true);
    }else{
      await live.post('/formation',{character:P,follow:false,eventSelections:['mrgreen']});
      await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
      await expect.poll(async()=>await hits(W,'mrpumpkin')&&await hits(P,'mrgreen'),{timeout:120_000}).toBe(true);
    }
    const transitionAt=Date.now();
    // Follow remains enabled after attendance. Its event rendezvous is not a
    // new independent farm: both members must return to the saved party farm.
    const checkpoints=Object.fromEntries(fighters.map(name=>[name,checkpoint]));
    if(variant==='restoring a held Green return'||variant==='interrupting a checkpoint return'){
      // Declare the persisted failure state, never a successful exit or hit.
      // Its dispatched timestamp must not strand an empty recovery.
      await live.restoreHistoricalSettings(settings=>{
        const profile=settings.farmingProfiles[W];
        const waypoints=Object.fromEntries(fighters.map(name=>[name,{revision:settings.navigationIntents?.[name]?.revision||0,location:checkpoint}]));
        const recovery={cycleId:'historical-active-green-return',event:'mrgreen',participants:fighters,pending:fighters,
          startedAt:Date.now(),phase:'evacuating',checkpoint,waypoints,deferred:[],
          ...(variant==='restoring a held Green return'?{returnDispatchedAt:Date.now()}:{})};
        return {eventReturn:recovery,activeConvoy:null,farmingProfiles:{...settings.farmingProfiles,[W]:{...profile,eventReturn:recovery,activeConvoy:null}},
          eventSelectionsByCharacter:{...settings.eventSelectionsByCharacter,[W]:variant==='restoring a held Green return'?['mrgreen']:[]}};
      });
      if(variant==='restoring a held Green return'){
        // A globally live but disabled Pumpkin must not release this return.
        await expect.poll(async()=>{const s=await live.state();return fighters.every(name=>
          s.characters[name]?.seenAt>transitionAt&&s.eventReturn?.participants?.includes(name));},{timeout:15_000}).toBe(true);
      }else{
        // Wait for actual Town exits and an admitted native checkpoint convoy.
        await expect.poll(async()=>{const s=await live.state();return s.activeConvoy?.purpose==='event-return'&&
          fighters.every(name=>s.activeConvoy.participants.includes(name));},{timeout:60_000}).toBe(true);
        await info.attach('active-checkpoint-return-before-handoff',{body:JSON.stringify(await live.state()),contentType:'application/json'});
        // An escape suspends the event return, which walks no further while the
        // escape holds the party, and resumes from its record once the player resumes.
        const group=`party:${W}`,from=await taskSeq(live,group);
        await live.post('/escape',{});
        await expect.poll(async()=>(await taskTrail(live,group,from)).trail.some(([d,k,by])=>d==='suspended'&&k==='event-return'&&by==='escape'),
          {timeout:30_000,message:'The escape suspends the event return'}).toBe(true);
        expect((await live.state()).activeConvoy?.purpose??null,'no event return walk under the escape').not.toBe('event-return');
        await live.post('/escape/resume',{});
        await expect.poll(async()=>(await taskTrail(live,group,from)).trail.some(([d,k])=>d==='resumed'&&k==='event-return'),
          {timeout:60_000,message:'The event return resumes after the escape'}).toBe(true);
        // A Hunt turn-in and a death recovery each take the return's walk and suspend the
        // return: its record stays, it walks no further while either holds the party, and it
        // resumes once that task ends. No Hunt or death runs at the checkpoint, so the row asks
        // each task on the party's group the way their providers do (`/e2e-tasks`).
        for(const kind of ['hunt-turn-in','death-recovery']){
          const at=await taskSeq(live,group),cycle=(await live.state()).eventReturn?.cycleId;
          expect(cycle,`precondition: the return is live before the ${kind}`).toBeTruthy();
          const [handle]=await live.taskOps([{op:'request',args:[group,{kind,owner:`e2e:f19:${kind}`,deadline:Date.now()+600_000}]}]);
          expect(handle.status,`the ${kind} takes the party`).toBe('granted');
          await expect.poll(async()=>(await taskTrail(live,group,at)).trail.some(([d,k,by])=>d==='suspended'&&k==='event-return'&&by===kind),
            {timeout:30_000,message:`The ${kind} suspends the event return`}).toBe(true);
          await expect.poll(async()=>(await live.state()).activeConvoy?.purpose??null,{timeout:30_000,message:`no event return walk under the ${kind}`}).not.toBe('event-return');
          const held=await live.state();
          expect(held.eventReturn?.cycleId,`the ${kind} keeps the return's record`).toBe(cycle);
          await live.taskOps([{op:'release',args:[handle]}]);
          await expect.poll(async()=>(await taskTrail(live,group,at)).trail.some(([d,k])=>d==='resumed'&&k==='event-return'),
            {timeout:60_000,message:`The event return resumes after the ${kind}`}).toBe(true);
          expect((await taskTrail(live,group,at)).trail.filter(([d,k])=>d==='ended'&&k==='event-return'),`the ${kind} never ends the return`).toEqual([]);
        }
      }
      await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    }else if(variant==='leaving Green') await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    else await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>{
      const s=await live.state(),damaged=await Promise.all(fighters.map(name=>hits(name,'mrpumpkin',transitionAt)));
      samples.push({at:Date.now(),return:s.eventReturn,profiles:s.farmingProfiles,commands:s.pendingCommands,
        characters:Object.fromEntries(fighters.map(name=>[name,{map:s.characters[name]?.map,event:s.characters[name]?.joinedEvent}]))});
      if(samples.length>64)samples.shift();
      return damaged.every(Boolean)&&fighters.every(name=>!s.eventReturn?.participants?.includes(name))&&
        !Object.values(s.farmingProfiles||{}).some((profile:any)=>profile.eventReturn?.participants?.some((name:string)=>fighters.includes(name)));
    },{timeout:120_000,message:'Both native fighters must damage Pumpkin without an active return holding either member'}).toBe(true);
    const fighting=await live.state();
    await info.attach('active-return-handoff-combat',{body:JSON.stringify({variant,seeds,checkpoints,samples,state:fighting,events:await live.clients[W].events()}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await expect.poll(async()=>{const s=await live.state();return !s.eventReturn&&fighters.every(name=>
      s.characters[name]?.map===checkpoints[name].map&&!s.characters[name]?.joinedEvent&&Math.hypot(s.characters[name].x-checkpoints[name].x,s.characters[name].y-checkpoints[name].y)<100);},{timeout:240_000,message:'After Pumpkin attendance, both fighters must actually return to their saved navigation checkpoint'}).toBe(true);
  }finally{
    await info.attach('active-return-handoff-final',{body:JSON.stringify({variant,samples,state:await live.state(),events:await Promise.all(fighters.map(name=>live.clients[name].events()))}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.post('/formation',{character:P,eventSelections:[]}).catch(()=>{});
    for(const type of ['mrgreen','mrpumpkin'])await endEvent(live,type);
  }
}
export const handoffRows:Row[]=(['leaving Green','following a Pumpkin leader','restoring a held Green return','interrupting a checkpoint return'] as const)
  .map(variant=>[`active event return hands off when ${variant}`,async(live,info)=>{await toCheckpoint(live);await handoff(live,info,variant);}]);

export const rendezvousRows:Row[]=[
  ...(['moved destination','silent member'] as const).map((fault):Row=>[`event rendezvous starts with a ${fault}`,async(live,info)=>{
  await toCheckpoint(live);
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const seed=await seedBoss(live,'checkpointPumpkin');
  const context=live.clients[W].page.context(),submissions:any[]=[];
  // Fixture faults target only the Priest's event walk to this boss.
  const fixture=async(route:Route)=>{
    const body=route.request().method()==='POST'?route.request().postDataJSON():null;
    if(body?.character!==P||body.activity!=='event'||body.key!=='mrpumpkin')return route.fallback();
    submissions.push({at:Date.now(),cancel:!!body.cancel,destination:body.destination});
    if(fault==='silent member')return route.abort('failed');
    // A boss that moved between two members' requests: each froze its own point.
    await route.fallback({postData:JSON.stringify({...body,destination:{...body.destination,x:body.destination.x+40}})});
  };
  await context.route('**/party-api/shared-travel',fixture);
  // A walk goes on without a member only once the console knows it is gone, its reports stopped
  // past the report-freshness bound (the user's decision of 2026-11-17). The silent Priest's reports
  // stop as well until the walk starts, and the walk takes it back on its next report.
  let silencing=fault==='silent member';
  const silence=async(route:Route)=>{
    const body=route.request().method()==='POST'?route.request().postDataJSON():null;
    if(!silencing||body?.name!==P)return route.fallback();
    submissions.push({at:Date.now(),report:true});
    return route.abort('failed');
  };
  await context.route('**/party-api/status',silence);
  const samples:any[]=[];
  try{
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await expect.poll(async()=>{
      const s=await live.state();
      samples.push({at:Date.now(),convoy:s.activeConvoy&&{id:s.activeConvoy.id,phase:s.activeConvoy.phase,participants:s.activeConvoy.participants,
        activity:s.activeConvoy.walkingActivity,location:s.activeConvoy.location},characters:Object.fromEntries(fighters.map(n=>[n,{map:s.characters[n]?.map,x:s.characters[n]?.x,y:s.characters[n]?.y}]))});
      if(samples.length>80)samples.splice(1,1);
      const walking=s.activeConvoy?.walkingActivity==='event'&&s.activeConvoy.walkingEvent==='mrpumpkin';
      return walking&&(fault==='silent member'?s.activeConvoy.participants.includes(W):fighters.every(n=>s.activeConvoy.participants.includes(n)));
    },{timeout:120_000,message:'The event walk must start within the rendezvous window'}).toBe(true);
    silencing=false;
    // Arrival hands the walkers to boss combat; attendance records the joined fight.
    await expect.poll(async()=>{
      const s=await live.state(),attending=(n:string)=>s.eventAttendance?.[n]?.mrpumpkin?.attending===true;
      return fault==='silent member'?attending(W):fighters.every(attending);
    },{timeout:180_000,message:'The walkers must join the boss fight'}).toBe(true);
  }finally{
    silencing=false;
    await context.unroute('**/party-api/status',silence);
    await context.unroute('**/party-api/shared-travel',fixture);
    await info.attach('event-rendezvous-'+fault.replace(' ','-'),{body:JSON.stringify({seed,submissions:submissions.slice(-20),samples}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await endEvent(live,'mrpumpkin');
  }
}]),
  // A member left out of its party's event
  // never walks to it and waits in Main where the party lands (UP-3). The priest's own trip during
  // the event walk skips its occurrence (attendance-limits.ts `skipManualEventOccurrences`), the
  // one way a follower, whose events are the leader's, is left out without a death limit. The
  // setup is the walk to the seeded pumpkin, as in the fault rows.
  ['event rendezvous starts with a left-out member, who waits in Main',async(live,info)=>{
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
    const here=(await live.state()).characters[P],trip={map:here.map,x:Number(here.x)+20,y:Number(here.y)};
    await live.post('/command',{character:P,type:'character-travel',location:trip,label:'Player trip during the event walk'});
    await expect.poll(async()=>{const s=await sample(),a=s.eventAttendance?.[P]?.mrpumpkin;return !!a&&!a.ended&&!!a.ignored;},
      {timeout:60_000,message:'precondition: the trip skips the priest\u2019s occurrence'}).toBe(true);
    // The priest's assignment stays the party's attendance, apart and waiting (rule 2.3.2).
    const task=async()=>live.clients[P].run('(()=>{const t=globalThis.partyTasks.assignment.memberTask();return t&&t.task;})()');
    await expect.poll(async()=>{const t=await task();return t&&[t.kind,t.apart??null,t.event??null];},{timeout:60_000,message:'the left-out priest keeps the attendance and waits'})
      .toEqual(['event-attendance','wait',null]);
    await expect.poll(async()=>(await sample()).eventAttendance?.[W]?.mrpumpkin?.attending===true,{timeout:180_000,message:'the warrior attends'}).toBe(true);
    // The priest stands in Main, and never joins the walk again or attends.
    await expect.poll(async()=>(await sample()).characters[P]?.map,{timeout:240_000,message:'the left-out priest goes to Main'}).toBe('main');
    const after=samples.filter(x=>x.at>samples.find(y=>y.attendance?.ignored)!.at);
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
}],
];
