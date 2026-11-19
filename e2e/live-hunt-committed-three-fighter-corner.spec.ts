import {test,expect} from './live-fixtures';
import {W,P} from './hunt-interruption-helpers';
const M='E2EBankBoi',fighters=[W,P,M];
const starts={
  [W]:{map:'uhills',x:-551,y:-80},[P]:{map:'uhills',x:-830,y:-310},
  [M]:{map:'uhills',x:-830,y:-300},E2EMerchant:{map:'main',x:-63,y:100},
};
test.use({loadout:'combat-range',extraFighter:'mage',initialPositions:starts});

test('committed three-fighter corner preserves red combat while Mage and Priest recover',async({live},info)=>{
  test.setTimeout(240000);
  // Inventory: docs/testing-committed-three-fighter-corner.md. No live teleports.
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/focus',{monsterFocus:[]});
  for(const name of fighters)await live.clients[name].frame.evaluate(()=>{
    const p=window as any;p.__e2eObserveMoves=true;p.__e2eObservedMoveCount=0;
  });
  const isolated=await live.admin(`output=(()=>{
    globalThis.__e2eCornerRespawns=[];
    for(let i=monster_respawns.length-1;i>=0;i--)if(monster_respawns[i][0]?.map==='uhills')
      __e2eCornerRespawns.push(monster_respawns.splice(i,1)[0]);
    const removed=[];for(const m of Object.values(instances.uhills.monsters)){
      removed.push(String(m.id));remove_monster(m,{method:'disappear',nospawn:true});
    }return {removed,heldRespawns:__e2eCornerRespawns.length};})()`);
  const samples:any[]=[],events:Record<string,any[]>={};
  let seed:any;
  try{
    await expect.poll(async()=>Promise.all(fighters.map(name=>live.clients[name].run(
      `${JSON.stringify(isolated.removed)}.filter(id=>parent.entities[id]&&!parent.entities[id].dead).length`))),
      {timeout:15000,message:'Native disappearance must isolate the declared corner encounter'}).toEqual([0,0,0]);
    const geometry=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>({
      name:character.name,map:character.map,in:character.in,ctype:character.ctype,base:character.base,
      x:character.real_x,y:character.real_y,hp:character.hp,rip:character.rip,
      ownClear:can_move_to(character.real_x,character.real_y),targetClear:can_move_to(-575,-80)}))()`)));
    await info.attach('native-three-fighter-corner-staging',{body:JSON.stringify({starts,geometry,isolated}),contentType:'application/json'});
    expect(geometry.map(v=>v.ctype)).toEqual(['warrior','priest','mage']);
    expect(geometry.every(v=>v.map==='uhills'&&v.in==='uhills'&&v.hp>0&&!v.rip&&v.ownClear)).toBe(true);
    expect(geometry.map(v=>v.targetClear)).toEqual([true,false,false]);
    seed=await live.admin(`output=(()=>{
      const original=G.monsters.targetron;globalThis.__e2eCornerOriginal=original;
      G.monsters.targetron={...original,stationary:true};
      const m=new_monster('uhills',{type:'targetron',count:1,position:[-575,-80],radius:0},{temp:1});
      m.speed=0;m.moving=false;m.hp=m.max_hp=10000000;m.target=${JSON.stringify(W)};m.u=true;m.abs=true;m.cid++;
      return {id:String(m.id),map:m.map,x:m.x,y:m.y,wire:monster_to_client(m),at:Date.now()};})()`);
    await live.post('/formation',{leader:W});
    for(const name of [P,M])await live.post('/formation',{character:name,follow:true});
    await live.post('/focus',{monsterFocus:['targetron'],monsterPriorities:{targetron:999},monsterSearchRadius:600});
    await live.post('/farming-mode',{character:W,mode:'default'});
    await expect.poll(async()=>{const views=await Promise.all(fighters.map(name=>live.clients[name].run(
      '({grouped:!!partyHunting.farm.grouped(),members:partyTasks.partyList()})')));
      return views.every(v=>v.grouped&&fighters.every(name=>v.members.includes(name)));},
      {timeout:30000,message:'All three actual fighter runtimes must adopt the committed formation'}).toBe(true);
    const hit=(list:any[],name:string,since=0)=>list.find(e=>e.event==='hit'&&e.at>=since&&e.at<=Date.now()&&String(e.data?.id)===seed.id&&
      e.data?.hid===name&&e.data?.source!=='taunt'&&e.data?.damage>1);
    await expect.poll(async()=>{
      events[W]=await live.clients[W].events();return !!hit(events[W],W);
    },{timeout:30000,message:'Native Warrior damage must establish the real red fight'}).toBe(true);
    const committedAt=hit(events[W],W).at;
    await expect.poll(async()=>{const state=await live.state();return fighters.every(name=>
      state.characters[name]?.groupedCombat?.state?.queue?.some((target:any)=>String(target.id)===seed.id&&target.state==='engaged'));},
      {timeout:15000,message:'The real native fight must be committed to all three fighter controls'}).toBe(true);
    await expect.poll(async()=>{
      const native=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{
        const t=parent.entities[${JSON.stringify(seed.id)}],r=partyStatus.character.combatTraceSnapshot();
        return {at:Date.now(),name:character.name,map:character.map,in:character.in,x:character.real_x,y:character.real_y,
          hp:character.hp,rip:character.rip,connected:parent.socket?.connected,generation:__partyRuntimeGeneration,
          target:r.target,ownedTarget:sharedRoutine.targeting.sharedTargetId(),epoch:r.epoch,position:globalThis.partyCombatPosition,
          localApproach:globalThis.partyQueueClient?.formation?.approachStatus?.(),
          enemy:t&&{id:t.id,hp:t.hp,dead:t.dead,x:t.real_x,y:t.real_y}};
      })()`)));
      if(samples.length<120)samples.push(native);
      for(const name of fighters)events[name]=await live.clients[name].events();
      expect(native.every(v=>v.map==='uhills'&&v.in==='uhills'&&v.hp>0&&!v.rip&&v.connected&&v.ownedTarget===seed.id&&v.enemy?.hp>0&&!v.enemy.dead),
        'The same native encounter must remain alive while all three recover').toBe(true);
      const advanced=(name:string)=>events[name].some(e=>e.event==='player'&&e.data?.id===name&&e.data.map==='uhills'&&
        Number.isFinite(e.data.x)&&Number.isFinite(e.data.y)&&Math.hypot(e.data.x-starts[name as keyof typeof starts].x,e.data.y-starts[name as keyof typeof starts].y)>12);
      return [P,M].every(name=>advanced(name)&&!!hit(events[name],name,committedAt));
    },{timeout:60000,message:'Mage and Priest must make native physical progress and damage the same committed target'}).toBe(true);
    for(const name of fighters){
      const moves=events[name].filter(e=>e.event==='move-issued'&&e.motion?.position?.target===seed.id);
      if(name!==W)expect(moves.length,'Actual caster movement packets must be retained').toBeGreaterThan(0);
      expect(moves.every(e=>e.motion.clear===true),'Every issued combat segment must be native-clear').toBe(true);
      expect(events[name].some(e=>e.event==='new_map'&&e.data?.name==='jail')).toBe(false);
    }
    for(const name of fighters){const generations=new Set(samples.flat().filter(v=>v.name===name).map(v=>v.generation));
      expect(generations.size,'Each native actor must retain the same CODE generation').toBe(1);}
    const epochs=new Set(samples.flat().filter(v=>v.target===seed.id).map(v=>v.epoch));
    expect(epochs.size,'The owned red fight must retain one combat epoch').toBe(1);
    await info.attach('native-three-fighter-corner-result',{body:JSON.stringify({seed,committedAt,samples,
      hits:Object.fromEntries(fighters.map(name=>[name,hit(events[name],name,committedAt)])),
      moves:Object.fromEntries(fighters.map(name=>[name,events[name].filter(e=>e.event==='move-issued')]))}),contentType:'application/json'});
  }finally{
    await info.attach('native-three-fighter-corner-observations',{body:JSON.stringify({seed,samples,events}),contentType:'application/json'});
    await Promise.allSettled(fighters.map(name=>live.clients[name].frame.evaluate(()=>{(window as any).__e2eObserveMoves=false;})));
    await live.admin(`output=(()=>{
      const m=instances.uhills.monsters[${JSON.stringify(seed?.id||'')}];if(m)remove_monster(m,{method:'disappear',nospawn:true});
      if(globalThis.__e2eCornerOriginal){G.monsters.targetron=__e2eCornerOriginal;delete globalThis.__e2eCornerOriginal;}
      monster_respawns.push(...(globalThis.__e2eCornerRespawns||[]));delete globalThis.__e2eCornerRespawns;return true;})()`);
  }
});
