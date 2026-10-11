import {test,expect} from './live-fixtures';
import {W,P,evidence} from './hunt-interruption-helpers';

test.use({loadout:'combat-range',initialPosition:{map:'main',x:1260,y:-70}});

test('healthy warrior reaches an engaged Phoenix through its open side',async({live},info)=>{
  test.setTimeout(180000);
  // Failure inventory precedes implementation in testing-engaged-terrain-detour.md.
  expect(await live.clients[W].run('character.range'),'The blocked fighter must have native melee range').toBeLessThan(100);
  try {
  const ambient=await live.admin(`output=(()=>{
    const matches=m=>m&&(m.map==='main'||m.in==='main');
    globalThis.__e2eEngagedPhoenixRespawns=monster_respawns.filter(entry=>matches(entry[0]));
    for(let i=monster_respawns.length-1;i>=0;i--)if(matches(monster_respawns[i][0]))monster_respawns.splice(i,1);
    const removed=Object.values(instances.main.monsters).map(m=>({id:String(m.id),type:m.type,x:m.x,y:m.y}));
    for(const m of Object.values(instances.main.monsters))remove_monster(m,{method:'disappear',nospawn:true});
    return {removed,heldRespawns:globalThis.__e2eEngagedPhoenixRespawns.length};})()`);
  const ambientIds=ambient.removed.map((monster:any)=>monster.id);
  for(const name of [W,P])await expect.poll(()=>live.clients[name].run(`(()=>{
    const ids=${JSON.stringify(ambientIds)};return ids.filter(id=>{const e=parent.entities[id];return e&&e.visible&&!e.dead&&e.hp!==0;}).length;
  })()`),{timeout:15000,message:'Native clients must retire removed ambient encounters before selecting the seeded fight'}).toBe(0);
  await live.post('/merchant/force-stand',{enabled:true});
  await live.clients[W].run('smart_move({map:"main",x:1260,y:-70})');
  await expect.poll(()=>live.clients[W].run('Math.hypot(character.real_x-1260,character.real_y+70)'),{timeout:60000}).toBeLessThan(8);
  await live.clients[P].run('smart_move({map:"main",x:1272,y:80})');
  await expect.poll(()=>live.clients[P].run('Math.hypot(character.real_x-1272,character.real_y-80)'),{timeout:60000}).toBeLessThan(8);
  const geometry=await live.clients[W].run('({blocked:!can_move_to(1272,40),origin:{x:character.real_x,y:character.real_y},base:character.base})');
  expect(geometry.blocked,'The reported Phoenix bearing point must be blocked by native Main terrain').toBe(true);
  // The blocked warrior owns the formation from the outset; a new follower
  // reunion route must not be able to mask missing combat recovery.
  await live.post('/formation',{leader:W});
  await live.post('/focus',{monsterFocus:['phoenix'],monsterPriorities:{phoenix:999},monsterSearchRadius:400});
  await live.post('/farming-mode',{character:W,mode:'default'});
  await live.post('/checkpoint',{});
  const monster=await live.admin(`output=(()=>{const original=G.monsters.phoenix;globalThis.__e2eEngagedPhoenixOriginal=original;try{
    // Declared parked-tank fixture: preserve native collision, attacks and targeting.
    G.monsters.phoenix={...original,speed:0,charge:0,hp:10000000};
    const m=new_monster('main',{type:'phoenix',count:1,position:[1272,80],radius:0},{temp:1});
    m.speed=0;m.charge=0;m.hp=m.max_hp=10000000;
    target_player(m,get_player('${P}'));return {id:String(m.id),x:m.x,y:m.y,target:m.target};
  }catch(error){G.monsters.phoenix=original;delete globalThis.__e2eEngagedPhoenixOriginal;throw error;}})()`);
  const samples:any[]=[];let nextMonster:any;
  try {
    await expect.poll(async()=>(await live.clients[P].events()).some((event:any)=>event.event==='hit'&&
      String(event.data?.hid)===monster.id&&event.data?.id===P&&event.data?.damage>0),
      {timeout:30000,message:'The tank must actually be engaged before enabling the blocked warrior'}).toBe(true);
    await live.post('/formation',{character:P,follow:true});
    await expect.poll(async()=>{
      const state=await live.state();
      const compact=(player:any)=>player&&({map:player.map,x:player.x,y:player.y,range:player.range,
        hp:player.hp,rip:player.rip,target:player.target});
      const native=await live.clients[W].run(`(()=>{const p=globalThis.partyCombatPosition,d=p?.destination;
        return {x:character.real_x,y:character.real_y,segmentClear:d?can_move({map:character.map,x:character.real_x,y:character.real_y,
          going_x:d.x,going_y:d.y,base:character.base}):null,positioning:p&&{at:p.at,target:p.target,mode:p.mode,reason:p.reason,
          constraint:p.constraint,movementOwner:p.movementOwner,distance:p.distance,desiredRange:p.desiredRange,destination:d}};})()`);
      samples.push({at:Date.now(),fighter:compact(state.characters[W]),priest:compact(state.characters[P]),...native});
      return (await live.clients[W].events()).some((event:any)=>event.event==='hit'&&String(event.data?.id)===monster.id&&
        event.data?.hid===W&&event.data?.damage>1&&event.data?.source!=='taunt');
    },{timeout:60000,intervals:[100,250],message:'Native warrior attack must land after a terrain detour to the engaged monster'}).toBe(true);
    const combatMoves=samples.filter(sample=>sample.positioning?.movementOwner==='combat'&&sample.positioning?.target===monster.id&&sample.positioning?.destination);
    expect(combatMoves.length,'The warrior must move under combat ownership toward the actual engaged monster').toBeGreaterThan(0);
    expect(combatMoves.every(sample=>sample.segmentClear),'Every observed combat segment must clear native terrain').toBe(true);
    const dx=monster.x-geometry.origin.x,dy=monster.y-geometry.origin.y,length=Math.hypot(dx,dy);
    expect(combatMoves.some(sample=>Math.abs(dx*(sample.y-geometry.origin.y)-dy*(sample.x-geometry.origin.x))/length>20),
      'Combat movement must bend around the originally blocked direct bearing').toBe(true);
    expect(await live.clients[W].run('character.rip')).toBeFalsy();
    nextMonster=await live.admin(`output=(()=>{
      const prior=instances.main.monsters[${JSON.stringify(monster.id)}];if(prior)remove_monster(prior,{method:'disappear',nospawn:true});
      const p=get_player('${W}');
        for(let i=0;i<16;i++){const x=p.x+80*Math.cos(i*Math.PI/8),y=p.y+80*Math.sin(i*Math.PI/8);
          if(!can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))continue;
          const m=new_monster(p.in,{type:'phoenix',count:1,position:[x,y],radius:0},{temp:1});
          m.speed=0;m.charge=0;m.hp=m.max_hp=10000000;
          target_player(m,get_player('${P}'));return {id:String(m.id),x:m.x,y:m.y};}
        throw Error('No clear native second-target seed');
      })()`);
    expect(nextMonster.id).not.toBe(monster.id);
    await expect.poll(async()=>(await live.clients[W].events()).some((event:any)=>event.event==='hit'&&
      String(event.data?.id)===nextMonster.id&&event.data?.hid===W&&event.data?.damage>1&&event.data?.source!=='taunt'),
      {timeout:45000,message:'A new native target must be approached and attacked after the old detour ends'}).toBe(true);
  }finally{
    try {
      const targetIds=[monster.id,nextMonster?.id].filter(Boolean);
      const hits=(await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&
        targetIds.includes(String(event.data?.id))&&event.data?.hid===W&&event.data?.damage>1&&event.data?.source!=='taunt');
      await evidence(live,info,'engaged-phoenix-open-side-detour',{monster,nextMonster,ambient,geometry,samples,hits});
      await info.attach('native-engaged-terrain-view',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
    }finally{
      await live.admin(`output=(()=>{for(const id of ${JSON.stringify([monster.id,nextMonster?.id].filter(Boolean))}){
        const m=instances.main.monsters[id];if(m)remove_monster(m,{method:'disappear',nospawn:true});}
        if(globalThis.__e2eEngagedPhoenixOriginal)G.monsters.phoenix=globalThis.__e2eEngagedPhoenixOriginal;
        delete globalThis.__e2eEngagedPhoenixOriginal;return true;})()`);
    }
  }
  }finally{
    await live.admin(`output=(()=>{monster_respawns.push(...(globalThis.__e2eEngagedPhoenixRespawns||[]));
      delete globalThis.__e2eEngagedPhoenixRespawns;return true;})()`);
  }
});
