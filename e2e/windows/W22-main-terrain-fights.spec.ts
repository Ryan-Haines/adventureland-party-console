import {expect} from '../live-fixtures';
import {liveWindow, type LiveWorld} from '../windows';
import {W, P, evidence, offBearing} from '../hunt-interruption-helpers';
import {location, arrived} from '../game/hunt-lifecycle';
import {waitForGameplay} from '../network-clock';
import {isolateNativeMapAmbient, restoreNativeMapAmbient} from '../native-map-ambient-isolation';

// W22 Main terrain parked monsters, warrior-led with a mage (test-windows DESIGN.md 2.2 W22). One
// play on Main with the warrior, the priest and the extra mage (E2EBankBoi), from H8's start at
// main(1260,-70):
//   H8: Main's ambient monsters go and their respawns are held; the warrior stands at (1260,-70)
//   and the priest at (1272,80) across the wall; a parked Phoenix tanks on the priest; the warrior
//   detours around the wall and hits it; a second parked Phoenix appears 80 from the warrior and
//   the warrior goes to it; the respawns come back.
//   H35: the party travels to main(349,1532); Main's ambient is isolated; a stationary Phoenix
//   stands at (738,1702) across terrain; the warrior plans recovery goals and hits it; the ambient
//   comes back.
//   C18: the party travels to the goo field; two stunned harmless booboos stand 390 off, both on
//   the warrior; for 60 s the mage walks into its range of them.
//   M23 (and M22): the party travels to main(0,0) in scatter mode; one stunned mummy on the
//   warrior gets single hits and no Cleave; a second one beside it and both get Cleave.
// H8 opens the play because its two stands need the fixture's start; H35 and the later steps
// reach theirs by party travel, which sets the farm spot for every member.
// Failure modes: H8, the warrior walks into the wall, a combat segment crosses terrain or it never
// reaches the second target; H35, the warrior plans no hitbox-clear goal or never lands damage;
// C18, the mage holds outside its range while a booboo attacks the warrior; M23 and M22, a single
// attacker draws Cleave or two attackers draw none.
// H35's goal checks against the runtime's own reach and safety formula move to a unit row
// (DESIGN.md 4.3 H35); the window keeps its clear goals and the damage.
// Each check's assertions are its old test's, with their messages, so the coverage ledger matches
// them. A failed step records its message under its check and the play goes on.
// Every old spec this window cites is at 21fe30a2b.
const M = 'E2EBankBoi';
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
const step = async (id: string, run: () => Promise<unknown>) => {
  try { await run(); return true; } catch (error) { failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); return false; }
};
function cleaveLanded(events: any[], ids: string[]): boolean {
  return events.some(e => e.event === 'game_response' && e.data?.place === 'cleave' &&
    e.data.success === true && e.data.attacker === W && ids.every(id => e.data.targets?.includes(id))) &&
    ids.every(id => events.some(e => e.event === 'hit' && e.data?.source === 'cleave' &&
      e.data.hid === W && String(e.data.id) === id && e.data.damage > 0));
}
async function removeOwnedMummies(live: LiveWorld['live'], ids: string[]) {
  if (!ids.length) return;
  await live.admin(`output=(()=>{for(const id of ${JSON.stringify(ids)}){
    const matches=Object.values(instances).map(i=>i.monsters[id]).filter(Boolean);
    if(matches.length>1||matches.some(m=>!['mummy','nerfedmummy'].includes(m.type)))throw Error('Owned mummy identity mismatch');
    for(const m of matches)remove_monster(m,{method:'disappear',nospawn:true});}return true;})()`);
}

async function mainTerrainPlay({live, info}: LiveWorld) {
  live.undo('the merchant stand', () => live.post('/merchant/force-stand', {enabled: false}));

  // H8 (live-hunt-engaged-terrain.spec.ts) from the fixture's start.
  await step('H8', async () => {
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
  await live.clients[W].run('parent.__e2eObserveMoves=true;parent.__e2eObservedMoveCount=0');
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
    const nativeMoves=await live.clients[W].events();
    const firstOwnedDamage=nativeMoves.find(event=>event.event==='hit'&&String(event.data?.id)===monster.id&&event.data?.hid===W&&event.data?.source!=='taunt'&&event.data?.damage>1);
    expect(firstOwnedDamage,'Owned route evidence must precede actual native damage').toBeTruthy();
    const combatMoves=nativeMoves.filter(event=>{const p=event.motion?.position,r=event.motion?.independentRoute,d=event.data;
      return event.event==='move-issued'&&event.at<=firstOwnedDamage!.at&&p?.target===monster.id&&
        (p.movementOwner==='combat'||p.mode==='independent-approach'&&p.movementOwner==='combat-approach'&&p.approachId&&r?.id===p.approachId&&r.target===monster.id)&&
        Number.isFinite(d?.x)&&Number.isFinite(d?.y)&&Number.isFinite(d?.going_x)&&Number.isFinite(d?.going_y)&&Math.hypot(d.going_x-d.x,d.going_y-d.y)>1;
    });
    await info.attach('native-owned-combat-route',{body:JSON.stringify({target:monster.id,firstDamage:firstOwnedDamage,combatMoves}),contentType:'application/json'});
    expect(combatMoves.length,'Actual native packets must show matching owned combat movement').toBeGreaterThan(0);
    expect(combatMoves.every(event=>event.motion?.clear===true),'Every observed native combat segment must clear terrain').toBe(true);
    expect(combatMoves.some(sample=>offBearing(geometry.origin,monster,geometry.base,sample.data)),
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
    reads.H8 = {monster, nextMonster, geometry, combatMoves: combatMoves.length};
  }finally{
    await live.clients[W].run('parent.__e2eObserveMoves=false');
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

  // H35 (live-hunt-planned-terrain.spec.ts) at its old start, main(349,1532), which the party
  // reaches by travel with the mage following.
  await step('H35', async () => {
  await live.post('/formation',{leader:W});
  for (const name of [P, M]) await live.post('/formation', {character: name, follow: true});
  const spot = {map: 'main', x: 349, y: 1532};
  await live.post('/travel', spot);
  // arrived's bound (game/hunt-lifecycle.ts, 120 s) is the shared travel's.
  await arrived(live, [W, P], spot);
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
      const peer=get_player(${JSON.stringify(name===W?P:W)});
      return {name:character.name,grouped:!!globalThis.partyHunting?.farm.grouped(),members:globalThis.partyTasks?.partyList(),
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
    // Each goal's gap to the Phoenix's hitbox and whether native terrain clears it; the gap's
    // bounds from the runtime's own reach formula are a unit row (DESIGN.md 4.3 H35).
    await expect.poll(async()=>{
      const sample=await live.clients[W].run(`(()=>{const t=parent.entities[${JSON.stringify(seed.id)}],ports=globalThis.partyMovement?.terrainRecoveryPorts?.();
        const context=ports?.context(),goals=t&&context?.target?.includes(${JSON.stringify(seed.id)})?ports.goals():[];return {
        at:Date.now(),x:character.real_x,y:character.real_y,target:t&&{x:t.x,y:t.y,hp:t.hp},
        position:globalThis.partyCombatPosition||null,recovery:globalThis.partyQueueClient?.formation?.report()||null,
        context,goals,measured:(()=>{
          if(!t||!goals.length)return null;
          const body=e=>({x:Number(e.real_x!==undefined?e.real_x:e.x),y:Number(e.real_y!==undefined?e.real_y:e.y),
            awidth:Number(e.awidth!==undefined?e.awidth:(e.width||0)/(e.mscale||1))||0,
            aheight:Number(e.aheight!==undefined?e.aheight:(e.height||0)/(e.mscale||1))||0,map:e.map,in:e.in});
          return {range:Number(character.range),target:body(t),self:body(character),goals:goals.map(p=>({point:p,
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
    }
    await expect.poll(async()=>(await live.clients[W].events()).some((event:any)=>event.event==='hit'&&
      String(event.data?.id)===seed.id&&event.data?.hid===W&&event.data?.source!=='taunt'&&event.data?.damage>1),
      {timeout:60000,message:'The proposed native recovery must lead to actual warrior damage'}).toBe(true);
    reads.H35 = {seed: seed.id, goals: measured.goals};
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

  // C18 (live-monster-safety-reach.spec.ts): its own travel to the goo field.
  await step('C18', async () => {
  const samples: any[] = [];
  try {
    expect(await live.clients[M].run('character.ctype')).toBe('mage');
    const mageRange = await live.clients[M].run('character.range');
    expect(mageRange, 'The mage must be outranged by a booboo').toBeLessThan(420);
    await live.post('/formation', { leader: W });
    for (const name of [P, M]) await live.post('/formation', { character: name, follow: true });
    await live.post('/farming-mode', { character: W, mode: 'default' });
    await live.post('/focus', { character: W, monsterFocus: ['booboo'] });
    const field = await location(live), [x1, y1, x2, y2] = field.boundary ?? [field.x, field.y, field.x, field.y];
    await live.post('/travel', field);
    // The party starts this travel from M23's stop, already gathered and still, so the gather poll
    // below passed 250 ms after the Travel and the booboos went in 390 below M23's stop while the
    // party walked off to the goo field (step6-run1: every sample idle at main 544,1751 with
    // "no valid target"; the old test started at the fixture's goo field). The leader stands in
    // the field's boundary (the travel's own area) before the gather poll.
    await expect.poll(async () => live.admin(`output=(p=>p.map==='main'&&!p.moving&&p.x>=${x1}&&p.x<=${x2}&&p.y>=${y1}&&p.y<=${y2})(get_player('${W}'))`),
      { timeout: 120_000, message: 'The leader must reach the goo field' }).toBe(true);
    await expect.poll(async () => live.admin(`output=(()=>{const ps=${JSON.stringify([W, P, M])}.map(get_player);
      return ps.every(p=>p.map==='main'&&!p.moving)&&ps.every(p=>Math.hypot(p.x-ps[0].x,p.y-ps[0].y)<250);})()`), { timeout: 120_000 }).toBe(true);
    await live.admin(`output=(()=>{globalThis.__e2eMonsterReachOwned=[];return true;})()`);
    // The booboos stand on the bearing where the game's own can_move clears the longest straight line
    // from the warrior, at most the old test's 390. Straight below the goo field (main -32,1177) the
    // mage's approach stayed "terrain-blocked" for the whole minute (livea-w03-w21-w23-run1), and no
    // bearing cleared all 390 (livea-w03-w21-w23-run2), so each bearing's reach is the longest clear
    // line, found by halving. The setup check below still needs the mage out of range at the start.
    const spawned = await live.admin(`output=(()=>{const w=get_player('${W}'),ids=[];
      const clear=(x,y)=>[-12,12].every(dx=>can_move({map:w.map,x:w.x,y:w.y,going_x:x+dx,going_y:y,base:w.base}));
      const reach=a=>{let lo=0,hi=390;if(clear(w.x+hi*Math.cos(a),w.y+hi*Math.sin(a)))return hi;
        while(hi-lo>1){const mid=(lo+hi)/2;if(clear(w.x+mid*Math.cos(a),w.y+mid*Math.sin(a)))lo=mid;else hi=mid;}return lo;};
      const best=Array.from({length:12},(_,i)=>Math.PI/2+i*Math.PI/6).map(a=>({a,r:reach(a)})).sort((p,q)=>q.r-p.r)[0];
      globalThis.__e2eMonsterReachPlant={x:w.x,y:w.y,bearing:best.a,reach:best.r};
      for(const dx of [-12,12]){const m=new_monster(w.in,{type:'booboo',position:[w.x+dx+best.r*Math.cos(best.a),w.y+best.r*Math.sin(best.a)],radius:0,count:1},{temp:1});
        globalThis.__e2eMonsterReachOwned.push({id:String(m.id),in:m.in,map:m.map,type:m.type});
        m.hp=m.max_hp=5000000;m.attack=0;m.s.stunned={ms:600000};target_player(m,w);ids.push(String(m.id));}
      return ids;})()`);
    const plant = await live.admin('output=globalThis.__e2eMonsterReachPlant');
    await info.attach('declared-booboos', { body: JSON.stringify({ spawned, mageRange, plant }), contentType: 'application/json' });
    // The setup itself: the mage has to approach to reach either booboo.
    expect(await live.clients[M].run(`${JSON.stringify(spawned)}.every(id => !parent.entities[id] || !is_in_range(parent.entities[id]))`)).toBe(true);

    // Sample actual native readiness in the client; CDP latency must not reduce the cadence.
    await live.clients[M].run(`(() => {
      const ledger={samples:[],deadline:Date.now()+60000,timer:null};
      globalThis.__e2eMonsterReachSamples=ledger;
      const capture=()=>{const p=globalThis.partyCombatPosition,t=p&&p.target&&parent.entities[p.target];
        if(Date.now()>ledger.deadline||ledger.samples.length>=60){clearInterval(ledger.timer);return;}
        ledger.samples.push({at:Date.now(),selectedId:t&&String(t.id),target:t&&t.mtype,
          inRange:!!(t&&is_in_range(t)),x:character.real_x,y:character.real_y,
          mode:p&&p.mode,reason:p&&p.reason,constraint:p&&p.constraint});};
      ledger.timer=setInterval(capture,1000);capture();return true;
    })()`);
    await waitForGameplay(60000);
    samples.push(...await live.clients[M].run('globalThis.__e2eMonsterReachSamples.samples'));
    const booboo = samples.filter(s => s.target === 'booboo');
    reads.C18 = {mageRange, spawned, plant, samples: samples.length, booboo: booboo.length, inRange: booboo.filter(s => s.inRange).length};
    expect(booboo.length, 'The party must select a booboo').toBeGreaterThan(30);
    expect(booboo.filter(s => s.inRange).length, 'The mage must spend most of the minute in range').toBeGreaterThan(booboo.length / 2);
  } finally {
    try {
      try {const retained=await live.clients[M].run(`(() => {const ledger=globalThis.__e2eMonsterReachSamples;if(!ledger)return [];clearInterval(ledger.timer);delete globalThis.__e2eMonsterReachSamples;return ledger.samples;})()`);if(retained.length>samples.length)samples.splice(0,samples.length,...retained);}
      catch(error){await info.attach('mage-reach-sampler-observation-error',{body:String(error),contentType:'text/plain'});}
      await info.attach('mage-reach-samples', { body: JSON.stringify(samples), contentType: 'application/json' });
    }
    finally {await live.admin(`output=(()=>{for(const entry of globalThis.__e2eMonsterReachOwned||[]){const m=instances[entry.in]?.monsters[entry.id];if(m&&m.type===entry.type&&m.map===entry.map)remove_monster(m,{method:'disappear',nospawn:true});}delete globalThis.__e2eMonsterReachOwned;return true;})()`);}
  }
  });

  // M23 (live-franky.spec.ts, ordinary warrior Cleave in scatter mode) at its old Town spot,
  // main(0,0), which the party reaches by travel. Its old note: "Town keeps the positive case
  // outside the spider/phoenix spawn"; nearby unrelated monsters veto Cleave by its collateral
  // guard. The scatter case also serves M22 (DESIGN.md 4.2 M22).
  await step('M23', async () => {
    const mode = 'scatter';
    const spot = {map: 'main', x: 0, y: 0};
    await live.post('/travel', spot);
    await arrived(live, [W, P], spot);
    // Failure inventory: the role never calls skill offense outside Franky;
    // target locking blocks an additional attacker; a single target wastes MP.
    // Stationary durable attackers and an axe are declared native test inputs.
    const owned: string[] = [];
    try {
    await live.post('/formation', { leader:W });
    await live.post('/formation', { character:'E2EPriest', follow:true });
    await live.post('/checkpoint', {});
    await live.post('/farming-mode', { character:W, mode });
    await expect.poll(async()=>{const s=await live.state();return !s.activeConvoy&&[W,'E2EPriest'].every(n=>s.characters[n]?.map==='main'&&!s.characters[n]?.moving);}, {timeout:90000}).toBe(true);
    await expect.poll(()=>live.clients[W].run('partyHunting.farm.mode()==="scatter"?"scatter":"grouped"')).toBe(mode==='scatter'?'scatter':'grouped');
    const first=await live.admin(`output=(()=>{const p=get_player('${W}');p.slots.mainhand={name:'waxe',level:0};p.slots.offhand=null;p.cslots.mainhand=cache_item(p.slots.mainhand);p.cslots.offhand=null;
      // Ample declared mana lets scatter exercise its budgeted positive case.
      p.slots.amulet={name:'intamulet',level:20};p.cslots.amulet=cache_item(p.slots.amulet);calculate_player_stats(p);p.mp=p.max_mp;
      const m=new_monster(p.in,{type:'mummy',position:[p.x+12,p.y],radius:0,count:1},{temp:1});
      m.hp=m.max_hp=1000000;m.attack=1;m.s.stunned={ms:600000};target_player(m,p);resend(p,'u+cid+reopen');return String(m.id);})()`);
    owned.push(first);
    await expect.poll(async()=>(await live.clients[W].events()).filter((e:any)=>e.event==='hit'&&e.data?.hid===W&&String(e.data?.id)===first&&e.data?.damage>0).length,
      {timeout:30000,message:'The warrior must actually attack its single target'}).toBeGreaterThanOrEqual(3);
    expect((await live.clients[W].events()).some((e:any)=>e.event==='hit'&&e.data?.source==='cleave'&&e.data.hid===W&&String(e.data.id)===first)).toBe(false);
    const second=await live.admin(`output=(()=>{const p=get_player('${W}');const m=new_monster(p.in,{type:'mummy',position:[p.x-12,p.y],radius:0,count:1},{temp:1});
      m.hp=m.max_hp=1000000;m.attack=1;m.s.stunned={ms:600000};target_player(m,p);return String(m.id);})()`);
    owned.push(second);
    reads.M23 = {mode, first, second};
    // The Cleave decision's reads, each second of the poll: targeting's skill gate on each mummy
    // (`targeting.allows`, table G), the cooldown and MP the engine's `blocked` weighs, and the
    // turns diagnostic the engine and executor last wrote (engine.ts `report`, executor.ts
    // `diagnostic`). The ranking drops an area cast whose hit a gate refuses (ranking.ts
    // `areaHits`) without a diagnostic, so the gate answers are the read for that drop.
    await live.clients[W].run(`(() => {
      const ledger={samples:[],timer:null},ids=${JSON.stringify([first,second])};
      globalThis.__e2eCleaveSamples=ledger;
      const capture=()=>{if(ledger.samples.length>=45){clearInterval(ledger.timer);return;}
        const h=globalThis.__partyHooks;
        ledger.samples.push({at:Date.now(),mp:character.mp,cleaveReadyAt:Number(parent.next_skill?.cleave)||0,mode:partyHunting.farm.mode(),
          skill:globalThis.partyCombatState?.skill??null,
          mummies:ids.map(id=>{const m=parent.entities[id];return m?{id,distance:distance(character,m),target:m.target,allows:h?.ask('targeting.allows',m,'cleave')??null}:{id,seen:false};})});};
      ledger.timer=setInterval(capture,1000);capture();return true;
    })()`);
    try { await expect.poll(async()=>cleaveLanded(await live.clients[W].events(), [first,second]),
      {timeout:30000,message:'Both nearby native attackers must receive Cleave'}).toBe(true); }
    finally {
      // The frame gives the farming mode and the monsters around the warrior; the samples and the
      // two rings' Cleave entries give the decision; the coordinator's walk names a return whose
      // defence vetoes Cleave (targeting gates.ts G7).
      const frame=await live.clients[W].run(`(()=>{const ledger=globalThis.__e2eCleaveSamples;if(ledger)clearInterval(ledger.timer);delete globalThis.__e2eCleaveSamples;
        const h=globalThis.__partyHooks,cleave=e=>JSON.stringify(e).includes('cleave');
        return {mp:character.mp,weapon:character.slots.mainhand,mode:partyHunting.farm.mode(),
        monsters:Object.values(parent.entities).filter(t=>t.type==='monster').map(t=>({id:t.id,type:t.mtype,target:t.target,distance:distance(character,t)})),
        samples:ledger?.samples??[],targetingRing:(h?.ask('targeting.records')??[]).filter(cleave),turnsRing:(h?.ask('skills.records')??[]).filter(cleave)};})()`);
      const s=await live.state(),c=s.activeConvoy;
      await info.attach('ordinary-cleave-eligibility-'+mode,{body:JSON.stringify({...frame,turns:s.characters[W]?.turns??null,
        convoy:c?{id:c.id,phase:c.phase,purpose:c.purpose,label:c.label,sharedStartedAt:c.sharedStartedAt,defenseReason:c.defenseReason,preparationBlocker:c.preparationBlocker}:null}),contentType:'application/json'}); }
    await info.attach('ordinary-native-cleave-'+mode,{body:JSON.stringify({first,second,events:await live.clients[W].events(),state:await live.state()}),contentType:'application/json'});
    } finally { await removeOwnedMummies(live, owned); }
  });
}

// M22 reads M23's step: the default and scatter cases differ only in the farming mode.
const own = (id: string, owner: string, behaviours: string[], from = id) => ({
  owner, behaviours, start() {}, reads: () => ({failed: failed[from] ?? null, reads: reads[from] ?? null}),
  verdict() { expect(failed[from], `${id}: every step of the play passes`).toBeUndefined(); },
});

liveWindow({
  id: 'W22', name: 'Main terrain parked monsters, warrior-led with a mage',
  // The old tests' bounds: H8 180 s, H35 180 s, C18 300 s and M23 240 s, plus arrived's 120 s
  // for each of the two party travels the old tests started at by fixture.
  timeoutMs: 1_140_000,
  use: {loadout: 'combat-range', extraFighter: 'mage', initialPosition: {map: 'main', x: 1260, y: -70}},
  play: mainTerrainPlay,
  observers: [
    {id: 'H8', ...own('H8', 'movement', ['HNT-072'])},
    {id: 'H35', ...own('H35', 'movement', ['MOV-086', 'MOV-088', 'MOV-089a', 'HNT-072', 'ADD-011'])},
    {id: 'C18', ...own('C18', 'movement', ['MOV-131'])},
    {id: 'M23', ...own('M23', 'turns', ['TRN-020'])},
    {id: 'M22', ...own('M22', 'turns', ['TRN-020'], 'M23')},
  ],
});
