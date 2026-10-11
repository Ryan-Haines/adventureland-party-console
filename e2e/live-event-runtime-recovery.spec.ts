import { killNativeCharacter } from "./hunt-interruption-helpers";
import {test,expect} from './live-fixtures';
import type {Route} from '@playwright/test';

const W='E2EWarrior',P='E2EPriest',fighters=[W,P];
test.use({initialPosition:{map:'halloween',x:-550,y:-290}});

test('native fixed-end event timer survives clock resync and a limit added during attendance',async({live},info)=>{
  test.setTimeout(300000);
  // Failure inventory: docs/testing-event-timer-identity.md. Fixed end epochs
  // exercise Crab's identity fallback with genuine native boss combat.
  const checkpoint={map:'halloween',x:-550,y:-290};
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await live.post('/travel',checkpoint);
  await expect.poll(async()=>{const s=await live.state();return !s.activeConvoy&&fighters.every(name=>
    s.characters[name]?.map===checkpoint.map&&Math.hypot(s.characters[name].x-checkpoint.x,s.characters[name].y-checkpoint.y)<100);},{timeout:90000}).toBe(true);
  const seed=await live.admin(`output=(()=>{const original=G.monsters.mrpumpkin;try{
    G.monsters.mrpumpkin={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,peaceful:true,spawns:[]};
    const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[-495,685,-495,685]},{temp:1});
    const end=Date.now()+3600000;E.mrpumpkin={live:true,map:m.map,x:m.x,y:m.y,end,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:String(m.id),end,original};
  }catch(error){G.monsters.mrpumpkin=original;throw error;}})()`);
  const samples:any[]=[];
  try{
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await expect.poll(async()=>{const s=await live.state();samples.push(s.eventAttendance);
      return s.eventAttendance?.[W]?.mrpumpkin?.elapsedMs>12000&&fighters.every(name=>s.characters[name]?.joinedEvent==='mrpumpkin');},{timeout:120000}).toBe(true);
    const before=await live.state(),runtime=before.characters[W].dashboardRuntime;
    expect(before.eventAttendance[W].mrpumpkin.id).toBe(String(seed.end));
    await live.clients[W].frame.evaluate(()=>{const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);});
    await expect.poll(async()=>{const s=await live.state();return s.characters[W]?.dashboardRuntime!==runtime&&s.characters[W]?.eventClockStale===false;},{timeout:45000}).toBe(true);
    const resumed=await live.state();
    expect(resumed.eventAttendance[W].mrpumpkin.id).toBe(String(seed.end));
    expect(resumed.eventAttendance[W].mrpumpkin.elapsedMs).toBeGreaterThanOrEqual(before.eventAttendance[W].mrpumpkin.elapsedMs);
    await live.post('/formation',{character:W,eventLimits:{event:'mrpumpkin',limits:{deathLimit:null,timeLimitMinutes:0.1}}});
    await expect.poll(async()=>{const s=await live.state();samples.push(s.eventAttendance);return s.eventAttendance?.[W]?.mrpumpkin?.ignored==='time limit';},{timeout:15000}).toBe(true);
    await expect.poll(async()=>{const s=await live.state();return !s.eventReturn&&fighters.every(name=>
      !s.characters[name]?.joinedEvent&&s.characters[name]?.map===checkpoint.map&&Math.hypot(s.characters[name].x-checkpoint.x,s.characters[name].y-checkpoint.y)<100);},{timeout:150000}).toBe(true);
    expect((await live.clients[W].events()).some(packet=>packet.event==='hit'&&String(packet.data?.id)===seed.id&&packet.data?.hid===W&&packet.data?.damage>0)).toBe(true);
  }finally{
    await info.attach('fixed-end-event-timer',{body:JSON.stringify({seed,samples,state:await live.state(),events:await Promise.all(fighters.map(name=>live.clients[name].events()))}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.admin(`output=(()=>{for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(String(m.id)===${JSON.stringify(seed.id)})remove_monster(m,{silent:true});G.monsters.mrpumpkin=${JSON.stringify(seed.original)};delete E.mrpumpkin;broadcast_e();return true;})()`);
  }
});

test.describe('retired event exit ownership',()=>{
  test.use({initialPosition:{map:'uhills',x:-550,y:-160}});
  // Failure inventory: docs/testing-round2-recovery.md. Restoring a snapshot
  // without the old recovery must retire its still-running CODE continuation;
  // no successful Town receipt or native combat outcome is manufactured.
  for (const variant of ['plain','deferred','stale-peer'] as const) test(`native event entry resumes after its old ${variant==='plain'?'return cycle disappears':variant==='deferred'?'deferred return is superseded':'deferred return admits a temporarily stale peer'}`,async({live},info)=>{
    const deferred=variant!=='plain';
    test.setTimeout(300_000);
    await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
    const oldCycle='historical-retired-pumpkin-exit';
    let started:any,retiredAt=0,seed:any;
    const exitOwnerSamples:any[]=[];
    const communicationFaults:any[]=[];
    const context=live.clients[P].page.context();
    let holdUntil=0;
    let priestSeenAtBeforeHold=0;
    const intercept=async(route:Route)=>{
      if(Date.now()<holdUntil&&route.request().method()==='POST'&&route.request().postDataJSON()?.name===P){
        if(communicationFaults.length<128)communicationFaults.push({at:Date.now(),action:'dropped-priest-status'});
        await route.abort('failed');return;
      }
      await route.fallback();
    };
    try {
      await live.restoreHistoricalSettings(settings=>{
        const profile=settings.farmingProfiles[W];
        const waypoints=Object.fromEntries(fighters.map(name=>[name,{revision:settings.navigationIntents?.[name]?.revision||0,location:{map:'uhills',x:-550,y:-160}}]));
        const recovery={cycleId:oldCycle,event:'mrpumpkin',participants:fighters,pending:fighters,startedAt:Date.now(),phase:'evacuating',checkpoint:{map:'uhills',x:-550,y:-160},waypoints,deferred:[]};
        return {farmingProfiles:{...settings.farmingProfiles,[W]:{...profile,eventReturn:recovery}},eventReturn:recovery};
      });
      await expect.poll(async()=>{const s=await live.state();
        if(fighters.every(name=>s.characters[name]?.eventRecovery?.cycleId===oldCycle && ['leaving-event','returning-to-main'].includes(s.characters[name].eventRecovery.phase))){started=s;return true;}return false;
      },{timeout:45_000}).toBe(true);
      seed=await live.admin(`output=(()=>{const original=G.monsters.mrpumpkin;try{
        G.monsters.mrpumpkin={...original,hp:10000000,attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
        // This case verifies retired exit ownership, not the separate long
        // Halloween terrain leg. Use the native Mainland door arrival spawn and
        // collision-validate the initial encounter before creating it.
        const doorway=G.maps.main.doors.find(door=>door[4]==='halloween');
        const portal=doorway&&G.maps.halloween.spawns[doorway[5]];
        if(!portal)throw Error('Native Mainland-to-Halloween arrival spawn is unavailable');
        const point=[[60,0],[-60,0],[0,60],[0,-60]].map(([dx,dy])=>({x:portal[0]+dx,y:portal[1]+dy})).find(point=>
          ${JSON.stringify(fighters)}.every(name=>can_move({map:'halloween',x:portal[0],y:portal[1],going_x:point.x,going_y:point.y,base:get_player(name).base})));
        if(!point)throw Error('No collision-safe native portal encounter seed');
        const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[point.x,point.y,point.x,point.y]},{temp:1});
        E.mrpumpkin={live:true,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:m.id,map:m.map,x:m.x,y:m.y,portal,scope:'retired exit ownership; native door spawn with collision-safe initial encounter'};
      }finally{G.monsters.mrpumpkin=original;}})()`);
      if(variant==='stale-peer'){
        priestSeenAtBeforeHold=Number((await live.state()).characters[P]?.seenAt);
        expect(priestSeenAtBeforeHold).toBeGreaterThan(0);
        holdUntil=Date.now()+20_000;
        await context.route('**/party-api/status',intercept);
        await expect.poll(async()=>Date.now()-Number((await live.state()).characters[P]?.seenAt||priestSeenAtBeforeHold),{timeout:8_000}).toBeGreaterThan(3500);
      }
      retiredAt=Date.now();
      await live.restoreHistoricalSettings(settings=>{
        const deferredEventReturns=deferred?Object.fromEntries(fighters.map(name=>[name,{event:'mrpumpkin',cycleId:oldCycle,
          checkpoint:{map:'uhills',x:-550,y:-160},navigationRevision:settings.navigationIntents?.[name]?.revision||0,
          deferredAt:Date.now(),phase:'returning-to-checkpoint'}])):{};
        return {eventReturn:null,activeConvoy:null,deferredEventReturns,
          farmingProfiles:{...settings.farmingProfiles,[W]:{...settings.farmingProfiles[W],eventReturn:null,activeConvoy:null,eventSessions:{}}},
          eventSelectionsByCharacter:{...settings.eventSelectionsByCharacter,[W]:['mrpumpkin']}};
      });
      if(variant==='stale-peer'){
        await expect.poll(async()=>{const s=await live.state();return !s.deferredEventReturns[W]&&!!s.farmingProfiles[W].eventSessions[W];},{timeout:12_000}).toBe(true);
        expect(Date.now()).toBeLessThan(holdUntil);
        const admission=await live.state();
        const priestSeenAt=Number(admission.characters[P]?.seenAt||priestSeenAtBeforeHold);
        const priestNative=await live.clients[P].snapshot();
        expect(priestNative.name).toBe(P);
        expect(priestNative.connected).toBe(true);
        expect(Date.now()-priestSeenAt).toBeGreaterThan(3000);
        expect(admission.deferredEventReturns[P]?.cycleId).toBe(oldCycle);
        communicationFaults.push({at:Date.now(),action:'released-after-warrior-admission',priestSeenAt,priestSeenAtBeforeHold,
          priestNative:{name:priestNative.name,connected:priestNative.connected,runtimeGeneration:priestNative.runtimeGeneration},
          warriorSession:admission.farmingProfiles[W].eventSessions[W],priestDeferred:admission.deferredEventReturns[P]});
        holdUntil=0;
      }
      await expect.poll(async()=>{const s=await live.state();
        const native=Object.fromEntries(await Promise.all(fighters.map(async name=>[name,
          await live.clients[name].run(`(()=>{const owner=globalThis.__partyEventExitOwner;
            return {owner:owner?{cycleId:owner.cycleId,cancelled:!!owner.cancelled,commandId:owner.commandId}:null,
              selectionPublished:Object.prototype.hasOwnProperty.call(globalThis,'__partyEventRecoveryCycleId'),
              selectedCycle:globalThis.__partyEventRecoveryCycleId===undefined?null:globalThis.__partyEventRecoveryCycleId};})()`)])));
        if(exitOwnerSamples.length===64)exitOwnerSamples.shift();
        exitOwnerSamples.push({at:Date.now(),native,diagnostics:Object.fromEntries(fighters.map(name=>[name,s.characters[name]?.eventRecovery]))});
        return fighters.every(name=>s.characters[name]?.dashboardRuntime===started.characters[name].dashboardRuntime &&
          native[name].selectionPublished && native[name].selectedCycle!==oldCycle && (!native[name].owner || native[name].owner.cancelled || native[name].owner.cycleId!==oldCycle));
      },{timeout:15_000}).toBe(true);
      if(deferred){const resumed=await live.state();for(const name of fighters){
        expect(resumed.deferredEventReturns[name]).toBeUndefined();
        expect(resumed.farmingProfiles[W].eventSessions[name].waypoints[name].location).toEqual({map:'uhills',x:-550,y:-160});
      }}
      await expect.poll(async()=>{const events=await live.clients[W].events();return fighters.every(name=>events.some((e:any)=>
        e.event==='hit'&&String(e.data?.id)===String(seed.id)&&e.data?.hid===name&&e.at>retiredAt));
      },{timeout:180_000}).toBe(true);
    }finally{
      holdUntil=0;
      await context.unroute('**/party-api/status',intercept);
      await info.attach('native-retired-event-exit',{body:JSON.stringify({oldCycle,deferred,variant,communicationFaults,started,retiredAt,seed,exitOwnerSamples,final:await live.state().catch(error=>({error:String(error)})),events:await live.clients[W].events()}),contentType:'application/json'});
      await live.post('/formation',{character:W,eventSelections:[]});
      if(seed)await live.admin(`output=(()=>{const m=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})).find(m=>String(m.id)===${JSON.stringify(String(seed.id))}&&m.type==='mrpumpkin');if(m)remove_monster(m,{silent:true});delete E.mrpumpkin;broadcast_e();return true;})()`);
    }
  });
});

test('native event walking recovers owned CODE turnover after coordinator restart',async({live},info)=>{
  test.setTimeout(360_000);
  await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
  const seed=await live.admin(`output=(()=>{
    const type='mrpumpkin',original=G.monsters[type],dps=${JSON.stringify(fighters)}.reduce((n,name)=>{const p=get_player(name);return n+p.attack*p.frequency;},0);
    try{G.monsters[type]={...original,hp:Math.ceil(dps*600),attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
      const m=new_monster('halloween',{type,count:1,boundary:[-495,685,-495,685]},{temp:1});m.e2eRuntimeRecovery=true;
      E[type]={live:true,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:m.id,map:m.map,x:m.x,y:m.y};
    }finally{G.monsters[type]=original;}})()`);
  let before:any,failed:any,recovered:any,turnoverAt=0;
  const ownerObservations:any[]=[];
  try{
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await expect.poll(async()=>{const s=await live.state(),c=s.activeConvoy;
      if(c?.walkingActivity==='event'&&c.walkingEvent==='mrpumpkin'&&c.phase==='travel'){before=s;return true;}return false;
    },{timeout:90_000}).toBe(true);
    // Actual upstream CODE iframe replacement, with the same maintained loader.
    turnoverAt=Date.now();
    await live.clients[P].frame.evaluate(()=>{
      const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);
    });
    // Native replacement may recover through the communication barrier before
    // becoming terminal. Restart while turnover is in flight, preserving both
    // supported paths rather than requiring a transient failed heartbeat.
    failed=await live.state();
    await live.restartCoordinator();
    await expect.poll(async()=>{const s=await live.state(),c=s.activeConvoy;
      const fresh=fighters.every(name=>{const m=s.characters[name];return m?.hp>0&&!m.rip&&
        Date.now()-m.seenAt<3000&&m.joinedEvent==='mrpumpkin';});
      const identities=s.characters[P]?.dashboardRuntime!==before.activeConvoy.runtimes[P]&&
        s.characters[W]?.dashboardRuntime===before.activeConvoy.runtimes[W];
      if(c?.walkingEvent==='mrpumpkin'){
        ownerObservations.push({convoy:c,characters:Object.fromEntries(fighters.map(name=>[name,s.characters[name]]))});
        expect(c.recoveryAttempts||0).toBeGreaterThanOrEqual(before.activeConvoy.recoveryAttempts||0);
        expect(c.walkingFailures||0).toBeGreaterThanOrEqual(before.activeConvoy.walkingFailures||0);
        for(const name of c.participants){expect(fighters).toContain(name);
          expect(c.walkingParents[name].revision).toBe(before.activeConvoy.walkingParents[name].revision);}
        const owned=c.participants.every((name:string)=>{const report=s.characters[name]?.convoyNavigation,expected=c.expected?.[name];
          return report?.id===c.id&&report.runtimeId===c.runtimes?.[name]&&
            report.commandId===expected?.commandId&&report.navigationRevision===expected?.revision;});
        if(fresh&&identities&&owned&&c.phase!=='failed'){recovered=s;return true;}
      }
      // Completed navigation intentionally retires reports and commands. Native
      // attack receipts plus the original owner identities prove its handoff.
      if(!c&&fresh&&identities){const events=await live.clients[W].events();
        if(fighters.every(name=>events.some((e:any)=>e.event==='hit'&&String(e.data?.id)===String(seed.id)&&
          e.data?.hid===name&&e.at>turnoverAt))){recovered=s;return true;}}
      return false;
    },{timeout:60_000}).toBe(true);
    await expect.poll(async()=>{const events=await live.clients[W].events();return fighters.every(name=>events.some((e:any)=>e.event==='hit'&&String(e.data?.id)===String(seed.id)&&e.data?.hid===name&&e.at>turnoverAt));},{timeout:120_000}).toBe(true);
  }finally{
    await info.attach('native-event-runtime-turnover',{body:JSON.stringify({seed,before,turnoverAt,failed,recovered,ownerObservations,final:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.admin(`output=(()=>{const m=get_monster('mrpumpkin');if(m?.e2eRuntimeRecovery)remove_monster(m,{silent:true});delete E.mrpumpkin;broadcast_e();return true;})()`);
  }
});

test('native event selection replaces a failed old entry without waiting on another boss',async({live},info)=>{
  test.setTimeout(360000);
  // Failure inventory: CODE turnover plus a different genuine event selection
  // must not leave the old failed rendezvous holding both live event workflows.
  await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
  const seeds=await live.admin(`output=(()=>{const result={};
    for(const [type,x,y] of [['mrpumpkin',-495,685],['mrgreen',-495,650]]){
      const original=G.monsters[type];try{G.monsters[type]={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
        const m=new_monster('halloween',{type,count:1,boundary:[x,y,x,y]},{temp:1});
        result[type]={id:m.id,map:m.map,x:m.x,y:m.y};
        if(type==='mrpumpkin')E[type]={live:true,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};
      }finally{G.monsters[type]=original;}}
    broadcast_e();return result;})()`);
  const samples:unknown[]=[];
  let before:any;
  try {
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await expect.poll(async()=>{const s=await live.state();if(s.activeConvoy?.walkingEvent==='mrpumpkin'&&s.activeConvoy.phase==='travel'){before=s;return true;}return false;},{timeout:90000}).toBe(true);
    // A higher-priority live boss must preempt retained attendance for both
    // leader and follower, including after CODE turnover and persistence replay.
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin','mrgreen'],eventPriorities:['mrgreen','mrpumpkin','anniversary','abtesting','goobrawl','crabxx','franky','icegolem','snowman','slenderman']});
    await live.admin(`output=(()=>{const seed=${JSON.stringify(seeds.mrgreen)};E.mrgreen={live:true,...seed,hp:100000000,max_hp:100000000,end:Date.now()+600000};broadcast_e();return true;})()`);
    await live.clients[P].frame.evaluate(()=>{const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);});
    await live.restartCoordinator();
    await expect.poll(async()=>{const state=await live.state();
      const hits=await Promise.all([[W,'mrgreen'],[P,'mrgreen']].map(async([name,type])=>({name,type,hit:(await live.clients[name].events()).find((event:any)=>event.event==='hit'&&String(event.data?.id)===String(seeds[type].id)&&event.data?.hid===name&&event.data?.damage>0)})));
      samples.push({at:Date.now(),convoy:state.activeConvoy&&{id:state.activeConvoy.id,phase:state.activeConvoy.phase,event:state.activeConvoy.walkingEvent},characters:Object.fromEntries(fighters.map(name=>[name,{map:state.characters[name]?.map,event:state.characters[name]?.joinedEvent,runtime:state.characters[name]?.dashboardRuntime}])),hits});
      if(samples.length>64)samples.shift();
      return hits.every(value=>!!value.hit);
    },{timeout:180000,intervals:[500,1000],message:'Each genuinely selected boss must receive native fighter damage after CODE replacement and restart'}).toBe(true);
  } finally {
    await info.attach('native-different-event-turnover',{body:JSON.stringify({seeds,before,samples}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.admin(`output=(()=>{for(const [type,seed]of Object.entries(${JSON.stringify(seeds)})){
      const m=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})).find(m=>String(m.id)===String(seed.id)&&m.type===type);if(m)remove_monster(m,{silent:true});delete E[type];}broadcast_e();return true;})()`);
  }
});

test.describe('visible event boss separated by native terrain',()=>{
  test.use({initialPosition:{map:'halloween',x:-200,y:460}});
  test('native event route retains ownership until the visible boss is attack reachable',async({live},info)=>{
    test.setTimeout(240_000);
    await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
    await live.post('/travel',{map:'halloween',x:-200,y:460});
    await expect.poll(async()=>{
      const s=await live.state();if(s.activeConvoy)return false;
      return live.admin(`output=${JSON.stringify(fighters)}.every(name=>{const p=get_player(name);return p.map==='halloween'&&!p.moving&&Math.hypot(p.x+200,p.y-460)<65;})`);
    },{timeout:90_000}).toBe(true);
    const seed=await live.admin(`output=(()=>{
      const original=G.monsters.mrpumpkin;
      try{G.monsters.mrpumpkin={...original,hp:10000000,attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
        const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[-534,763,-534,763]},{temp:1});m.e2eTerrainApproach=true;
        E.mrpumpkin={live:true,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:m.id,map:m.map,x:m.x,y:m.y};
      }finally{G.monsters.mrpumpkin=original;}})()`);
    let baseline:any,walk:any,endpoint:any;
    try{
      await expect.poll(async()=>live.clients[W].frame.evaluate((id)=>!!(window as any).entities[id],String(seed.id)),{timeout:20_000}).toBe(true);
      baseline=await live.clients[W].frame.evaluate((id)=>{
        const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any,m=game.entities[id];
        return {visible:!!m,position:{map:game.character.map,x:game.character.x,y:game.character.y},boss:{x:m.x,y:m.y},direct:runner.can_move_to(m.x,m.y),inRange:runner.is_in_range(m)};
      },String(seed.id));
      expect(baseline.visible).toBe(true);expect(baseline.direct).toBe(false);expect(baseline.inRange).toBe(false);
      await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
      await expect.poll(async()=>{const s=await live.state();if(s.activeConvoy?.walkingEvent==='mrpumpkin')walk=s;
        const events=await live.clients[W].events();return events.some((e:any)=>e.event==='hit'&&String(e.data?.id)===String(seed.id)&&fighters.includes(e.data?.hid));},{timeout:150_000}).toBe(true);
      endpoint=await live.admin(`output=(()=>{const p=get_player('${W}');return {map:p.map,x:p.x,y:p.y};})()`);
      expect(endpoint.map).toBe('halloween');
      expect(Math.hypot(endpoint.x-baseline.position.x,endpoint.y-baseline.position.y)).toBeGreaterThan(100);
    }finally{
      await info.attach('native-visible-boss-terrain-approach',{body:JSON.stringify({seed,baseline,walk,endpoint,final:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
      await live.post('/formation',{character:W,eventSelections:[]});
      await live.admin(`output=(()=>{const m=get_monster('mrpumpkin');if(m?.e2eTerrainApproach)remove_monster(m,{silent:true});delete E.mrpumpkin;broadcast_e();return true;})()`);
    }
  });
});


test('native event limits exhaust only the current instance and survive restart', async ({live}, info) => {
  test.setTimeout(600000);
  // Failure modes: time is counted before entry or while another event owns
  // attendance; duplicate death reports exhaust too early; exhausted events
  // rejoin after reload/restart; new IDs remain incorrectly blacklisted;
  // blank limits become zero; exit loses the saved pre-event farming task.
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const checkpoint = {map:'halloween',x:-550,y:-290};
  await live.post('/travel',checkpoint);
  await expect.poll(async()=>{
    const state=await live.state();
    return fighters.every(name=>state.characters[name]?.map===checkpoint.map&&Math.hypot(state.characters[name].x-checkpoint.x,state.characters[name].y-checkpoint.y)<100)&&!state.activeConvoy;
  },{timeout:90000,message:'Both fighters must establish an explicit saved pre-event destination'}).toBe(true);
  const seeds = await live.admin(`output=(()=>{const result={};
    for(const [type,x,y] of [['mrpumpkin',-495,685],['mrgreen',-495,650]]){
      const original=G.monsters[type];try{G.monsters[type]={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
        const m=new_monster('halloween',{type,count:1,boundary:[x,y,x,y]},{temp:1});
        result[type]={id:String(m.id),map:m.map,x:m.x,y:m.y};
        E[type]={live:true,...result[type],hp:m.hp,max_hp:m.max_hp};
      }finally{G.monsters[type]=original;}}
    broadcast_e();return result;})()`);
  const samples:unknown[]=[];
  let death:unknown;
  try {
    await live.post('/formation',{character:W,eventLimits:{event:'mrpumpkin',limits:{deathLimit:null,timeLimitMinutes:0.5}}});
    await live.post('/formation',{character:W,eventLimits:{event:'mrgreen',limits:{deathLimit:0,timeLimitMinutes:null}}});
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin','mrgreen'],eventPriorities:['mrpumpkin','mrgreen','anniversary','abtesting','goobrawl','crabxx','franky','icegolem','snowman','slenderman']});
    await expect.poll(async()=>Promise.all(fighters.map(async name=>(await live.clients[name].events()).some((packet:any)=>packet.event==='hit'&&String(packet.data?.id)===seeds.mrpumpkin.id&&packet.data?.hid===name&&packet.data?.damage>0))).then(hits=>hits.every(Boolean)),{timeout:150000,message:'Both fighters must actually reach and fight Pumpkin before its attendance timer expires'}).toBe(true);
    await expect.poll(async()=>{
      const state=await live.state();
      const hits=await Promise.all(fighters.map(async name => (await live.clients[name].events()).some((packet:any)=>packet.event==='hit'&&String(packet.data?.id)===seeds.mrgreen.id&&packet.data?.hid===name&&packet.data?.damage>0)));
      samples.push({at:Date.now(),attendance:state.eventAttendance,convoy:state.activeConvoy?.phase,hits});
      return state.eventAttendance?.[W]?.mrpumpkin?.ignored==='time limit'&&hits.every(Boolean);
    },{timeout:180000,intervals:[500,1000],message:'The timed-out Pumpkin instance must hand attendance to native Green combat'}).toBe(true);
    death=await killNativeCharacter(live,W);
    await expect.poll(async()=>{
      const state=await live.state();
      samples.push({at:Date.now(),attendance:state.eventAttendance,eventReturn:state.eventReturn,characters:Object.fromEntries(fighters.map(name=>[name,{map:state.characters[name]?.map,event:state.characters[name]?.joinedEvent,rip:state.characters[name]?.rip}]))});
      return state.eventAttendance?.[W]?.mrgreen?.ignored==='death limit'&&fighters.every(name=>!state.characters[name]?.rip&&!state.characters[name]?.joinedEvent&&state.characters[name]?.map===checkpoint.map&&Math.hypot(state.characters[name].x-checkpoint.x,state.characters[name].y-checkpoint.y)<100)&&!state.eventReturn;
    },{timeout:180000,intervals:[500,1000],message:'The first actual death must exit Green and restore both fighters rather than rejoining'}).toBe(true);
    const exhaustedRuntime=(await live.state()).characters[W].dashboardRuntime;
    await live.clients[W].frame.evaluate(()=>{const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      game.start_runner('maincode',`$.getScript(${JSON.stringify(runner.__partyServer+'/CODE/adventure_land/universal-loader.js')});`);});
    const restartAt=Date.now();
    await live.restartCoordinator();
    const restarted=await live.state();
    expect(restarted.eventAttendance[W].mrgreen.deaths).toBe(1);
    expect(restarted.eventAttendance[W].mrgreen.ignored).toBe('death limit');
    await expect.poll(async()=>{
      const state=await live.state();
      return state.characters[W]?.seenAt>restartAt&&state.characters[W]?.dashboardRuntime!==exhaustedRuntime&&
        state.eventAttendance[W].mrgreen.deaths===1&&state.eventAttendance[W].mrgreen.ignored==='death limit'&&
        fighters.every(name=>!state.characters[name]?.joinedEvent);
    },{timeout:45000,message:'Fresh replacement CODE must keep the same live instance exhausted after backend restart'}).toBe(true);
    expect(restarted.eventSelectionsByCharacter[W]).toEqual(['mrpumpkin','mrgreen']);
    const replacement=await live.admin(`output=(()=>{const old=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})).find(m=>String(m.id)===${JSON.stringify(seeds.mrgreen.id)});if(old)remove_monster(old,{silent:true});
      const original=G.monsters.mrgreen;try{G.monsters.mrgreen={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
        const m=new_monster('halloween',{type:'mrgreen',count:1,boundary:[-495,650,-495,650]},{temp:1});
        E.mrgreen={live:true,id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {...E.mrgreen};
      }finally{G.monsters.mrgreen=original;}})()`);
    await expect.poll(async()=>Promise.all(fighters.map(async name=>(await live.clients[name].events()).some((packet:any)=>packet.event==='hit'&&String(packet.data?.id)===replacement.id&&packet.data?.hid===name&&packet.data?.damage>0))).then(hits=>hits.every(Boolean)),{timeout:150000,message:'A new native Green instance must receive native damage despite the prior exhausted instance'}).toBe(true);
    await info.attach('event-limit-new-instance',{body:JSON.stringify({replacement,state:await live.state()}),contentType:'application/json'});
  } finally {
    await info.attach('native-event-limit-ledger',{body:JSON.stringify({seeds,death,samples:samples.slice(-128),state:await live.state()}),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.admin(`output=(()=>{for(const type of ['mrgreen','mrpumpkin']){for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(m.type===type&&m.hp>1000000)remove_monster(m,{silent:true});delete E[type];}broadcast_e();return true;})()`);
  }
});
