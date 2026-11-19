import {test,expect} from './live-fixtures';
import {W,P,M,world,quantity,beginAnniversary,endAnniversary,spawnRare,cleanupEvents} from './game/hunt-events';
import {prepareHunt,start,cycle,missionReached} from './game/hunt-lifecycle';
import {killedByParty} from './hunt-interruption-helpers';
import {isolateNativeMapAmbient,restoreNativeMapAmbient} from './native-map-ambient-isolation';

for(const mode of ['resume','restart','hunt-off'] as const) test(`native anniversary visit ${mode} delivers real kiss rewards and event deselection returns to current Hunt policy`,async({live},info)=>{
  test.setTimeout(420_000);
  try {
    const ambient=await isolateNativeMapAmbient(live,'main');
    await info.attach('anniversary-native-ambient-input',{body:JSON.stringify(ambient),contentType:'application/json'});
    const hunt=await prepareHunt(live,{count:500});await start(live,W,hunt.monster,hunt.location);const cycleId=await cycle(live);
    await live.post('/formation',{character:W,eventSelections:['anniversary']});
    await live.post('/formation',{character:M,eventSelections:['anniversary']});
    const before=await world(live),seed=await beginAnniversary(live,P);
    await info.attach('anniversary-native-initial-schedule',{body:JSON.stringify(seed),contentType:'application/json'});
    await expect.poll(async()=>(await world(live)).anniversary?.live,{timeout:30_000}).toBe(true);
    await expect.poll(async()=>(await live.state()).anniversary?.eventCycle?.id,{timeout:45_000}).toBeTruthy();
    await expect.poll(async()=>quantity((await world(live)).players[M].items,'anniversarygift'),{timeout:120_000,message:'The actual upstream kiss must deliver a gift'}).toBe(quantity(before.players[M].items,'anniversarygift')+1);
    const afterGift=await world(live);
    if(mode==='restart')await live.restartCoordinator();
    if(mode==='hunt-off')await live.post('/farming-mode',{character:W,mode:'default'});
    // Explicit user deselection is the completion trigger. The initial native
    // scheduling clock does not claim coverage of natural wall-clock expiry.
    await live.post('/formation',{character:W,eventSelections:[]});
    await live.post('/formation',{character:M,eventSelections:[]});
    await endAnniversary(live);
    if(mode==='hunt-off') {
      await expect.poll(async()=>(await live.state()).monsterHunt,{timeout:45_000}).toBeFalsy();
      await expect.poll(async()=>(await live.state()).anniversary?.eventCycle?.returnCompletedAt||!(await live.state()).anniversary?.eventCycle,{timeout:90_000}).toBeTruthy();
      expect((await live.state()).monsterHunt).toBeFalsy();
    } else {
      // The Hunt owner writes no 'paused' stage; the mission poll below carries the resume.
      await expect.poll(async()=>(await live.state()).monsterHunt?.cycleId,{timeout:90_000}).toBe(cycleId);
      const count=afterGift.players[W].quest.c;
      // The retained mission must be physically reached before declaring its
      // next native encounter; ambient spawn availability is not recovery proof.
      await missionReached(live,cycleId,'Both actual fighters must reach the retained Hunt mission before its next encounter');
      const state=await live.state(),destination=state.monsterHunt.missions[state.monsterHunt.currentIndex].destination;
      const encounter=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)}),destination=${JSON.stringify(destination)},bounds=destination.boundary;
        for(const [dx,dy] of [[35,0],[-35,0],[0,35],[0,-35]]){const x=p.x+dx,y=p.y+dy;
          if(x<bounds[0]||x>bounds[2]||y<bounds[1]||y>bounds[3]||!can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))continue;
          const m=new_monster(p.in,{__e2eAmbientExempt:true,type:'goo',position:[x,y],radius:0,count:1},{temp:1});m.e2eHunt=true;
          return {id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,destination};}
        throw Error('No reachable native encounter inside retained Goo mission');})()`);
      await info.attach('anniversary-resumed-native-encounter',{body:JSON.stringify({mode,encounter}),contentType:'application/json'});
      const kill=await killedByParty(live,encounter.id);
      await info.attach('anniversary-resumed-native-kill',{body:JSON.stringify(kill),contentType:'application/json'});
      await expect.poll(async()=>(await world(live)).players[W].quest?.c,{timeout:120_000}).toBeLessThan(count);
    }
    expect(quantity((await world(live)).players[M].items,'anniversarygift')).toBe(quantity(before.players[M].items,'anniversarygift')+1);
    await info.attach('anniversary-native-hunt-result',{body:JSON.stringify({mode,cycleId,before,afterGift,final:await world(live),state:await live.state()}),contentType:'application/json'});
  } finally {
    try {await cleanupEvents(live);} finally {
      const restored=await restoreNativeMapAmbient(live,true);
      await info.attach('anniversary-native-ambient-restored',{body:JSON.stringify(restored),contentType:'application/json'});
    }
  }
});

test('disabled anniversary selection leaves native Hunt fighting and creates no visit reward',async({live},info)=>{
  test.setTimeout(300_000);
  try {
    const ambient=await isolateNativeMapAmbient(live,'main');
    await info.attach('disabled-anniversary-native-ambient-input',{body:JSON.stringify(ambient),contentType:'application/json'});
    const hunt=await prepareHunt(live,{count:500});await start(live,W,hunt.monster,hunt.location);
    const cycleId=await cycle(live),before=await world(live);
    const seed=await beginAnniversary(live,M);
    await expect.poll(async()=>(await world(live)).anniversary?.live,{timeout:30_000}).toBe(true);
    await missionReached(live,cycleId,'Disabled Anniversary must leave both native fighters at the current Hunt mission');
    const missionState=await live.state(),mission=missionState.monsterHunt.missions[missionState.monsterHunt.currentIndex];
    const encounter=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)}),destination=${JSON.stringify(mission.destination)},bounds=destination.boundary;
      if(p.map!==destination.map)throw Error('Native Hunt actor left its declared mission map');
      const points=[[35,0],[-35,0],[0,35],[0,-35]].map(([dx,dy])=>({x:p.x+dx,y:p.y+dy}));
      for(let x=bounds[0];x<=bounds[2];x+=20)for(let y=bounds[1];y<=bounds[3];y+=20)points.push({x,y});
      points.sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
      for(const {x,y} of points){
        if(x<bounds[0]||x>bounds[2]||y<bounds[1]||y>bounds[3]||!can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))continue;
        const m=new_monster(p.in,{__e2eAmbientExempt:true,type:'goo',position:[x,y],radius:0,count:1},{temp:1});m.e2eHunt=true;
        return {id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,destination};}
      throw Error('No reachable native encounter inside disabled-Anniversary Goo mission');})()`);
    await info.attach('anniversary-disabled-native-encounter',{body:JSON.stringify(encounter),contentType:'application/json'});
    const kill=await killedByParty(live,encounter.id);
    await info.attach('anniversary-disabled-native-kill',{body:JSON.stringify(kill),contentType:'application/json'});
    await expect.poll(async()=>(await world(live)).players[W].quest?.c,{timeout:120_000}).toBeLessThan(before.players[W].quest.c);
    const state=await live.state(),after=await world(live);
    expect(state.monsterHunt.cycleId).toBe(cycleId);
    expect(quantity(after.players[W].items,'anniversarygift')).toBe(quantity(before.players[W].items,'anniversarygift'));
    expect(after.players[W].conditions.anniversary_kiss).toBeFalsy();
    await info.attach('anniversary-disabled-native-evidence',{body:JSON.stringify({seed,before,after,state}),contentType:'application/json'});
  } finally {
    try {await cleanupEvents(live);} finally {
      await info.attach('disabled-anniversary-native-ambient-restored',{body:JSON.stringify(await restoreNativeMapAmbient(live,true)),contentType:'application/json'});
    }
  }
});

test('disabled rare stays alive while native Hunt progresses and rejected settings preserve preferences',async({live},info)=>{
  test.setTimeout(300_000);
  try {
    const hunt=await prepareHunt(live,{count:500});await start(live,W,hunt.monster,hunt.location);const cycleId=await cycle(live);
    await expect.poll(async()=>(await live.state()).monsterHunt?.stage,{timeout:120_000}).toBe('farming');
    await live.post('/rare-hunting',{rules:{goldenbat:{enabled:false}},useFieldGenerators:false});
    const saved=(await live.state()).passiveHunting;
    for(const body of [{goldenbat:'true'},{rules:{fieldgen0:{enabled:true}}},{rules:{unknown_native_monster:{enabled:true}}}]) {
      const r=await fetch(live.url+'/party-api/rare-hunting',{method:'POST',headers:{'Content-Type':'application/json',Origin:live.url},body:JSON.stringify(body)});
      expect(r.status).toBe(400);
    }
    expect((await live.state()).passiveHunting).toEqual(saved);
    const spawn=await spawnRare(live,'goldenbat'),before=await world(live);
    await expect.poll(async()=>(await world(live)).players[W].quest?.c,{timeout:90_000}).toBeLessThan(before.players[W].quest.c);
    expect(await live.admin(`output=!!instances[${JSON.stringify(spawn.map)}]?.monsters[${JSON.stringify(spawn.id)}]`)).toBe(true);
    expect((await live.state()).monsterHunt.cycleId).toBe(cycleId);
    await info.attach('native-disabled-rare',{body:JSON.stringify({spawn,before,final:await world(live),state:await live.state()}),contentType:'application/json'});
  } finally {await cleanupEvents(live);}
});
