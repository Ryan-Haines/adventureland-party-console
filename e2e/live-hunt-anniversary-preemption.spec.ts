import {test,expect} from './live-fixtures';
import {W,P,M,world,quantity,beginAnniversary,endAnniversary,cleanupEvents} from './game/hunt-events';
import {prepareHunt,start,cycle,missionReached} from './game/hunt-lifecycle';
import {killedByParty} from './hunt-interruption-helpers';
import {isolateNativeMapAmbient,restoreNativeMapAmbient} from './native-map-ambient-isolation';

test('an old Anniversary preemption response cannot stop the resumed native Hunt',async({live},info)=>{
  // Failure inventory: a delayed permission can outlive its cancelled convoy;
  // stopping its replacement consumes Hunt recovery budget and can strand it.
  // Keep native movement/rewards/kill receipts, exact owner evidence and zero retries.
  test.setTimeout(420_000);
  // The coordinator answers the priest's Anniversary admission in its report reply. The route takes
  // the first reply that admits it while a walk holds the priest out of that reply, and puts it into
  // a later reply once a newer Hunt walk owns the priest's movement (or 90 s pass): the stale
  // admission must not stop that walk.
  const context=live.clients[P].page.context();
  const fault:{cancelled:boolean;handoff:any}={cancelled:false,handoff:null};
  const owned=()=>live.clients[P].run(`(()=>{const c=partyMovement.convoyNavigationReport(),m=globalThis.__partyMovement.report();
    return c&&m&&!m.done&&m.owner?.convoyId===c.id?{current:c,movement:m}:null;})()`).catch(()=>null);
  const handler=async(route:import('@playwright/test').Route)=>{
    let body:any;try{body=route.request().postDataJSON();}catch{await route.fallback();return;}
    if(fault.cancelled||body?.name!==P||fault.handoff?.releasedAt){await route.fallback();return;}
    const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:5000}),result=await response.json();
    const handoff=fault.handoff;
    if(!handoff){
      const owner=response.ok()&&result.eventAdmission?.event==='anniversary'&&result.eventAdmission.allowed===true?await owned():null;
      if(owner)fault.handoff={command:owner.current.commandId,owner,permissionAt:Date.now(),permission:result.eventAdmission};
      await route.fulfill({response,json:owner?{...result,eventAdmission:null}:result});return;
    }
    const current=await owned();
    if(current&&current.current.commandId!==handoff.command)handoff.replacement={at:Date.now(),...current};
    if(!handoff.replacement&&Date.now()<handoff.permissionAt+90000){await route.fulfill({response,json:result});return;}
    handoff.releasedAt=Date.now();
    await route.fulfill({response,json:{...result,eventAdmission:handoff.permission}});
  };
  await context.route('**/party-api/status',handler);
  try {
    const ambient=await isolateNativeMapAmbient(live,'main');
    await info.attach('anniversary-native-ambient-input',{body:JSON.stringify(ambient),contentType:'application/json'});
    await live.post('/formation',{character:W,eventSelections:['anniversary']});
    await live.post('/formation',{character:M,eventSelections:['anniversary']});
    const hunt=await prepareHunt(live,{count:500});await start(live,W,hunt.monster,hunt.location);const cycleId=await cycle(live);
    await expect.poll(async()=>live.clients[P].run(`(()=>{const c=partyMovement.convoyNavigationReport(),m=globalThis.__partyMovement.report();return !!(c&&m&&!m.done&&m.owner?.convoyId===c.id);})()`),{timeout:30000,intervals:[25,50],message:'Own real priest Hunt movement before Anniversary'}).toBe(true);
    const before=await world(live),seed=await beginAnniversary(live,P);
    await info.attach('anniversary-native-initial-schedule',{body:JSON.stringify(seed),contentType:'application/json'});
    await expect.poll(async()=>(await world(live)).anniversary?.live,{timeout:30_000}).toBe(true);
    await expect.poll(async()=>(await live.state()).anniversary?.eventCycle?.id,{timeout:45_000}).toBeTruthy();
    await expect.poll(async()=>quantity((await world(live)).players[M].items,'anniversarygift'),{timeout:120_000,message:'The actual upstream kiss must deliver a gift'}).toBe(quantity(before.players[M].items,'anniversarygift')+1);
    const afterGift=await world(live);
    await expect.poll(()=>!!fault.handoff?.permissionAt,{timeout:30000,message:"Hold the Anniversary admission the priest's walk received"}).toBe(true);
    // Explicit user deselection is the completion trigger. The initial native
    // scheduling clock does not claim coverage of natural wall-clock expiry.
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.post('/formation',{character:M,eventSelections:[]});
    await endAnniversary(live);
    await expect.poll(()=>!!fault.handoff?.releasedAt,{timeout:90000,message:'Real resumed Hunt movement must release the older admission'}).toBe(true);
    const handoff=fault.handoff;
    expect(handoff.replacement,'Real Hunt replacement must cross the old permission continuation').toBeTruthy();
    expect(handoff.replacement.current.commandId).not.toBe(handoff.command);
    await expect.poll(async()=>{const h=(await live.state()).monsterHunt;return h?.cycleId===cycleId&&!['paused-event','paused'].includes(h.stage);},{timeout:90_000}).toBe(true);
    const count=afterGift.players[W].quest.c;
    // The retained mission must be physically reached before declaring its
    // next native encounter; ambient spawn availability is not recovery proof.
    await missionReached(live,cycleId,'Both actual fighters must reach the retained Hunt mission before its next encounter');
    const state=await live.state(),destination=state.monsterHunt.missions[state.monsterHunt.currentIndex].destination;
    await info.attach('anniversary-preempt-route-ledger',{body:JSON.stringify(state.monsterHunt.routeRecovery||{}),contentType:'application/json'});
    expect(Object.values(state.monsterHunt.routeRecovery||{}).flatMap((r:any)=>r.attempts||[]),'Old Anniversary preemption must not fail newer Hunt travel').toHaveLength(0);
    const encounter=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)}),destination=${JSON.stringify(destination)},bounds=destination.boundary;
      for(const [dx,dy] of [[35,0],[-35,0],[0,35],[0,-35]]){const x=p.x+dx,y=p.y+dy;
        if(x<bounds[0]||x>bounds[2]||y<bounds[1]||y>bounds[3]||!can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))continue;
        const m=new_monster(p.in,{__e2eAmbientExempt:true,type:'goo',position:[x,y],radius:0,count:1},{temp:1});m.e2eHunt=true;
        return {id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,destination};}
      throw Error('No reachable native encounter inside retained Goo mission');})()`);
    await info.attach('anniversary-resumed-native-encounter',{body:JSON.stringify({encounter}),contentType:'application/json'});
    const kill=await killedByParty(live,encounter.id);
    await info.attach('anniversary-resumed-native-kill',{body:JSON.stringify(kill),contentType:'application/json'});
    await expect.poll(async()=>(await world(live)).players[W].quest?.c,{timeout:120_000}).toBeLessThan(count);
    expect(quantity((await world(live)).players[M].items,'anniversarygift')).toBe(quantity(before.players[M].items,'anniversarygift')+1);
    await info.attach('anniversary-native-hunt-result',{body:JSON.stringify({cycleId,before,afterGift,final:await world(live),state:await live.state()}),contentType:'application/json'});
  } finally {
    fault.cancelled=true;await context.unroute('**/party-api/status',handler);
    await info.attach('anniversary-preempt-ownership',{body:JSON.stringify(fault.handoff),contentType:'application/json'});

    try {await cleanupEvents(live);} finally {
      const restored=await restoreNativeMapAmbient(live,true);
      await info.attach('anniversary-native-ambient-restored',{body:JSON.stringify(restored),contentType:'application/json'});
    }
  }
});
