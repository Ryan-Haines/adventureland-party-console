import {test,expect} from './live-fixtures';
import {W,P,evidence} from './hunt-interruption-helpers';

// The pinned native server's sMap does not admit (-873,-405). This nearby
// interior cell preserves the reported wall while allowing real native moves.
test.use({primaryClass:'mage',loadout:'combat-range',initialPosition:{map:'uhills',x:-830,y:-310}});

test('mage reengages a blocked Targetron from the reported UHills screenshot',async({live},info)=>{
  test.setTimeout(180000);
  // Failure inventory: docs/testing-targetron-mage-recovery.md.
  expect(await live.clients[W].run('character.ctype')).toBe('mage');
  expect(await live.clients[W].run('character.range')).toBeLessThan(220);
  const initialNative=await live.admin(`output=(()=>{const p=get_player('${W}');return {map:p.map,x:p.x,y:p.y,
    cell:smap_data[p.map]===-1?0:smap_data[p.map][rphash(p.x,p.y)],
    clear:can_move({map:p.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:p.base})};})()`);
  expect(initialNative.map).toBe('uhills');
  expect(initialNative.cell,'The pinned native server must admit the starting sMap cell').toBeLessThan(2);
  expect(initialNative.clear).toBe(true);
  await info.attach('targetron-mage-native-starting-cell',{body:JSON.stringify(initialNative),contentType:'application/json'});
  await live.post('/merchant/force-stand',{enabled:true});
  const isolation=await live.admin(`output=(()=>{
    // Declared world setup: one parked encounter, without unrelated natural
    // Targetrons changing the party's selected fight during this regression.
    globalThis.__e2eMageTargetronRespawns=[];
    for(let i=monster_respawns.length-1;i>=0;i--)if(monster_respawns[i][0].type==='targetron'&&monster_respawns[i][0].map==='uhills')
      globalThis.__e2eMageTargetronRespawns.push(monster_respawns.splice(i,1)[0]);
    const removed=[];
    for(const m of Object.values(instances.uhills.monsters))if(m.type==='targetron'){removed.push(String(m.id));remove_monster(m,{method:'disappear',nospawn:true});}
    return {removed,heldNativeRespawns:globalThis.__e2eMageTargetronRespawns.length};
  })()`);
  await info.attach('targetron-mage-declared-encounter-isolation',{body:JSON.stringify(isolation),contentType:'application/json'});
  try{
  await expect.poll(async()=>Promise.all([W,P].map(name=>live.clients[name].run(
    `${JSON.stringify(isolation.removed)}.filter(id=>parent.entities[id]&&!parent.entities[id].dead).length`))),
    {timeout:15000,message:'Native disappearance must retire removed Targetrons from both clients'}).toEqual([0,0]);
  const geometry=await live.clients[W].run(`(()=>{
    const origin={x:character.real_x,y:character.real_y},points=[];
    for(const radius of [0,32,64,96,128])for(let i=0;i<(radius?16:1);i++){
      const angle=i*Math.PI/8,x=-573+radius*Math.cos(angle),y=-80+radius*Math.sin(angle);
      const clear=can_move({map:character.map,x,y,going_x:x,going_y:y,base:character.base});
      const blocked=!can_move_to(x,y);
      if(clear&&blocked&&Math.hypot(x-origin.x,y-origin.y)>character.range+60)points.push({x,y,clear,blocked});
    }
    const priest=get_player('${P}'),priests=[];
    for(const goal of points)for(const radius of [0,32,64,96,128])for(let i=0;i<(radius?16:1);i++){
      const angle=i*Math.PI/8,x=-805+radius*Math.cos(angle),y=-224+radius*Math.sin(angle);
      if(!can_move({map:character.map,x,y,going_x:x,going_y:y,base:priest.base}))continue;
      const coverage=distance(character,{...priest,x,y,real_x:x,real_y:y});
      const targetDistance=distance({...priest,x,y,real_x:x,real_y:y},
        {...character,x:goal.x,y:goal.y,real_x:goal.x,real_y:goal.y});
      if(coverage<priest.range-Math.min(20,Math.max(8,priest.range*.1))&&targetDistance<priest.range-12)
        priests.push({x,y,goal,coverage,targetDistance});
    }
    return {map:character.map,origin,range:character.range,priestRange:priest.range,
      goal:priests[0]?.goal||null,priest:priests[0]||null};
  })()`);
  expect(geometry.goal,'Find a native collision-safe Targetron position across the screenshot terrain').toBeTruthy();
  await info.attach('targetron-mage-native-terrain-seed',{body:JSON.stringify(geometry),contentType:'application/json'});
  await live.clients[P].run(`smart_move({map:'uhills',x:${geometry.priest.x},y:${geometry.priest.y}})`);
  await expect.poll(()=>live.clients[P].run(`Math.hypot(character.real_x-(${geometry.priest.x}),character.real_y-(${geometry.priest.y}))`),
    {timeout:60000,message:'The native priest must reach the other side through real pathfinding'}).toBeLessThan(8);
  await live.post('/formation',{leader:W});
  await live.post('/focus',{character:P,monsterFocus:['targetron'],monsterPriorities:{targetron:999},monsterSearchRadius:600});
  await live.post('/farming-mode',{character:P,mode:'default'});
  await live.post('/focus',{monsterFocus:['targetron'],monsterPriorities:{targetron:999},monsterSearchRadius:600});
  await live.post('/farming-mode',{character:W,mode:'default'});
  await live.post('/checkpoint',{});
  const seed=await live.admin(`output=(()=>{const original=G.monsters.targetron;
    if(!original)throw Error('Native Targetron catalog missing');
    // Declared parked encounter; retain native hitboxes, targeting and damage.
    globalThis.__e2eMageTargetronDefinition=original;
    G.monsters.targetron={...original,speed:0,charge:0,hp:10000000};
    const m=new_monster('uhills',{type:'targetron',count:1,position:[${geometry.goal.x},${geometry.goal.y}],radius:0},{temp:1});
    m.speed=0;m.charge=0;
    target_player(m,get_player('${P}'));return {id:String(m.id),map:m.map,x:m.x,y:m.y,target:m.target};
  })()`);
  const samples:any[]=[];
  try{
    expect(await live.admin(`output=Object.values(instances.uhills.monsters).filter(m=>m.type==='targetron').map(m=>String(m.id))`),
      'The declared combat scenario starts with exactly its seeded Targetron').toEqual([seed.id]);
    expect(await live.clients[W].run('character.map'),'The mage must remain in UHills before combat').toBe('uhills');
    await expect.poll(async()=>(await live.clients[P].events()).some((event:any)=>event.event==='hit'&&
      String(event.data?.id)===seed.id&&event.data?.hid===P&&event.data?.damage>0),
      {timeout:30000,message:'The native priest must damage Targetron before joining the mage-led formation'}).toBe(true);
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>{
      const sample=await live.clients[W].run(`(()=>{const t=parent.entities[${JSON.stringify(seed.id)}],p=globalThis.partyCombatPosition;return {
        at:Date.now(),map:character.map,rip:!!character.rip,x:character.real_x,y:character.real_y,target:character.target,
        moving:!!character.moving,going:{x:character.going_x,y:character.going_y},
        segmentClear:character.moving?can_move_to(character.going_x,character.going_y):null,
        distance:t?distance(character,t):null,positioning:p?{at:p.at,mode:p.mode,movementOwner:p.movementOwner,target:p.target,
          reason:p.reason,constraint:p.constraint,healingDistance:p.healingDistance,healingRange:p.healingRange}:null};})()`);
      samples.push(sample);
      expect(sample.map,'Combat recovery must not send the mage to jail or another map').toBe('uhills');
      if(sample.moving&&sample.positioning?.movementOwner==='combat'&&sample.positioning?.target===seed.id)
        expect(sample.segmentClear,'Every observed combat-owned movement segment must be collision clear').toBe(true);
      return (await live.clients[W].events()).some((event:any)=>event.event==='hit'&&String(event.data?.id)===seed.id&&event.data?.hid===W&&event.data?.damage>0);
    },{timeout:60000,intervals:[100,250],message:'The mage must recover around native UHills terrain and damage Targetron'}).toBe(true);
    expect(samples.some(sample=>sample.distance!==null&&sample.distance<=geometry.range),
      'The mage must reach native attack range').toBe(true);
    expect(samples.some(sample=>sample.moving&&sample.segmentClear&&sample.positioning?.movementOwner==='combat'&&sample.positioning?.target===seed.id),
      'The selected native encounter must own collision-clear combat movement').toBe(true);
    expect(samples.some(sample=>Math.hypot(sample.x-geometry.origin.x,sample.y-geometry.origin.y)>10),
      'The mage must actually leave its initially blocked position').toBe(true);
    expect(await live.clients[W].run('character.rip')).toBeFalsy();
  }finally{
    await evidence(live,info,'targetron-mage-native-terrain-combat-recovery',{geometry,seed,samples,
      hits:(await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&String(event.data?.id)===seed.id&&event.data?.hid===W)});
    await info.attach('targetron-mage-native-terrain-view',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
    await live.admin(`output=(()=>{if(globalThis.__e2eMageTargetronDefinition){G.monsters.targetron=globalThis.__e2eMageTargetronDefinition;delete globalThis.__e2eMageTargetronDefinition;}const m=instances.uhills.monsters[${JSON.stringify(seed.id)}];if(m)remove_monster(m,{silent:true});return true;})()`);
  }
  }finally{
    await live.admin(`output=(()=>{
      monster_respawns.push(...(globalThis.__e2eMageTargetronRespawns||[]));
      delete globalThis.__e2eMageTargetronRespawns;
      if(globalThis.__e2eMageTargetronDefinition){G.monsters.targetron=globalThis.__e2eMageTargetronDefinition;delete globalThis.__e2eMageTargetronDefinition;}
      return true;
    })()`);
  }
});
