import {test,expect} from './live-fixtures';
import {W,P,evidence} from './hunt-interruption-helpers';

test.use({loadout:'combat-range',initialPosition:{map:'uhills',x:-573,y:-80}});

test('warrior recovers a blocked Targetron approach in the reported UHills layout',async({live},info)=>{
  test.setTimeout(180000);
  // Failure inventory: docs/testing-targetron-terrain-recovery.md.
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
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
  try{
    await expect.poll(async()=>(await live.clients[P].events()).some((event:any)=>event.event==='hit'&&
      String(event.data?.hid)===seed.id&&event.data?.id===P&&event.data?.damage>0),
      {timeout:30000,message:'Native Targetron must engage the priest before the warrior follows'}).toBe(true);
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>{
      samples.push(await live.clients[W].run(`(()=>{const t=parent.entities[${JSON.stringify(seed.id)}];return {
        at:Date.now(),x:character.real_x,y:character.real_y,target:character.target,
        distance:t?distance(character,t):null,positioning:globalThis.partyCombatPosition||null,
        segmentClear:(()=>{const d=globalThis.partyCombatPosition?.destination;return d?
          can_move({map:character.map,x:character.real_x,y:character.real_y,going_x:d.x,going_y:d.y,base:character.base}):null;})()};})()`));
      return (await live.clients[W].events()).some((event:any)=>event.event==='hit'&&String(event.data?.id)===seed.id&&event.data?.hid===W&&event.data?.source!=='taunt'&&event.data?.damage>1);
    },{timeout:60000,intervals:[100,250],message:'The warrior must recover around native UHills terrain and damage Targetron'}).toBe(true);
    const combatMoves=samples.filter(sample=>sample.positioning?.movementOwner==='combat'&&sample.positioning?.target===seed.id&&sample.positioning?.destination);
    expect(combatMoves.length,'Recovery must issue combat-owned movement to the actual Targetron').toBeGreaterThan(0);
    expect(combatMoves.every(sample=>sample.segmentClear),'Every observed combat segment must clear native terrain').toBe(true);
    const dx=seed.x-geometry.origin.x,dy=seed.y-geometry.origin.y,length=Math.hypot(dx,dy);
    expect(combatMoves.some(sample=>Math.abs(dx*(sample.y-geometry.origin.y)-dy*(sample.x-geometry.origin.x))/length>20),
      'Combat movement must bend around the originally blocked direct bearing').toBe(true);
    expect(await live.clients[W].run('character.rip')).toBeFalsy();
  }finally{
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
