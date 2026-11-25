import {expect,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {warrior as W, priest as P, world as lifecycleWorld, profile, party, quests, start, artifact} from './game/hunt-lifecycle';
import {world} from './game/hunt-events';

// The walk and restart plays of windows W10a-W10f (test-windows DESIGN.md 2.2), moved from their own
// specs at 21fe30a2b.

// Failure inventory: e2e/planner-corner-failures.md (#147). From main (135, 72)
// the planner's route to the tunnel door starts with an edge through the wall at
// x=144 that the game's collision rejects; the party walks it as a shared route.
export const plannerStart={map:'main',x:135,y:72}, plannerDoor={map:'main',x:311,y:-328};

// H2: every character reports the build's CODE hash before and after a coordinator restart, and
// the restart changes no inventory. `restart` is the play that restarts the coordinator: the old
// test restarts it bare, W10a hands it C21's Town and restart.
export async function codeIdentityPlay(live:LiveGame,info:TestInfo,restart:()=>Promise<unknown>){
  // Failure inventory: docs/testing-console-build-staging.md. These are real
  // native CODE reports, not substituted heartbeat or generation observations.
  const manifest = JSON.parse(await readFile('.build/game/manifest.json', 'utf8'));
  const names = ['E2EWarrior', 'E2EPriest', 'E2EMerchant'];
  await expect.poll(async () => {
    const state = await live.state();
    return names.every(name => {
      const report = state.characters[name];
      return report?.seenAt > Date.now() - 5000 && report.codeHash === manifest.classes[report.ctype].sha256;
    });
  }, {timeout: 30_000}).toBe(true);
  const inventory = async () => live.admin(`output=Object.fromEntries(${JSON.stringify(names)}.map(name=>{const p=get_player(name);return [name,{items:p.items,slots:p.slots,gold:p.gold}]}))`);
  const before = await inventory();
  await info.attach('native-code-before', {body: JSON.stringify({state: await live.state(), inventory: before}), contentType: 'application/json'});
  await restart();
  await expect.poll(async () => {
    const state = await live.state();
    return names.every(name => {
      const report = state.characters[name];
      return report?.seenAt > Date.now() - 5000 && report.codeHash === manifest.classes[report.ctype].sha256;
    });
  }, {timeout: 30_000}).toBe(true);
  expect(await inventory()).toEqual(before);
  await info.attach('native-code-after', {body: JSON.stringify({state: await live.state(), inventory: await inventory()}), contentType: 'application/json'});
}

// C21: Town cast while every Town-complete ack is refused, a restart, then the acks go through and
// the party walks to (0, 350) on newer command ids.
export async function restoredTownPlay(live:LiveGame,info:TestInfo){
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const receipts:any[]=[];
  const context=live.clients[W].page.context();
  let hold=true;
  const gate=async(route:import('@playwright/test').Route)=>{
    if(!hold)return route.fallback();
    receipts.push({at:Date.now(),body:route.request().postDataJSON()});
    await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Declared delayed Town completion acknowledgement'})});
  };
  await context.route('**/party-api/town-complete',gate);
  try{
    await live.post('/town-party',{});
    await expect.poll(()=>receipts.some(r=>r.body.character===W)&&receipts.some(r=>r.body.character===P),{timeout:60_000}).toBe(true);
    const before=Object.fromEntries(await Promise.all([W,P].map(async n=>[n,Math.max(await live.clients[n].run('globalThis.__partyLastCommand'),...receipts.filter(r=>r.body.character===n).map(r=>r.body.commandId))])));
    const restartingAt=Date.now();
    await live.restartCoordinator();
    await expect.poll(async()=>[W,P].every(n=>receipts.some(r=>r.at>=restartingAt&&r.body.character===n&&r.body.commandId>before[n])),{timeout:60_000}).toBe(true);
    const restored=Object.fromEntries(await Promise.all([W,P].map(async n=>[n,await live.clients[n].run('globalThis.__partyLastCommand')])));
    hold=false;
    await expect.poll(async()=>(await live.state()).townCycle?.pending?.length||0,{timeout:60_000}).toBe(0);
    await live.post('/travel',{map:'main',x:0,y:350});
    let native:any;
    await expect.poll(async()=>{
      const [s,positions]=await Promise.all([live.state(),live.admin(`output=Object.fromEntries(['${W}','${P}'].map(n=>{const p=get_player(n);return [n,{map:p.map,x:p.x,y:p.y,moving:!!p.moving}]}))`)]);
      native=positions;
      return !s.activeConvoy&&[W,P].every(n=>s.characters[n]?.map==='main'&&Math.hypot(s.characters[n].x,s.characters[n].y-350)<35&&
        s.characters[n].lastCommandId>restored[n]&&Date.now()-s.characters[n].seenAt<3000&&
        native[n].map==='main'&&!native[n].moving&&Math.hypot(native[n].x,native[n].y-350)<35);
    },{timeout:90_000,message:'Both native fighters must apply newer commands and physically reach the farming waypoint after restored Town'}).toBe(true);
    for(const n of [W,P]){expect(native[n].map).toBe('main');expect(Math.hypot(native[n].x,native[n].y-350)).toBeLessThan(35);}
    await info.attach('native-restored-town-command-sequence',{body:JSON.stringify({before,restored,receipts,native,final:await live.state()}),contentType:'application/json'});
  }finally{hold=false;await context.unroute('**/party-api/town-complete',gate);}
}

// H36: a Hunt walk stopped mid-route; the native fallback takes over while the leader drifts off
// its rally point, and the party arrives and farms. The checks under `planted` assert that the
// test's own planted drifts happened; W10d leaves them out (test-windows DESIGN.md 4.3, H36).
export async function huntFallbackPlay(live:LiveGame,info:TestInfo,planted:boolean){
  await party(live);
  await quests(live,info,{[W]:{count:100},[P]:{count:100}});
  await live.clients[W].run(`(()=>{
    const generation=globalThis.__partyRuntimeGeneration;
    const excludedConvoy=partyStatus.character.combatTraceSnapshot().convoy;
    const fault=globalThis.__e2eFallbackStop={generation,issued:0,receipt:null,drift:null,boundary:null,boundaries:[],
      detailDescriptor:Object.getOwnPropertyDescriptor(globalThis.__partyMovement.walkState,'navigationDetail'),detailValue:globalThis.__partyMovement.walkState.navigationDetail};
    // An already stopped actor can skip settlement entirely. At this owned
    // rendezvous boundary, send a real zero-distance native move: the native
    // client marks it moving until physics settles, without changing position.
    // This guarantees the wait exists; no character flag or report is fabricated.
    Object.defineProperty(globalThis.__partyMovement.walkState,'navigationDetail',{configurable:true,enumerable:true,
      get(){return fault.detailValue;},set(value){
        fault.detailValue=value;
        if(value!=='rendezvous'||fault.drift||!fault.receipt||globalThis.__partyRuntimeGeneration!==generation)return;
        const convoy=partyStatus.character.combatTraceSnapshot();
        if(convoy.convoy===fault.receipt.owner.convoyId||convoy.convoyPhase!=='rendezvous'||convoy.cancelled)return;
        // An early origin correction can reject this attempt before any wait.
        // Keep the fault eligible for the next exact owner until the late walk runs.
        if(fault.boundary?.convoy===convoy.convoy&&fault.boundary?.epoch===convoy.convoyEpoch)return;
        const boundary=fault.boundary={convoy:convoy.convoy,epoch:convoy.convoyEpoch,wasMoving:!!character.moving,
          from:{map:character.map,x:character.real_x,y:character.real_y}};
        fault.boundaries.push(boundary);
        try{
          Promise.resolve(move(character.real_x,character.real_y)).then(result=>{boundary.result=result;},error=>{boundary.result={error:String(error?.reason||error)};});
          boundary.pending=!!character.moving;
        }catch(error){boundary.error=String(error);}
      }});
    // A native position update can arrive after the leader's initial origin
    // check, while rendezvous waits for movement/cruise speed to settle. That
    // settle is a loop the movement owner runs on its own scheduler passes
    // (\`every\` under the walk's ':settle' holder), and a pass waits on its run's
    // promise. Deliver one real walk inside that owned wait; leave status and
    // timers live.
    const service=globalThis.__partyMovement;
    fault.every=service.every;
    fault.wrappedEvery=function(holder,run){
      const convoy=partyStatus.character.combatTraceSnapshot();
      if(!String(holder).endsWith(':settle')||fault.drift||!fault.receipt||globalThis.__partyRuntimeGeneration!==generation||
          convoy.convoy===fault.receipt.owner.convoyId||convoy.convoyPhase!=='rendezvous'||
          fault.boundary?.convoy!==convoy.convoy||fault.boundary?.epoch!==convoy.convoyEpoch)
        return fault.every.call(this,holder,run);
      const drift=fault.drift={convoy:convoy.convoy,epoch:convoy.convoyEpoch};
      let walked=null;
      return fault.every.call(this,holder,function(){
        if(walked)return run();
        walked=(async()=>{
          const current=partyStatus.character.combatTraceSnapshot();
          if(globalThis.__partyRuntimeGeneration!==generation||current.convoy!==drift.convoy||current.convoyEpoch!==drift.epoch){
            drift.error='Rendezvous owner changed before native walk';return;
          }
          drift.from={map:character.map,x:character.x,y:character.y};
          const to={x:character.x,y:character.y+80};
          if(!can_move_to(to.x,to.y)){drift.error='Native drift destination is unwalkable';return;}
          try{await xmove(to.x,to.y);drift.arrived={map:character.map,x:character.x,y:character.y};}
          catch(error){drift.error=String(error);}
        })();
        return walked.then(()=>run());
      });
    };
    service.every=fault.wrappedEvery;
    fault.timer=setInterval(()=>{
      if(fault.issued || globalThis.__partyRuntimeGeneration!==generation)return;
      const service=globalThis.__partyMovement,journey=service?.report(),owner=journey?.owner;
      const convoy=partyStatus.character.combatTraceSnapshot();
      const revision=globalThis.__partyNavigationIntent?.revision;
      if(convoy.convoy===excludedConvoy || !journey || !owner || !Number.isFinite(owner.commandId) || !Number.isFinite(owner.navigationRevision) || !service.state.moving || !character.moving || character.c?.town || parent.transporting ||
          convoy.convoyPhase!=='travelling' || owner.convoyId!==convoy.convoy || owner.epoch!==convoy.convoyEpoch ||
          owner.navigationRevision!==revision || convoy.cancelled)return;
      const runtime=sharedRoutine.targeting.queueReport().combatSelection.runtimeId;
      if(!journey.id.startsWith(character.name+':'+runtime+':'))return;
      fault.issued=1;clearInterval(fault.timer);
      fault.receipt={at:Date.now(),map:character.map,x:character.x,y:character.y,
        smartMoving:service.state.moving,moving:character.moving,transporting:!!parent.transporting,
        generation,runtime,journeyId:journey.id,owner:{...owner},phase:convoy.convoyPhase,excludedConvoy};
      try{Promise.resolve(stop('smart')).then(()=>{fault.receipt.stopCompletedAt=Date.now();},error=>{fault.receipt.stopError=String(error);});}
      catch(error){fault.receipt.stopError=String(error);}
    },50);
  })()`);
  // Hold the leader's genuine fallback preparation responses while a native
  // eight-unit walk moves the leader off its rally point. The leader stays inside the
  // rally range, so the walk starts from where it stands on the same epoch (decided
  // 2026-10-28: no walk-back to a fixed origin), and the settlement-time drift fault
  // lands on that epoch.
  let originDriftIssued=false;
  let originOperation:{convoy:string;epoch:number;completion:Promise<unknown>}|undefined;
  const preparationDeliveries:{name:string;at:number;id:number;convoy:string;epoch:number;fast:boolean;held:boolean;deliveredAt?:number}[]=[];
  await live.clients[W].page.route('**/party-api/status',async route=>{
    const request=route.request().postDataJSON();
    // Native companions share this page; only the leader owns this fault.
    if(request.name!==W)return route.fallback();
    const response=await route.fetch(),state=await response.json(),command=state.command;
    if(!originDriftIssued&&command?.nativeFallback&&['prepare','shared-prepare'].includes(command.phase)){
      originDriftIssued=true;
      originOperation={convoy:command.convoyId,epoch:command.epoch,completion:live.clients[W].run(`(async()=>{
        const fault=globalThis.__e2eFallbackStop;
        const from={map:character.map,x:character.x,y:character.y},to={x:character.x,y:character.y+8};
        if(!fault.receipt||!can_move_to(to.x,to.y))throw Error('Early origin drift requires the interrupted native route and a walkable destination');
        const drift=fault.preRendezvousDrift={command:${JSON.stringify(command)},from};
        await xmove(to.x,to.y);drift.arrived={map:character.map,x:character.x,y:character.y};
      })()`)};
    }
    const matches=!!originOperation&&command?.convoyId===originOperation.convoy&&command?.epoch===originOperation.epoch&&['prepare','shared-prepare'].includes(command.phase);
    const delivery:(typeof preparationDeliveries)[number]|undefined=command?.nativeFallback?{name:request.name,at:Date.now(),id:command.id,convoy:command.convoyId,epoch:command.epoch,
      fast:!!(request.combatOnly||request.combatWait),held:matches}:undefined;
    if(delivery)preparationDeliveries.push(delivery);
    if(matches)await originOperation!.completion;
    await route.fulfill({response});
    if(delivery)delivery.deliveredAt=Date.now();
  });
  try{
    await start(live);
    await expect.poll(async()=>await live.clients[W].run('globalThis.__e2eFallbackStop?.issued===1'),
      {timeout:90_000,intervals:[50,100],message:'Interrupt a genuine native Hunt walking route'}).toBe(true);
    const interrupted=await live.clients[W].run('globalThis.__e2eFallbackStop.receipt');
    expect(interrupted.smartMoving).toBe(true);expect(interrupted.moving).toBe(true);
    expect(interrupted.transporting).toBe(false);expect(interrupted.phase).toBe('travelling');
    expect(interrupted.stopError).toBeUndefined();
    await info.attach('native-route-stop',{body:JSON.stringify(interrupted),contentType:'application/json'});
  await expect.poll(async()=>Object.values(profile(await live.state()).monsterHunt?.routeRecovery||{}).some((entry:any)=>entry.phase==='native'),
    {timeout:30_000,message:'The real route interruption must activate the bounded native fallback'}).toBe(true);
  const recovering=profile(await live.state()).monsterHunt;
  await expect.poll(async()=>(await lifecycleWorld(live))[W].quest?.c,
    {timeout:120_000,message:'Successful fallback arrival must release actual Hunt combat'}).toBeLessThan(100);
  const firstKills=await lifecycleWorld(live);
  await expect.poll(async()=>(await lifecycleWorld(live))[W].quest?.c,
    {timeout:30_000,message:'Farming must continue after the first kills without restarting the completed route'}).toBeLessThan(firstKills[W].quest.c);
  const finalState=await live.state(), finalHunt=profile(finalState).monsterHunt;
  expect(finalHunt.cycleId).toBe(recovering.cycleId);
  expect(finalHunt.routeRecovery,'Successful arrival must retain the spent retry budget').toEqual(recovering.routeRecovery);
  const {drift,boundary,boundaries,preRendezvousDrift}=await live.clients[W].run('({drift:globalThis.__e2eFallbackStop.drift,boundary:globalThis.__e2eFallbackStop.boundary,boundaries:globalThis.__e2eFallbackStop.boundaries,preRendezvousDrift:globalThis.__e2eFallbackStop.preRendezvousDrift})');
  if(planted){
  expect(originDriftIssued).toBe(true);
  expect(preparationDeliveries.filter(entry=>entry.held).map(entry=>entry.name)).toContain(W);
  expect(preparationDeliveries.every(entry=>entry.name===W)).toBe(true);
  expect(preRendezvousDrift.arrived.map).toBe(preRendezvousDrift.from.map);
  expect(Math.hypot(preRendezvousDrift.arrived.x-preRendezvousDrift.from.x,preRendezvousDrift.arrived.y-preRendezvousDrift.from.y)).toBeGreaterThan(7);
  expect(boundaries.some((entry:any)=>entry.convoy===preRendezvousDrift.command.convoyId&&entry.epoch===preRendezvousDrift.command.epoch)).toBe(true);
  expect(drift).toBeTruthy();expect(drift.error).toBeUndefined();
  expect({convoy:drift.convoy,epoch:drift.epoch}).toEqual({convoy:preRendezvousDrift.command.convoyId,epoch:preRendezvousDrift.command.epoch});
  expect(boundary.pending).toBe(true);expect(boundary.error).toBeUndefined();
  expect({convoy:boundary.convoy,epoch:boundary.epoch}).toEqual({convoy:drift.convoy,epoch:drift.epoch});
  expect(drift.arrived.map).toBe(drift.from.map);
  expect(Math.hypot(drift.arrived.x-drift.from.x,drift.arrived.y-drift.from.y)).toBeGreaterThan(55);
  }
  await artifact(live,info,'native-fallback-arrival-and-continuing-kills',{interrupted,recovering,firstKills});
  }finally{
    await live.clients[W].page.unrouteAll({behavior:'wait'});
    const fault=await live.clients[W].run(`(()=>{const fault=globalThis.__e2eFallbackStop;if(fault){clearInterval(fault.timer);if(globalThis.__partyMovement?.every===fault.wrappedEvery)globalThis.__partyMovement.every=fault.every;
      if(fault.detailDescriptor)Object.defineProperty(globalThis.__partyMovement.walkState,'navigationDetail',{...fault.detailDescriptor,value:fault.detailValue});
      else{delete globalThis.__partyMovement.walkState.navigationDetail;globalThis.__partyMovement.walkState.navigationDetail=fault.detailValue;}}
      return fault?{generation:fault.generation,issued:fault.issued,receipt:fault.receipt,drift:fault.drift,boundary:fault.boundary,boundaries:fault.boundaries,preRendezvousDrift:fault.preRendezvousDrift}:null;})()`);
    await info.attach('native-fallback-preparation-deliveries',{body:JSON.stringify(preparationDeliveries),contentType:'application/json'});
    await info.attach('native-fallback-stop-ledger',{body:JSON.stringify(fault),contentType:'application/json'});
  }
}

// H40: an Escape whose saved record is replaced with a failed one-member escape still walks both
// members to Main's death goal.
export async function escapeMembershipPlay(live:LiveGame,info:TestInfo,metadata:'missing'){
  // Failure inventory is recorded before the implementation in
  // docs/testing-escape-membership.md. Only coordinator metadata is faulted;
  // the native classes, movement and server arrival remain genuine.
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const context=live.clients[W].page.context();
  await context.route('**/party-api/status',async route=>{
    const body=route.request().postDataJSON();
    if(body?.name===P){if(metadata==='missing')delete body.ctype;else body.ctype='warrior';}
    await route.continue({postData:JSON.stringify(body)});
  });
  const positions:any[]=[];let admission:any;
  try{
    // Let the real coordinator observe the declared metadata before admission.
    await expect.poll(async()=>{const s=(await live.state()).characters[P];return metadata==='missing'?!s?.ctype:s?.ctype==='warrior';},{timeout:15_000}).toBe(true);
    admission=await live.post('/escape',{});
    expect(admission.escape.participants).toEqual(expect.arrayContaining([W,P]));
    if(metadata==='missing'){
      const before=await live.state();
      // Historical persisted omission, not a fabricated gameplay outcome:
      // restore the old membership bug with unchanged native/navigation state.
      // The recovery records the target mode, as runtime/coordinator/survival/recovery.ts `capture` does
      // so the seed stays current.
      await live.restoreHistoricalSettings(settings=>{
        const recovery={id:'declared-historical-membership-death',names:[W,P],leader:W,
          policy:settings.targetMode,focus:JSON.stringify(before.monsterFocus),
          revisions:Object.fromEntries([W,P].map(name=>[name,settings.navigationIntents[name].revision])),
          phase:'recovering',at:Date.now(),deaths:[],reason:'Declared persisted omission'};
        return {escape:{...settings.escape,participants:[W],stage:'failed-hold'},combatRecovery:recovery,
          farmingProfiles:{...settings.farmingProfiles,[W]:{...settings.farmingProfiles[W],combatRecovery:recovery}}};
      });
    }else await live.restartCoordinator();
    // The escape walks to the safe table's death goal it was admitted with (Main's spawn 5 here).
    const home=admission.escape.home;
    expect(home?.goal).toBe('death');
    await expect.poll(async()=>{const native=await world(live);positions.push({at:Date.now(),players:native.players});return [W,P].every(name=>{const p=native.players[name];return p&&!p.rip&&p.map===home.map&&Math.hypot(p.x-home.x,p.y-home.y)<=home.radius;});},{timeout:60_000,intervals:[500]}).toBe(true);
  }finally{
    await info.attach('native-escape-requested-membership',{body:JSON.stringify({metadata,admission,positions,final:await live.state(),native:await world(live),events:{[W]:await live.clients[W].events(),[P]:await live.clients[P].events()}}),contentType:'application/json'});
    await context.unrouteAll({behavior:'ignoreErrors'});
  }
}

// C19: from a town corner the party walks the planned route to the tunnel door with no client
// repair, then a restart on unloadable game files sends it home on the native planner. The checks
// under `samples` are the can_move edge samples and the one-detour-point count, which move to a
// planner unit row on the pinned geometry (test-windows DESIGN.md 4.3, C19; ledger moves:step12).
export async function plannerCornerPlay(live:LiveGame,info:TestInfo,samples:boolean){
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await expect.poll(async()=>!!(await live.state()).characters?.[W]?.movementGeometry,{timeout:120_000}).toBe(true);
  const state=await live.state(), character=state.characters[W];
  const request={character:W,id:'planner-corner-'+Date.now(),from:{map:'main',in:'main',x:plannerStart.x,y:plannerStart.y},to:{map:'main',in:'main',x:plannerDoor.x,y:plannerDoor.y},
    speed:character.speed,town:false,base:{h:8,v:7,vn:2},...character.movementGeometry};
  const plan=await live.post('/movement-plan',request);
  expect(plan.error,'The planner must route from the town corner').toBeFalsy();
  if(samples){
  // Every same-map walking edge is checked with the game server's own collision.
  const edges=await live.admin(`output=(()=>{const plot=${JSON.stringify([request.from,...plan.plot])};const out=[];
    for(let i=1;i<plot.length;i++){const a=plot[i-1],b=plot[i];if(a.map!==b.map||b.transport||b.town)continue;
      out.push({from:[Math.round(a.x),Math.round(a.y)],to:[Math.round(b.x),Math.round(b.y)],
        walkable:can_move({map:a.map,x:a.x,y:a.y,going_x:b.x,going_y:b.y,base:{h:8,v:7,vn:2}})});}
    return out;})()`);
  await info.attach('planner-corner-plan',{body:JSON.stringify({request,plot:plan.plot,edges},null,2),contentType:'application/json'});
  expect(edges.filter((e:any)=>!e.walkable),'The planned route must contain no edge the game rejects').toEqual([]);
  // MOV-028: the planner's own first edge, start to (153, -51), crosses the wall at x=144, and
  // the worker puts one detour point in front of it (corner-edges.ts detourRejectedEdges).
  // The plot opens with the start itself, so one detour point is one point between the two.
  const corner=plan.plot.findIndex((p:any)=>p.map==='main'&&Math.hypot(p.x-153,p.y+51)<=1);
  const before=plan.plot.slice(0,corner).filter((p:any)=>Math.hypot(p.x-plannerStart.x,p.y-plannerStart.y)>1);
  expect(corner,'The route keeps the planner\'s point past the corner').toBeGreaterThan(0);
  expect(before.length,'One detour point in front of the corner').toBe(1);
  expect(await live.admin(`output=can_move({map:'main',x:${plannerStart.x},y:${plannerStart.y},going_x:153,going_y:-51,base:{h:8,v:7,vn:2}})`),
    'The planner\'s own edge past the corner is one the game rejects').toBe(false);

  }
  // MOV-157: a game version the coordinator holds no prepared geometry for, as after a failed
  // preparation (application.ts prepareMovement), answers a completed rejection the client's
  // native planner takes over from, and the coordinator keeps planning the prepared version.
  const unprepared=await live.post('/movement-plan',{...request,id:request.id+'-unprepared',version:request.version+1});
  expect(String(unprepared.error),'An unprepared version answers a planner rejection').toMatch(/No compatible game geometry prepared/);
  expect(unprepared.plot,'An unprepared version answers no route').toBeUndefined();
  if(samples){
  // Exercise the other reported corners through the real planner HTTP route,
  // and compare its output with native server collision for each footprint.
  const cases=[
    [87,-208,105,-235],[-457,261,-337,280],[-457,280,-439,261],
    [343,-200,311,-219],[-119,149,-137,168],[-345,-656,-327,-616],
  ].map(([x,y,tx,ty])=>({from:{map:'main',x,y},to:{map:'main',x:tx,y:ty},base:{h:8,v:7,vn:2}}));
  cases.push({from:plannerStart,to:plannerDoor,base:{h:6,v:5,vn:1}},
    {from:{map:'main',x:100,y:100},to:{map:'main',x:100,y:-100},base:{h:12,v:9,vn:4}});
  for(const [index,sample] of cases.entries()){
    const input={...request,...sample,id:request.id+'-sample-'+index},result=await live.post('/movement-plan',input);
    expect(result.error,'Reported corner '+index+' must produce a route').toBeFalsy();
    const checked=await live.admin(`output=(()=>{const points=${JSON.stringify([input.from,...result.plot])},base=${JSON.stringify(sample.base)};
      return points.slice(1).flatMap((b,i)=>{const a=points[i];if(a.map!==b.map||b.transport||b.town)return [];
        return [{from:a,to:b,walkable:can_move({map:a.map,x:a.x,y:a.y,going_x:b.x,going_y:b.y,base})}];});})()`);
    await info.attach('planner-corner-sample-'+index,{body:JSON.stringify({input,result,checked}),contentType:'application/json'});
    expect(checked.filter((edge:any)=>!edge.walkable),'Every sampled edge must pass native collision').toEqual([]);
  }

  }
  // bothAt waits for both fighters on main within 35 of the point.
  const bothAt=(point:{x:number;y:number},message:string)=>expect.poll(async()=>{const s=await world(live);
    return [W,P].every(n=>s.players[n].map==='main'&&Math.hypot(s.players[n].x-point.x,s.players[n].y-point.y)<35);},
    {timeout:120_000,intervals:[1000],message}).toBe(true);

  // The party walks it as a shared route without spending repairs.
  const travelAt=Date.now();
  await live.post('/travel',plannerDoor);
  await bothAt(plannerDoor,'Both fighters must reach the tunnel door');
  const logs=(await live.state()).combatLogs;
  expect(logs,'the state publishes combatLogs').toBeDefined();
  const repairs=[W,P].flatMap(n=>((logs[n]?.events||logs[n]||[]) as any[]).filter(e=>e.at>=travelAt&&/Repairing rejected walking segment|Shared connector repair failed/.test(e.message))
    .map(e=>({who:n,at:e.at,message:e.message})));
  await info.attach('planner-corner-travel',{body:JSON.stringify({travelAt,arrivedAt:Date.now(),repairs},null,2),contentType:'application/json'});
  expect(repairs,'Walking the planned route must need no client repair').toEqual([]);

  // MOV-157: the coordinator restarts on game files that fail to load. prepareMovement's catch
  // prepares no geometry, every plan request answers the planner rejection, and the party
  // still walks home on the clients' native planner.
  await live.restartCoordinator(undefined,{E2E_UNLOADABLE_GAME_FILES:'1'});
  const failed=await live.post('/movement-plan',{...request,id:request.id+'-unloadable'});
  expect(String(failed.error),'With no prepared geometry the planner rejects the running version').toMatch(/No compatible game geometry prepared.*prepared none/);
  expect(failed.plot,'With no prepared geometry the planner answers no route').toBeUndefined();
  // The same fault fails the items owner's bank vault read, which warns and answers no vaults
  // (items/coordinator/storage.ts loadCoordinatorBankVaults), so the coordinator still started.
  const coordinatorLog=readFileSync(path.join(live.deploymentPaths.directory,'coordinator.log'),'utf8');
  expect(coordinatorLog,'The bank vault read warns on the unloadable game file').toContain('Could not load bank-vault definitions');
  // The restarted coordinator takes the travel once both fighters report to it again.
  await expect.poll(async()=>{const s=await live.state();return [W,P].every(n=>s.characters?.[n]?.runtime==='native'&&Date.now()-s.characters[n].seenAt<3000);},
    {timeout:60_000,message:'Both fighters must report to the restarted coordinator'}).toBe(true);
  const fallbackAt=Date.now(), walkedOut=await live.clients[W].run('__partyMovement.last()?.id');
  await live.post('/travel',plannerStart);
  await bothAt(plannerStart,'Both fighters must walk back on native movement');
  // bothAt passes within 35 of the start while the walk back still runs, and last() holds the
  // walk out until that journey ends; one run read it 13 s before the native arrival.
  let last:any;
  await expect.poll(async()=>{last=await live.clients[W].run('(()=>{const l=__partyMovement.last();return l&&{id:l.id,end:l.end,engine:l.engine,done:l.done};})()');
    return !!last&&last.id!==walkedOut&&!await live.clients[W].run('!!__partyMovement.report()');},
    {timeout:60_000,message:'The walk back ends'}).toBe(true);
  await info.attach('planner-corner-unloadable',{body:JSON.stringify({failed,fallbackAt,last}),contentType:'application/json'});
  expect(last?.engine,'The walk back plans natively').toBe('native');
}
