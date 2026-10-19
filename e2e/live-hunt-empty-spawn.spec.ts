import {test,expect} from './live-fixtures';
import {isolateNativeMapAmbient,restoreNativeMapAmbient} from './native-map-ambient-isolation';
import {W,P} from './hunt-interruption-helpers';
const M='E2EBankBoi',fighters=[W,P,M];
// Declared post-kite positions from the failed native hawk journey. No live
// movement, visibility, queue, readiness or damage results are replaced.
test.use({loadout:'combat-follow-range',extraFighter:'mage',initialPositions:{
 [W]:{map:'main',x:1127,y:-352},[P]:{map:'main',x:1364,y:-342},
 [M]:{map:'main',x:1383,y:-304},E2EMerchant:{map:'main',x:-63,y:100},
}});
test('empty saved hawk spawn recovers separated fighters and acquires on sight before the spawn center',async({live},info)=>{
 test.setTimeout(240000);
 const farm={map:'main',x:1280,y:300,boundary:[1100,200,1450,340]},samples:any[]=[];
 let seed:any,events:Record<string,any[]>={};
 try {
  await isolateNativeMapAmbient(live,'main');
  await live.post('/formation',{leader:W});
  for(const name of [P,M])await live.post('/formation',{character:name,follow:true});
  await live.post('/focus',{monsterFocus:['bigbird'],monsterSearchRadius:600});
  await live.post('/farming-mode',{character:W,mode:'default'});
  live.consoleDrainLease('empty-spawn-setup');
  await expect.poll(async()=>{const s=await live.state();return fighters.every(n=>s.characters[n]?.consoleMaintenance?.ready);}).toBe(true);
  // A saved user waypoint is input. Starting an artificial recovery convoy or
  // calling /farming-return here would bypass the behavior being tested.
  await live.restoreHistoricalSettings(settings=>({farmingProfiles:{...settings.farmingProfiles,
   [W]:{...settings.farmingProfiles[W],location:farm}},location:farm}));
  for(const n of fighters)await live.clients[n].frame.evaluate(()=>{const p=window as any;p.__e2eObserveMoves=true;p.__e2eObservedMoveCount=0;p.__e2eIndependentObservedAttackCount=0;p.__e2eIndependentObservedTargets={};});
  await expect.poll(async()=>Promise.all(fighters.map(n=>live.clients[n].run("Object.values(parent.entities||{}).some(e=>e&&e.type==='monster'&&e.mtype==='bigbird'&&e.visible&&!e.dead&&e.hp>0)")))).toEqual([false,false,false]);
  const releasedAt=Date.now();live.consoleDrainLease(null);
  await expect.poll(async()=>{
   const s=await live.state(),c=s.activeConvoy;
   samples.push({at:Date.now(),phase:c?.phase,purpose:c?.purpose,position:s.characters[W]&&{x:s.characters[W].x,y:s.characters[W].y},target:s.farmingProfiles[W]?.groupedCombat?.target});
   return c?.purpose==='empty-spawn-recovery';
  },{timeout:15000,message:'Separated, targetless fighters must automatically start returning to their saved spawn'}).toBe(true);
  // Keep the recovery decision genuinely targetless. Native visibility can
  // publish a pre-seeded monster before the 1.5s empty-spawn decision on CI.
  seed=await live.admin(`output=(()=>{const point={map:'main',x:1140,y:240};if(!can_move({...point,going_x:point.x,going_y:point.y}))throw Error('Invalid native declaration');const m=new_monster('main',{__e2eAmbientExempt:true,type:'bigbird',position:[point.x,point.y],radius:0,count:1},{temp:1});m.zone_stats={...G.monsters.bigbird,speed:0,charge:0,aggro:0,rage:0,hp:100000};calculate_monster_stats(m);m.hp=m.max_hp=100000;m.u=true;return {id:String(m.id),...point};})()`);

  await expect.poll(async()=>{
   const s=await live.state();samples.push({at:Date.now(),convoy:s.activeConvoy,group:s.farmingProfiles[W]?.groupedCombat});
   events=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n].events()])));
   return fighters.every(n=>events[n].some(e=>e.at>=releasedAt&&e.event==='hit'&&e.data?.hid===n&&String(e.data?.id)===seed.id&&e.data.damage>1));
  },{timeout:90000,message:'Visible farm monster must interrupt the return and receive real party attacks'}).toBe(true);
  const attacks=fighters.flatMap(n=>events[n]).filter(e=>e.event==='attack-issued'&&String(e.data?.id)===seed.id).sort((a,b)=>a.at-b.at);
  expect(attacks.length).toBeGreaterThan(0);
  const first=attacks[0],proof=first.motion?.independent;
  expect(proof?.committed).toBe(true);expect(proof?.target).toBe(seed.id);
  expect(proof.serverAt).toBeLessThan(proof.confirmation.expiresAt);
  for(const n of fighters){expect(proof.ready[n].ready).toBe(true);expect(proof.ready[n].confirmation).toBe(proof.confirmation.id);expect(proof.ready[n].target).toBe(seed.id);expect(proof.ready[n].selection).toBe(proof.selection);expect(proof.serverAt-proof.ready[n].at).toBeLessThanOrEqual(1000);}
  for(const n of fighters)expect(events[n].some(e=>e.event==='hit'&&e.data?.hid===n&&String(e.data?.id)===seed.id&&e.data.damage>1)).toBe(true);
  const state=await live.state(),handoff=state.combatLogs[W].find((e:any)=>e.at>=releasedAt&&e.message==='Farming route paused to engage a nearby configured monster');
  expect(handoff).toBeTruthy();
  const moves=events[W].filter(e=>e.event==='move-issued'&&e.at>=releasedAt&&e.at<=handoff.at);
  expect(moves.length).toBeGreaterThan(0);
  expect(moves.every(e=>Math.hypot(e.data.x-farm.x,e.data.y-farm.y)>100),'Return must hand off before reaching the spawn center').toBe(true);
  await info.attach('native-empty-spawn-reacquisition',{body:JSON.stringify({farm,seed,releasedAt,handoff,first,events,samples}),contentType:'application/json'});
 } finally {
  live.consoleDrainLease(null);
  await info.attach('native-empty-spawn-observations',{body:JSON.stringify({farm,seed,samples,events}),contentType:'application/json'});
  if(seed)await live.admin(`const m=instances.main.monsters[${JSON.stringify(seed.id)}];if(m)remove_monster(m);output=true`);
  await restoreNativeMapAmbient(live);
 }
});

