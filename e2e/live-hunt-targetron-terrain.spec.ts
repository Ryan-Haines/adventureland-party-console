import {test,expect} from './live-fixtures';
import {W,P,evidence,clearMap,nativeHit,approachOwned} from './hunt-interruption-helpers';

test.use({loadout:'combat-range',initialPosition:{map:'uhills',x:-573,y:-80}});

test('warrior recovers a blocked Targetron approach in the reported UHills layout',async({live},info)=>{
  test.setTimeout(180000);
  // Failure inventory: docs/testing-targetron-terrain-recovery.md.
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
  await live.post('/focus',{monsterFocus:[]});
  // Isolate the declared terrain encounter from randomized roaming spawns.
  await clearMap(live,'uhills');
  const setupOwnership:any[]=[];
  try{
    await expect.poll(async()=>{
      const actors=await Promise.all([W,P].map(name=>live.clients[name].run(`(()=>{const r=globalThis,s=r.sharedRoutine,g=r.__partyGroupedCombat;return {name:character.name,focus:r.partyHunting?.farm.focus().slice(),target:g?.target?.id||null,independent:r.partyQueueClient?.independent?.report?.()||null};})()`)));
      setupOwnership.push({at:Date.now(),actors});if(setupOwnership.length>32)setupOwnership.splice(4,1);
      return actors.every(actor=>Array.isArray(actor.focus)&&actor.focus.length===0&&!actor.target&&!actor.independent);
    },{timeout:15000,message:'Native CODE must retire ambient targeting before the declared Priest placement'}).toBe(true);
  }finally{await info.attach('targetron-native-setup-ownership',{body:JSON.stringify(setupOwnership),contentType:'application/json'});}
  const geometry=await live.clients[W].run(`(()=>{
    const origin={x:character.real_x,y:character.real_y},points=[];
    for(const radius of [0,32,64,96,128])for(let i=0;i<(radius?16:1);i++){
      const angle=i*Math.PI/8,x=-805+radius*Math.cos(angle),y=-224+radius*Math.sin(angle);
      const clear=can_move({map:character.map,x,y,going_x:x,going_y:y,base:character.base});
      const blocked=!can_move_to(x,y);
      if(clear&&blocked&&Math.hypot(x-origin.x,y-origin.y)>character.range+60)points.push({x,y,clear,blocked});
    }
    return {map:character.map,origin,range:character.range,goal:points[0]||null};
  })()`);
  expect(geometry.goal,'Find a native collision-safe Targetron position across the screenshot terrain').toBeTruthy();
  await info.attach('targetron-native-terrain-seed',{body:JSON.stringify(geometry),contentType:'application/json'});
  await live.clients[P].run(`smart_move({map:'uhills',x:${geometry.goal.x},y:${geometry.goal.y}})`);
  await expect.poll(()=>live.clients[P].run(`Math.hypot(character.real_x-(${geometry.goal.x}),character.real_y-(${geometry.goal.y}))`),
    {timeout:60000,message:'The native priest must reach the other side through real pathfinding'}).toBeLessThan(8);
  await live.post('/focus',{monsterFocus:['targetron'],monsterPriorities:{targetron:999},monsterSearchRadius:600});
  await live.post('/farming-mode',{character:W,mode:'default'});
  await live.post('/checkpoint',{});
  await live.clients[W].run('parent.__e2eObserveMoves=true;parent.__e2eObservedMoveCount=0');
  const seed=await live.admin(`output=(()=>{const original=G.monsters.targetron;try{
    globalThis.__e2eWarriorTargetronOriginal=original;
    if(!original)throw Error('Native Targetron catalog missing');
    // Declared parked encounter; retain native hitboxes, targeting and damage.
    G.monsters.targetron={...original,speed:0,charge:0,hp:10000000};
    const m=new_monster('uhills',{type:'targetron',count:1,position:[${geometry.goal.x},${geometry.goal.y}],radius:0},{temp:1});
    m.speed=0;m.charge=0;m.hp=m.max_hp=10000000;
    target_player(m,get_player('${P}'));return {id:String(m.id),map:m.map,x:m.x,y:m.y,target:m.target};
  }catch(error){G.monsters.targetron=original;delete globalThis.__e2eWarriorTargetronOriginal;throw error;}})()`);
  const samples:any[]=[];
  // Observe actual native positions independently of sparse status packets and
  // Node polling latency. Never infer arrival from a requested destination.
  await live.clients[W].frame.evaluate(()=>{
    const game=window as any;
    const capture={samples:[] as any[],overflow:false,frame:0};
    game.__e2eTargetronPositions=capture;
    const sample=()=>{
      const c=game.character,last=capture.samples.at(-1);
      if(c&&(!last||last.map!==c.map||Math.hypot(c.real_x-last.x,c.real_y-last.y)>=1)){
        if(capture.samples.length>=12000)capture.overflow=true;
        else capture.samples.push({at:Date.now(),map:c.map,x:c.real_x,y:c.real_y});
      }
      capture.frame=requestAnimationFrame(sample);
    };sample();
  });
  try{
    await expect.poll(async()=>(await live.clients[P].events()).some((event:any)=>event.event==='hit'&&
      String(event.data?.hid)===seed.id&&event.data?.id===P&&event.data?.damage>0),
      {timeout:30000,message:'Native Targetron must engage the priest before the warrior follows'}).toBe(true);
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>{
      samples.push(await live.clients[W].run(`(()=>{const t=parent.entities[${JSON.stringify(seed.id)}];return {
        at:Date.now(),x:character.real_x,y:character.real_y,target:character.target,
        approachStatus:globalThis.partyQueueClient?.formation?.approachStatus?.(),enemies:Object.values(parent.entities).filter(e=>e.type==='monster'&&e.visible).map(e=>({id:e.id,x:e.x,y:e.y,target:e.target,mtype:e.mtype})),distance:t?distance(character,t):null,positioning:globalThis.partyCombatPosition||null,
        segmentClear:(()=>{const d=globalThis.partyCombatPosition?.destination;return d?
          can_move({map:character.map,x:character.real_x,y:character.real_y,going_x:d.x,going_y:d.y,base:character.base}):null;})()};})()`));
      return (await live.clients[W].events()).some((event:any)=>nativeHit(event,W,seed.id));
    },{timeout:60000,intervals:[100,250],message:'The warrior must recover around native UHills terrain and damage Targetron'}).toBe(true);
    const nativeMoves=await live.clients[W].events();
    const firstOwnedDamage=nativeMoves.find(event=>nativeHit(event,W,seed.id));
    expect(firstOwnedDamage,'Owned route evidence must precede actual native damage').toBeTruthy();
    const combatMoves=nativeMoves.filter(event=>{const p=event.motion?.position,r=event.motion?.independentRoute,d=event.data;
      return event.event==='move-issued'&&event.at<=firstOwnedDamage!.at&&p?.target===seed.id&&
        (p.movementOwner==='combat'||approachOwned(p)&&r?.id===p.approachId&&r.target===seed.id)&&
        Number.isFinite(d?.x)&&Number.isFinite(d?.y)&&Number.isFinite(d?.going_x)&&Number.isFinite(d?.going_y)&&Math.hypot(d.going_x-d.x,d.going_y-d.y)>1;
    });
    await info.attach('native-owned-combat-route',{body:JSON.stringify({target:seed.id,firstDamage:firstOwnedDamage,combatMoves}),contentType:'application/json'});
    expect(combatMoves.length,'Actual native packets must show matching owned combat movement').toBeGreaterThan(0);
    expect(combatMoves.every(event=>event.motion?.clear===true),'Every observed native combat segment must clear terrain').toBe(true);
    const dx=seed.x-geometry.origin.x,dy=seed.y-geometry.origin.y,length=Math.hypot(dx,dy);
    const nativeEvents=await live.clients[W].events(),firstDamage=nativeEvents.find(event=>nativeHit(event,W,seed.id));
    expect(firstDamage,'The native bend window must end at the actual first attack damage receipt').toBeTruthy();
    const capture=await live.clients[W].frame.evaluate(()=>(window as any).__e2eTargetronPositions);
    expect(capture.overflow,'Native position capture must remain complete').toBe(false);
    const nativePath=capture.samples.filter((p:any)=>p.map===geometry.map&&p.at<=firstDamage!.at&&Number.isFinite(p.x)&&Number.isFinite(p.y));
    expect(nativePath.some((p:any)=>Math.abs(dx*(p.y-geometry.origin.y)-dy*(p.x-geometry.origin.x))/length>20),
      'Actual native movement must bend around the originally blocked direct bearing').toBe(true);
    expect(await live.clients[W].run('character.rip')).toBeFalsy();
  }finally{
    const capture=await live.clients[W].frame.evaluate(()=>{
      const game=window as any,capture=game.__e2eTargetronPositions;
      if(capture)cancelAnimationFrame(capture.frame);
      delete game.__e2eTargetronPositions;return capture;
    });
    await info.attach('targetron-native-position-trace',{body:JSON.stringify(capture),contentType:'application/json'});
    await live.clients[W].run('parent.__e2eObserveMoves=false');
    try{
      await evidence(live,info,'targetron-native-terrain-combat-recovery',{geometry,seed,samples,
        hits:(await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&String(event.data?.id)===seed.id&&event.data?.hid===W)});
      await info.attach('targetron-native-terrain-view',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
    }finally{
      await live.admin(`output=(()=>{const m=instances.uhills.monsters[${JSON.stringify(seed.id)}];
        if(m)remove_monster(m,{silent:true});
        if(globalThis.__e2eWarriorTargetronOriginal)G.monsters.targetron=globalThis.__e2eWarriorTargetronOriginal;
        delete globalThis.__e2eWarriorTargetronOriginal;return true;})()`);
    }
  }
});

test.describe('selected UHills handoff',()=>{
  test.use({loadout:'combat-range',initialPosition:{map:'uhills',x:-536.23,y:-431.28}});
  test('selected UHills robot engages while the healer rounds its approach',async({live},info)=>{
    test.setTimeout(180000);
    await live.post('/merchant/force-stand',{enabled:true});
    await clearMap(live,'uhills');
    await live.admin(`output=(()=>{const p=get_player('${P}');p.slots.mainhand={name:'firestaff',level:8};p.slots.offhand=null;p.slots.shoes={name:'shoes',level:0};cache_player_items(p);calculate_player_stats(p);resend(p,'reopen+cid');return {range:p.range,speed:p.speed};})()`);
    const geometry=await live.clients[W].run(`(()=>{const closest=(x,y)=>{const points=[];for(let dx=-96;dx<=96;dx+=8)for(let dy=-96;dy<=96;dy+=8){const p={x:x+dx,y:y+dy};if(can_move({map:character.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:character.base}))points.push(p);}return points.sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];};return {priest:closest(-331,-484),target:closest(-648,-209),alternate:closest(-816,-320)};})()`);
    await info.attach('selected-uhills-native-geometry',{body:JSON.stringify(geometry),contentType:'application/json'});
    await live.clients[P].run(`smart_move({map:'uhills',x:${geometry.priest.x},y:${geometry.priest.y}})`);
    await expect.poll(()=>live.clients[P].run(`Math.hypot(character.real_x-(${geometry.priest.x}),character.real_y-(${geometry.priest.y}))`),{timeout:60000}).toBeLessThan(10);
    await live.post('/formation',{leader:W});
    await live.post('/formation',{character:P,follow:true});
    await live.post('/focus',{monsterFocus:['targetron','sparkbot'],monsterPriorities:{targetron:999,sparkbot:500},monsterSearchRadius:800});
    await live.post('/farming-mode',{character:W,mode:'default'});
    await live.post('/checkpoint',{});
    const seed=await live.admin(`output=(()=>{globalThis.__selectedRobotOriginal={targetron:G.monsters.targetron,sparkbot:G.monsters.sparkbot};for(const type of ['targetron','sparkbot'])G.monsters[type]={...G.monsters[type],speed:0,charge:0,hp:10000000};const primary=new_monster('uhills',{type:'targetron',count:1,position:[${geometry.target.x},${geometry.target.y}],radius:0},{temp:1});const alternate=new_monster('uhills',{type:'sparkbot',count:1,position:[${geometry.alternate.x},${geometry.alternate.y}],radius:0},{temp:1});for(const m of [primary,alternate]){m.speed=0;m.charge=0;m.hp=m.max_hp=10000000;}return {primary:String(primary.id),alternate:String(alternate.id)};})()`);
    const samples:any[]=[];
    try{
      await expect.poll(async()=>{
        for(const name of [W,P])samples.push(await live.clients[name].run('({name:character.name,at:Date.now(),x:character.real_x,y:character.real_y,positioning:globalThis.partyCombatPosition,group:globalThis.sharedRoutine.targeting.queue()})'));
        return (await live.clients[W].events()).some((e:any)=>nativeHit(e,W,seed.primary));
      },{timeout:35000,intervals:[100,250],message:'The selected robot must receive a native warrior attack without exhausted recovery'}).toBe(true);
      expect((await live.clients[W].events()).some((e:any)=>e.event==='hit'&&String(e.data?.id)===seed.alternate&&e.data?.hid===W)).toBe(false);
    }finally{
      await evidence(live,info,'selected-uhills-native-handoff',{seed,samples});
      await info.attach('selected-uhills-view',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
      await live.admin(`output=(()=>{for(const id of ${JSON.stringify([seed.primary,seed.alternate])}){const m=instances.uhills.monsters[id];if(m)remove_monster(m,{silent:true});}Object.assign(G.monsters,globalThis.__selectedRobotOriginal);delete globalThis.__selectedRobotOriginal;return true;})()`);
    }
  });
});
