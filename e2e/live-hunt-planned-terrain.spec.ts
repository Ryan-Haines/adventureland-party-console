import {test,expect} from './live-fixtures';
import {W,P,evidence} from './hunt-interruption-helpers';
import {isolateNativeMapAmbient,restoreNativeMapAmbient} from './native-map-ambient-isolation';

test.use({loadout:'combat-range',initialPosition:{map:'main',x:349,y:1532}});

test('blocked melee Phoenix recovery computes native hitbox-clear goals and reaches combat',async({live},info)=>{
  test.setTimeout(180000);
  // Failure inventory precedes implementation in testing-combat-recovery-goals.md.
  const ambient=await isolateNativeMapAmbient(live,'main');
  try{
  await info.attach('planned-phoenix-declared-ambient-isolation',{body:JSON.stringify(ambient),contentType:'application/json'});
  await live.clients[W].frame.evaluate(()=>{const p=window as any;p.__e2eObserveMoves=true;p.__e2eObservedMoveCount=0;});
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await live.post('/focus',{monsterFocus:['phoenix'],monsterPriorities:{phoenix:999},monsterSearchRadius:600});
  await live.post('/farming-mode',{character:W,mode:'default'});
  await live.post('/checkpoint',{});
  // The configured formation must reach both actual CODE runtimes before a
  // newly visible encounter can initiate a solo approach.
  const formation:any[]=[];
  await expect.poll(async()=>{
    const current=await Promise.all([W,P].map(name=>live.clients[name].run(`(()=>{
      const peer=get_player(${JSON.stringify(name===W?P:W)}),routine=globalThis.sharedRoutine;
      return {name:character.name,grouped:!!routine?.usesGroupedCombat?.(),members:routine?.queueMembers?.(),
        alive:character.hp>0&&!character.rip,map:character.map,in:character.in,
        peer:peer&&{name:peer.name,map:peer.map,in:peer.in,hp:peer.hp,rip:peer.rip,visible:peer.visible}};
    })()`)));
    formation.splice(0,formation.length,...current);
    return current.every(v=>v.grouped&&v.alive&&[W,P].every(name=>v.members?.includes(name))&&
      v.peer?.hp>0&&!v.peer.rip&&v.peer.visible&&v.peer.map===v.map&&v.peer.in===v.in);
  },{timeout:30000,message:'Both native runtimes must own the configured formation before Phoenix appears'}).toBe(true);
  const originalGeometry=await live.clients[W].run(`(()=>({at:Date.now(),map:character.map,in:character.in,
    blocked:!can_move_to(738,1702),range:character.range,base:character.base,
    origin:{x:character.real_x,y:character.real_y}}))()`);
  expect(originalGeometry.blocked,'The original reported Phoenix approach crosses native Main terrain').toBe(true);
  const seed=await live.admin(`output=(()=>{const original=G.monsters.phoenix;try{
    globalThis.__e2ePlannedPhoenixOriginal=original;
    // Declared stationary encounter fixture; collision, targeting and damage remain native.
    // Preserve speed/HP catalog defaults: native transport omits values equal
    // to this catalog, but already-running clients still have the old defaults.
    G.monsters.phoenix={...original,stationary:true};
    const m=new_monster('main',{type:'phoenix',count:1,position:[738,1702],radius:0,__e2eAmbientExempt:true},{temp:1});
    m.speed=0;m.moving=false;m.hp=m.max_hp=10000000;m.abs=true;m.u=true;m.cid++;
    return {id:String(m.id),map:m.map,x:m.x,y:m.y,wire:monster_to_client(m)};
  }catch(error){G.monsters.phoenix=original;delete globalThis.__e2ePlannedPhoenixOriginal;throw error;}})()`);
  let geometry:any;
  const proposals:any[]=[],positions:any[]=[];
  const context=live.clients[W].page.context();
  const intercept=async(route:import('@playwright/test').Route)=>{
    const body=route.request().postDataJSON(),proposal=body?.groupedCombat?.formationRecovery;
    if(body?.name===W&&proposal?.goals?.length)proposals.push({at:Date.now(),proposal});
    await route.continue();
  };
  try{
    await context.route('**/party-api/status',intercept);
    expect(seed.wire.hp).toBe(10000000);expect(seed.wire.max_hp).toBe(10000000);expect(seed.wire.speed).toBe(0);
    await expect.poll(async()=>{
      geometry=await live.clients[W].run(`(()=>{const t=parent.entities[${JSON.stringify(seed.id)}];
        return {blocked:!can_move_to(${seed.x},${seed.y}),range:character.range,targetVisible:!!t,
          nativeTarget:t&&{id:t.id,hp:t.hp,max_hp:t.max_hp,moving:t.moving,x:t.x,y:t.y},
          origin:{x:character.real_x,y:character.real_y}};})()`);
      return geometry.nativeTarget?.max_hp===10000000&&!geometry.nativeTarget.moving&&
        Math.hypot(geometry.nativeTarget.x-seed.x,geometry.nativeTarget.y-seed.y)<1;
    },{timeout:30000,message:'The real client must observe the declared stationary native Phoenix fixture'}).toBe(true);
    geometry={...geometry,currentBlocked:geometry.blocked,original:originalGeometry,formation};
    await expect.poll(async()=>{
      const sample=await live.clients[W].run(`(()=>{const t=parent.entities[${JSON.stringify(seed.id)}],ports=globalThis.sharedRoutine?.terrainRecoveryPorts?.();
        const context=ports?.context(),goals=t&&context?.target?.includes(${JSON.stringify(seed.id)})?ports.goals():[];return {
        at:Date.now(),x:character.real_x,y:character.real_y,target:t&&{x:t.x,y:t.y,hp:t.hp},
        position:globalThis.partyCombatPosition||null,recovery:globalThis.partyQueueClient?.formation?.report()||null,
        context,goals,measured:(()=>{
          if(!t||!goals.length)return null;
          const body=e=>({x:Number(e.real_x!==undefined?e.real_x:e.x),y:Number(e.real_y!==undefined?e.real_y:e.y),
            awidth:Number(e.awidth!==undefined?e.awidth:(e.width||0)/(e.mscale||1))||0,
            aheight:Number(e.aheight!==undefined?e.aheight:(e.height||0)/(e.mscale||1))||0,map:e.map,in:e.in});
          const range=Number(character.range),safety=Math.min(Number(t.range||G.monsters.phoenix.range),Math.max(6,range-24))+8;
          const reach=Math.min(range-1,Math.max(range-Math.min(12,Math.max(2,range*.05)),safety+12));
          return {range,reach,safety,target:body(t),self:body(character),goals:goals.map(p=>({point:p,
            gap:distance({...body(character),x:p.x,y:p.y},body(t)),
            clear:can_move({map:character.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:character.base})}))};
        })()};})()`);
      positions.push(sample);
      // This existing runtime port is also consumed by the actual recovery
      // client. A successful local detour need not request a coordinator pause.
      if(sample.goals?.length)proposals.push({at:sample.at,source:'native-runtime-port',measured:sample.measured,proposal:{target:sample.context.target,goals:sample.goals}});
      return proposals.filter(p=>p.measured).length;
    },{timeout:60000,intervals:[250,500],
      message:'The real warrior must compute nonempty recovery goals for its selected native Phoenix'}).toBeGreaterThan(0);
    const proposal=proposals.find(p=>p.measured&&p.proposal.target.includes(seed.id));
    expect(proposal,'Recovery proposal belongs to the reported native Phoenix').toBeTruthy();
    const measured=proposal.measured;
    expect(measured.goals.length).toBeGreaterThan(0);
    for(const goal of measured.goals){
      expect(goal.clear).toBe(true);
      expect(goal.gap).toBeGreaterThan(measured.safety);
      expect(Math.abs(goal.gap-measured.reach)).toBeLessThan(.01);
      expect(goal.gap).toBeLessThanOrEqual(measured.range);
    }
    await expect.poll(async()=>(await live.clients[W].events()).some((event:any)=>event.event==='hit'&&
      String(event.data?.id)===seed.id&&event.data?.hid===W&&event.data?.source!=='taunt'&&event.data?.damage>1),
      {timeout:60000,message:'The proposed native recovery must lead to actual warrior damage'}).toBe(true);
    await evidence(live,info,'planned-phoenix-native-hitbox-goals',{seed,geometry,proposals,measured});
    await info.attach('planned-phoenix-native-terrain-view',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
  }finally{
    try{
      await live.clients[W].frame.evaluate(()=>{(window as any).__e2eObserveMoves=false;}).catch(()=>{});
      await context.unroute('**/party-api/status',intercept);
      await info.attach('planned-phoenix-recovery-proposals',{body:JSON.stringify({seed,geometry,proposals,positions}),contentType:'application/json'});
    }finally{
      await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(seed.id)}];
        if(m)remove_monster(m,{silent:true});
        if(globalThis.__e2ePlannedPhoenixOriginal)G.monsters.phoenix=globalThis.__e2ePlannedPhoenixOriginal;
        delete globalThis.__e2ePlannedPhoenixOriginal;return true;})()`);
    }
  }
  }finally{
    const restored=await restoreNativeMapAmbient(live);
    await info.attach('planned-phoenix-native-ambient-restored',{body:JSON.stringify(restored),contentType:'application/json'});
  }
});
