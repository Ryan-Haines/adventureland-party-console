import {contains} from '../dashboard/lib/farming-zones';
import {test,expect} from './live-fixtures';
import {observeNativePlanner} from './native-planner-observation';

const W='E2EWarrior',P='E2EPriest',members=[W,P];
// Declare separated native actors before login so manual travel must assemble
// a real follower route instead of sometimes beginning already co-located.
test.use({initialConsoleHold:true,initialPositions:{[W]:{map:'halloween',x:0,y:0},[P]:{map:'halloween',x:1212,y:101}}});

// Failure inventory and lifecycle declaration: docs/testing-manual-event-override.md.
for(const entry of ['command','travel','monster'] as const){
test(`explicit ${entry} travel skips only the current native event occurrence`,async({live},info)=>{
  test.setTimeout(480_000);
  const samples:unknown[]=[],retirements:unknown[]=[];
  const world=()=>live.admin(`output=Object.fromEntries(${JSON.stringify(members)}.map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,rip:!!p.rip,moving:!!p.moving}]}))`);
  const context=live.clients[P].page.context(),planningFaults:unknown[]=[],recoveryHolds:unknown[]=[],unmatchedPlans:unknown[]=[];
  const observer=observeNativePlanner(context);
  let faultArmed=false;
  const interruptInitialPlan=async(route:import('@playwright/test').Route)=>{
    const request=route.request(),body=request.method()==='POST'?request.postDataJSON():null;
    if(faultArmed&&body?.character===P&&planningFaults.length===0){
      const started=Date.now();
      // Initial assembly may not have emitted its first status packet yet.
      // Read the current native CODE through its game DOM in ONE round trip;
      // do not run the multi-step iframe reacquisition helper or wait for a tick.
      const [sample,s]=await Promise.all([
        live.clients[P].frame.evaluate(()=>{
          const runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
          return {movement:runner?.__partyMovement?.report?.(),trace:runner?.sharedRoutine?.combatTraceSnapshot?.(),
            revision:runner?.__partyNavigationIntent?.revision,commandId:runner?.__partyLastCommand};
        }),live.state()]);
      const c=s.activeConvoy,expected=c?.expected?.[P],rally=c?.rally;
      const owner={id:sample.trace?.convoy,epoch:sample.trace?.convoyEpoch,phase:sample.trace?.convoyPhase,
        commandId:sample.commandId,navigationRevision:sample.revision,runtimeId:expected?.runtimeId};
      if(faultArmed&&planningFaults.length===0&&Date.now()-started<1500&&sample.movement?.id===body.id&&
        !sample.movement.done&&String(body.id).startsWith(P+':'+expected?.runtimeId+':')&&
        c?.phase==='assemble'&&c.purpose==='party-travel'&&!c.runtimes&&expected?.phase==='assemble'&&
        rally&&body.to?.map===rally.map&&body.to.x===rally.x&&body.to.y===rally.y&&
        owner.phase==='assembling'&&owner.id===c.id&&owner.epoch===c.epoch&&
        owner.commandId===expected.commandId&&owner.navigationRevision===expected.revision){
        planningFaults.push({at:Date.now(),request:body,movement:sample.movement,owner,convoy:c,elapsedMs:Date.now()-started});
        await route.abort('connectionreset');return;
      }
      unmatchedPlans.push({at:Date.now(),request:body,owner,reportedMovement:sample.movement,
        convoy:c?.id,epoch:c?.epoch,expected,rally,elapsedMs:Date.now()-started});
      if(unmatchedPlans.length>32)unmatchedPlans.shift();
    }
    await route.continue();
  };
  if(entry==='travel')await context.route('**/party-api/movement-plan',interruptInitialPlan);
  let ownedId:string|undefined;
  let competingReturn=false;
  const declare=async()=>{
    const result=await live.admin(`output=(()=>{
      const existing=Object.values(instances.halloween.monsters).filter(m=>m.type==='mrpumpkin');
      if(existing.length)throw Error('Declare an event only after its previous occurrence is retired');
      if(!globalThis.__e2eManualEventCatalog){
        const original=G.monsters.mrpumpkin,configured={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,rage:0,peaceful:true,spawns:[]};
        globalThis.__e2eManualEventCatalog={original,configured};G.monsters.mrpumpkin=configured;
      }
      if(G.monsters.mrpumpkin!==globalThis.__e2eManualEventCatalog.configured)throw Error('Declared event catalog ownership changed');
      {
        const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[-495,685,-495,685]},{temp:1});
        E.mrpumpkin={live:true,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();
        return {id:String(m.id),map:m.map,x:m.x,y:m.y};
      }})()`);
    ownedId=result.id;return result;
  };
  const retire=async()=>{
    if(!ownedId)return;
    const retirement=await live.admin(`output=(()=>{const id=${JSON.stringify(ownedId)},m=instances.halloween.monsters[id];
      if(m){if(m.type!=='mrpumpkin'||!m.temp)throw Error('Declared temporary encounter identity changed');remove_monster(m,{silent:true});}
      delete E.mrpumpkin;broadcast_e();return {retired:id,temporary:!!m?.temp,remainingNativeTypeCount:monster_c.mrpumpkin,feedPresent:!!E.mrpumpkin};})()`);
    retirements.push(retirement);ownedId=undefined;
  };
  try{
    // Same exact declared-ID boundary as the Halloween suite's beforeEach.
    // The prior return scenario can legitimately leave its fixture boss alive.
    const baseline=await live.admin(`output=(()=>{
      const declared=globalThis.__e2eHalloweenDeclared||{},owned=new Set(Object.keys(declared));
      const monsters=Object.values(instances).flatMap(instance=>Object.values(instance.monsters||{}));
      let changed=true;while(changed){changed=false;for(const monster of monsters)
        if(monster.master!=null&&owned.has(String(monster.master))&&!owned.has(String(monster.id))){owned.add(String(monster.id));changed=true;}}
      const removed=[];
      for(const monster of monsters){const id=String(monster.id),definition=declared[id];
        if(!owned.has(id)||definition&&definition.type!==monster.type)continue;
        removed.push({id,type:monster.type,master:monster.master,temporary:!!monster.temp});
        remove_monster(monster,{silent:true});delete declared[id];
      }
      const schedule=globalThis.__e2eHalloweenAnnouncements?.mrpumpkin;
      if(schedule){clearInterval(schedule.timer);delete globalThis.__e2eHalloweenAnnouncements.mrpumpkin;}
      const remaining=Object.values(instances.halloween.monsters).filter(monster=>monster.type==='mrpumpkin').map(monster=>({id:String(monster.id),type:monster.type}));
      if(!remaining.length)delete E.mrpumpkin;
      broadcast_e();return {removed,remaining,scope:'between-case exact declared native IDs and actual descendants'};
    })()`);
    await info.attach('native-manual-event-initial-world',{body:JSON.stringify(baseline),contentType:'application/json'});
    expect(baseline.remaining,'An unrelated live Pumpkin cannot be replaced by this fixture').toEqual([]);
    await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:false});
    const first=await declare();
    await live.post('/formation',{character:W,eventSelections:['mrpumpkin']});
    await live.post('/formation',{character:P,eventSelections:['mrpumpkin']});
    live.consoleDrainLease(null);
    await expect.poll(async()=>{const s=await live.state(),native=await world();
      return members.every(name=>native[name].map==='halloween'&&s.characters[name]?.joinedEvent==='mrpumpkin'&&
        s.eventAttendance?.[name]?.mrpumpkin?.id===null);
    },{timeout:120_000,message:'Both native actors must really attend the declared occurrence'}).toBe(true);
    await live.post('/formation',{character:P,follow:true});
    const destination=entry==='monster' ? (await live.state(true)).monsterChoices.find((choice:any)=>choice.id==='goo').locations.find((location:any)=>location.map==='main') : {map:'main',x:0,y:0};
    expect(destination).toBeTruthy();
    faultArmed=entry==='travel';
    const response=entry==='command'
      ?await live.post('/command',{character:W,type:'party-monster-travel',location:destination,label:'manual event override regression'})
      :entry==='monster' ? await live.post('/navigate-to-monster',{monsterId:'goo',location:destination}) : await live.post('/travel',destination);
    const issuedAt=Date.now();
    await expect.poll(async()=>{
      const s=await live.state(),native=await world();
      competingReturn ||= !!s.eventReturn?.participants?.some((name:string)=>members.includes(name));
      const c=s.activeConvoy;
      if(c?.phase==='communication-hold'&&members.every(name=>{
        const status=s.characters[name],report=status?.convoyNavigation,expected=c.expected?.[name];
        return !native[name].moving&&!native[name].rip&&status?.seenAt>=Date.now()-3000&&
          report?.phase==='held'&&report.id===c.id&&report.epoch===c.epoch&&expected&&
          report.commandId===expected.commandId&&report.navigationRevision===expected.revision&&report.runtimeId===expected.runtimeId;
      }))recoveryHolds.push({at:Date.now(),convoy:c,native});
      samples.push({at:Date.now(),convoy:s.activeConvoy?.id,return:s.eventReturn,
        attendance:s.eventAttendance,characters:Object.fromEntries(members.map(name=>[name,{native:native[name],joined:s.characters[name]?.joinedEvent}]))});
      if(samples.length>64)samples.shift();
      return members.every(name=>native[name].map==='main'&&!native[name].rip&&(entry==='monster'?contains(destination,native[name],150,500):Math.hypot(native[name].x,native[name].y)<100))&&!s.activeConvoy;
    },{timeout:180_000,message:'Explicit travel must reach its native destination without an event rejoin stealing the route'}).toBe(true);
    expect(competingReturn,'No forced return may compete with explicit manual travel').toBe(false);
    if(entry==='travel'){
      expect(planningFaults,'The initial follower route must encounter the declared transport failure').toHaveLength(1);
      expect(recoveryHolds.length,'Both clients must freshly acknowledge the stopped recovery hold').toBeGreaterThan(0);
    }
    if(entry==='monster') {
      await expect.poll(async()=>{const s=await live.state(),native=await world(),packets=await live.clients[W].events();
        return !s.activeConvoy && members.every(name=>native[name].map==='main' && !native[name].rip && !s.characters[name]?.joinedEvent && packets.some((event:any)=>event.at>=issuedAt&&event.event==='hit'&&event.data?.hid===name&&event.data?.damage>0));
      },{timeout:120_000,message:'Selecting a new farm during the event must resume actual native farming for both members'}).toBe(true);
    }
    const arrivedAt=Date.now();
    await live.restartCoordinator();
    let rejoined=false;
    await expect.poll(async()=>{
      const s=await live.state(),native=await world();
      rejoined ||= members.some(name=>native[name].map==='halloween'||s.characters[name]?.joinedEvent==='mrpumpkin');
      expect(rejoined,'No current-occurrence rejoin after explicit travel or coordinator restart').toBe(false);
      return members.every(name=>s.characters[name]?.seenAt>=arrivedAt+10_000);
    },{timeout:30_000}).toBe(true);
    for(const name of members){
      const denied=await live.post('/hunt-event-permission',{character:name,event:'mrpumpkin'});
      expect(denied.allowed).toBe(false);
      await live.post('/event-disabled',{character:name,event:'mrpumpkin'});
      expect((await live.state()).eventReturn,'Manual override must not create a competing event return').toBeFalsy();
    }
    const skipped=await live.state();
    expect(skipped.eventSelectionsByCharacter[W]).toContain('mrpumpkin');
    for(const name of members)expect(skipped.eventAttendance[name].mrpumpkin.ignored).toBe('manual travel');
    await retire();
    await expect.poll(async()=>{const s=await live.state();
      return members.every(name=>s.eventAttendance?.[name]?.mrpumpkin?.ended===true);
    },{timeout:30_000,message:'Anonymous native occurrence must genuinely end before the next begins'}).toBe(true);
    const second=await declare();expect(second.id).not.toBe(first.id);
    await expect.poll(async()=>{const s=await live.state(),native=await world();
      return members.every(name=>native[name].map==='halloween'&&s.characters[name]?.joinedEvent==='mrpumpkin'&&
        s.eventAttendance?.[name]?.mrpumpkin?.id===null&&!s.eventAttendance[name].mrpumpkin.ignored);
    },{timeout:120_000,message:'The unchanged selection must admit a new actual native occurrence'}).toBe(true);
    await info.attach('native-manual-event-occurrence-override',{body:JSON.stringify({first,second,destination,response,issuedAt,arrivedAt,skipped,samples,retirements,
      native:await world(),state:await live.state(),events:await live.clients[W].events()}),contentType:'application/json'});
  }finally{
    faultArmed=false;
    if(entry==='travel')await context.unroute('**/party-api/movement-plan',interruptInitialPlan);
    observer.dispose();
    await info.attach('native-manual-event-assembly-transport',{body:JSON.stringify({planningFaults,unmatchedPlans,requestFailures:observer.failures,recoveryHolds,samples}),contentType:'application/json'});
    try{await live.post('/formation',{character:W,eventSelections:[]});await live.post('/formation',{character:P,follow:false});await live.post('/formation',{character:P,eventSelections:[]});}
    finally{try{await retire();}finally{await live.admin(`output=(()=>{const owned=globalThis.__e2eManualEventCatalog;
      if(!owned)return null;if(G.monsters.mrpumpkin!==owned.configured)throw Error('Declared event catalog ownership changed before restore');
      G.monsters.mrpumpkin=owned.original;delete globalThis.__e2eManualEventCatalog;return {restored:true};})()`);}}
  }
});

}
