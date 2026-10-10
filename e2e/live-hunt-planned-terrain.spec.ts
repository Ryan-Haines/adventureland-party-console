import {test,expect} from './live-fixtures';
import {W,P,evidence} from './hunt-interruption-helpers';

test.use({loadout:'combat-range',initialPosition:{map:'main',x:349,y:1532}});

test('blocked melee Phoenix recovery computes native hitbox-clear goals and reaches combat',async({live},info)=>{
  test.setTimeout(180000);
  // Failure inventory precedes implementation in testing-combat-recovery-goals.md.
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await live.post('/focus',{monsterFocus:['phoenix'],monsterPriorities:{phoenix:999},monsterSearchRadius:600});
  await live.post('/farming-mode',{character:W,mode:'default'});
  await live.post('/checkpoint',{});
  const seed=await live.admin(`output=(()=>{const original=G.monsters.phoenix;try{
    globalThis.__e2ePlannedPhoenixOriginal=original;
    // Declared stationary encounter fixture; collision, targeting and damage remain native.
    G.monsters.phoenix={...original,speed:0,charge:0,hp:10000000};
    const m=new_monster('main',{type:'phoenix',count:1,position:[738,1702],radius:0},{temp:1});
    m.speed=0;m.charge=0;m.hp=m.max_hp=10000000;
    return {id:String(m.id),map:m.map,x:m.x,y:m.y};
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
    geometry=await live.clients[W].run(`(()=>{const t=parent.entities[${JSON.stringify(seed.id)}];
      return {blocked:!can_move_to(${seed.x},${seed.y}),range:character.range,targetVisible:!!t,
        origin:{x:character.real_x,y:character.real_y}};})()`);
    expect(geometry.blocked,'The original reported Phoenix approach crosses native Main terrain').toBe(true);
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
      await context.unroute('**/party-api/status',intercept);
      await info.attach('planned-phoenix-recovery-proposals',{body:JSON.stringify({seed,geometry,proposals,positions}),contentType:'application/json'});
    }finally{
      await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(seed.id)}];
        if(m)remove_monster(m,{silent:true});
        if(globalThis.__e2ePlannedPhoenixOriginal)G.monsters.phoenix=globalThis.__e2ePlannedPhoenixOriginal;
        delete globalThis.__e2ePlannedPhoenixOriginal;return true;})()`);
    }
  }
});
