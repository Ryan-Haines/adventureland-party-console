import {expect, type LiveGame} from '../live-fixtures';
import type {TestInfo} from '@playwright/test';
import {liveWindow, type LiveWorld} from '../windows';
import {W, P, evidence, nativeHit, approachOwned, combatOwned, offBearing} from '../hunt-interruption-helpers';
import {isolateNativeMapAmbient, restoreNativeMapAmbient} from '../native-map-ambient-isolation';
import {contains} from '../../runtime/hunting/zones';
import {farmingAreas} from '../../runtime/hunting/areas';

// W21 UHills wall fights, three fighters with a mage (test-windows DESIGN.md 2.2 W21). One play:
// the warrior, the priest and the mage (E2EBankBoi) fight a series of parked encounters in Upper
// Hills with its ambient monsters held, then farm its natural bots, then walk back to a saved Hawk
// spawn on Main that holds no Hawk. The order:
// 1. The corner fight (H5, H50): the three start split by the wall at H5's points; the warrior
//    engages a parked Targetron beside it; the priest and the mage round the corner into the same
//    committed fight. The mage starts on H50's reported cell, so H50 reads the mage's recovery.
// 2. The detour fight (H51, H50's priest lines): the priest walks across the wall and fights a
//    parked Targetron that targets it; the warrior detours around the wall and hits it.
// 3. The selected robot (H52): the party travels to H52's start; the priest, on a planted Fiery
//    Staff, walks off; the warrior hits the Targetron the priority selects, never the Sparkbot.
// 4. The follow staffs (combat-follow-range's priest and mage weapons) replace the combat-range
//    ones for the held-selection fights and the walk back, as their old tests' loadout had them.
// 5. Three held-selection fights from one point, each selected during a console hold and released:
//    a parked Sparkbot (H46); a parked Goo across a wall the casters already reach (H48); a roaming
//    Goo with two queued Goos (H49, with H47's barrier checks on its first attack).
// 6. The ambient monsters come back and the party navigates to the Sparkbot farm (M19).
// 7. The party is put at the old H7 test's Main points outside a saved Hawk spawn with no Hawk,
//    Main's ambient held; the empty spawn return starts (H7) and a Hawk is planted beside the
//    route, which the party must fight before the spawn center.
// The fixture starts at H5's points, the only start with three split positions. Every other
// start is reached by a walk: the dashboard's Travel for the party, or the character Travel for a
// fighter that needs an exact cell. Between fights the leader's focus is cleared, so no fighter holds a
// target and the farm tick asks nothing while the party walks.
// M19 needs the natural bots and H7 a Main with none, so the uhills ambient is held for steps 1-5
// and back for step 6, and Main's is held for step 7. H7 comes last because its saved spot (Main)
// would pull any later uhills step back to Main.
// Failure modes: H5, a caster loses the committed fight, moves through terrain or changes CODE
// generation or combat epoch; H50, the mage never reaches range, leaves Upper Hills or moves
// through terrain; H51, the warrior walks the blocked bearing or never hits; H52, the warrior hits
// the alternate or stalls past 35 s; H46, a caster attacks without its own approach; H48, a caster
// already in range takes an approach before the confirmed attack; H47 and H49, the first attack
// fires without every member's fresh confirmation, the intercept does not lead the moving Goo, or
// the queue does not advance; M19, a fighter never enters the farm or never hits there; H7, the
// return does not start, or the party reaches the spawn center before it fights the planted Hawk.
// Each check's assertions are its old test's, with their messages, so the coverage ledger matches
// them. A failed step records its message under its check and the play goes on.
// Every old spec this window cites is at 21fe30a2b.
const M = 'E2EBankBoi', fighters = [W, P, M];
const starts = {
  [W]: {map: 'uhills', x: -551, y: -80}, [P]: {map: 'uhills', x: -830, y: -310},
  [M]: {map: 'uhills', x: -830, y: -300}, E2EMerchant: {map: 'main', x: -63, y: 100},
};
type Point = {map: string; x: number; y: number};
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
// A step records its failure under each check it serves, so a shared fight fails both.
const step = async (ids: string | string[], run: () => Promise<unknown>) => {
  try { await run(); } catch (error) { for (const id of [ids].flat()) failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); }
};
// The fight's own native events: a fight reads the ring from its start, so a move or a position
// of an earlier fight never counts in its reads.
const since = async (live: LiveGame, name: string, from: number) => (await live.clients[name].events()).filter((e: any) => e.at >= from);
// The leader's own focus write clears the party focus and every follower's own focus
// (runtime/hunting/coordinator/farm.ts takeLeaderFocus), so a priest focus a fight set never
// outlives it. An empty focus gives the farm tick no area, so no walk back starts between fights.
const clearFocus = (live: LiveGame) => live.post('/focus', {character: W, monsterFocus: []});
// The native client records at most 200 moves and 100 independent attacks per character
// (e2e/live-game-client.ts:130, :169), so each fight starts its own count.
const observeMoves = (live: LiveGame) => Promise.all(fighters.map(name => live.clients[name].frame.evaluate(() => {
  const p = window as any; p.__e2eObserveMoves = true; p.__e2eObservedMoveCount = 0; p.__e2eIndependentObservedAttackCount = 0; p.__e2eIndependentObservedTargets = {};
})));
// The party walks to a fight's start by the dashboard's Travel, which makes the spot the party's
// farm destination, so the farm approach holds the fighters there instead of walking them back to
// an earlier checkpoint (e2e/cave-pacing-row.ts:16-20). Its bound is the old tests' uhills walk,
// 60 s (live-hunt-targetron-terrain.spec.ts:36); the trip task's end takes one task tick after
// the walk, as cave-pacing-row.ts:24 waits it.
async function travel(live: LiveGame, at: Point) {
  await live.post('/travel', at);
  await expect.poll(async () => !(await live.state()).activeConvoy, {timeout: 60_000, message: 'The party walk to the next fight must end'}).toBe(true);
  await expect.poll(async () => (await live.tasks()).groups.find((g: any) => g.id === `party:${W}`)?.live?.kind,
    {timeout: 30_000, message: 'The trip task must end before the fight'}).not.toBe('manual');
}
// A fighter steps out of the formation and walks to its exact start by the dashboard's character
// Travel, within the old tests' arrival bound of 8 (live-hunt-targetron-terrain.spec.ts:36). A
// typed smart_move ranks as the player's command, the same rank as the party Travel's group walk,
// so the movement owner refused it while that walk held the journey (movement/rules.ts `decide`,
// step6-run1 H46-H49 and H52). The formation write moves the navigation revision, which ended a
// typed walk already under way (character/owner.ts `current`, step6-run1 H50 and H51). The
// character Travel is the coordinator's own command for one member (coordinator/arrivals.ts
// `travel`), so neither applies.
// A fighter already on its start takes no Travel: H49 starts where H48 left the party, and the
// Travel to the cell a fighter stands on left its intent live, so the priest's nomination stayed
// "blocked: travel intent" and the mage's "manual navigation" (livea-w03-w21-w23-run1).
async function place(live: LiveGame, name: string, at: Point, message = `${name} must reach its start`, within = 8) {
  const distance = () => live.clients[name].run(`character.map===${JSON.stringify(at.map)}?Math.hypot(character.real_x-(${at.x}),character.real_y-(${at.y})):1e9`);
  if (name !== W) await live.post('/formation', {character: name, follow: false});
  if (await distance() < within) return;
  await live.post('/command', {character: name, type: 'character-travel', location: at, label: 'W21 start'});
  await expect.poll(distance, {timeout: 60_000, message}).toBeLessThan(within);
}

// ---- 1. The corner fight: H5, with H50's mage ----

// H50's start (live-hunt-targetron-mage.spec.ts): the mage's class, range and starting cell. The
// old test's mage was its primary, E2EWarrior; here it is the extra fighter, so `W` names the mage
// in H50's code and the old reads stay as written.
async function h50Start(live: LiveGame, info: TestInfo, W: string) {
  expect(await live.clients[W].run('character.ctype')).toBe('mage');
  expect(await live.clients[W].run('character.range')).toBeLessThan(220);
  const initialNative=await live.admin(`output=(()=>{const p=get_player('${W}');return {map:p.map,x:p.x,y:p.y,
    cell:smap_data[p.map]===-1?0:smap_data[p.map][rphash(p.x,p.y)],
    clear:can_move({map:p.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:p.base})};})()`);
  expect(initialNative.map).toBe('uhills');
  expect(initialNative.cell,'The pinned native server must admit the starting sMap cell').toBeLessThan(2);
  expect(initialNative.clear).toBe(true);
  await info.attach('targetron-mage-native-starting-cell',{body:JSON.stringify(initialNative),contentType:'application/json'});
}
// H50's terrain read from the mage: a Targetron cell across the wall, out of the mage's range.
// The search centers on the corner fight's seed point, which is its radius-0 candidate.
async function h50Geometry(live: LiveGame, info: TestInfo, W: string, isolation: {removed: string[]}) {
  await expect.poll(async()=>Promise.all([W,P].map(name=>live.clients[name].run(
    `${JSON.stringify(isolation.removed)}.filter(id=>parent.entities[id]&&!parent.entities[id].dead).length`))),
    {timeout:15000,message:'Native disappearance must retire removed Targetrons from both clients'}).toEqual([0,0]);
  const geometry=await live.clients[W].run(`(()=>{
    const origin={x:character.real_x,y:character.real_y},points=[];
    for(const radius of [0,32,64,96,128])for(let i=0;i<(radius?16:1);i++){
      const angle=i*Math.PI/8,x=-575+radius*Math.cos(angle),y=-80+radius*Math.sin(angle);
      const clear=can_move({map:character.map,x,y,going_x:x,going_y:y,base:character.base});
      const blocked=!can_move_to(x,y);
      if(clear&&blocked&&Math.hypot(x-origin.x,y-origin.y)>character.range+60)points.push({x,y,clear,blocked});
    }
    return {map:character.map,origin,range:character.range,goal:points[0]||null};
  })()`);
  expect(geometry.goal,'Find a native collision-safe Targetron position across the screenshot terrain').toBeTruthy();
  await info.attach('targetron-mage-native-terrain-seed',{body:JSON.stringify(geometry),contentType:'application/json'});
  return geometry;
}
// H50's sampler on the mage: every 100 ms its position, movement owner and segment clearance.
async function h50Sampler(live: LiveGame, W: string, seed: {id: string}) {
  await live.clients[W].run(`(()=>{
    const observation={samples:[],timer:null,previous:null};globalThis.__e2eTargetronMageSampler=observation;
    const sample=()=>{const t=parent.entities[${JSON.stringify(seed.id)}],p=globalThis.partyCombatPosition;
      const current={at:Date.now(),map:character.map,in:character.in,rip:!!character.rip,x:character.real_x,y:character.real_y,target:character.target,
        moving:!!character.moving,going:{x:character.going_x,y:character.going_y},
        segmentClear:character.moving?can_move_to(character.going_x,character.going_y):null,
        distance:t?distance(character,t):null,positioning:p?{at:p.at,mode:p.mode,movementOwner:p.movementOwner,target:p.target,
          reason:p.reason,constraint:p.constraint,healingDistance:p.healingDistance,healingRange:p.healingRange,approachId:p.approachId}:null};
      const owns=p=>p?.movementOwner==='combat'||p?.movementOwner==='combat-approach'&&p.mode==='independent-approach'&&typeof p.approachId==='string';
      const previous=observation.previous,displacement=previous?Math.hypot(current.x-previous.x,current.y-previous.y):0;
      const ownedDisplacement=displacement>1&&previous.map===current.map&&previous.in===current.in&&
        owns(previous.positioning)&&owns(current.positioning)&&
        String(previous.positioning?.target)===${JSON.stringify(seed.id)}&&String(current.positioning?.target)===${JSON.stringify(seed.id)};
      observation.samples.push({...current,previous:previous?{at:previous.at,map:previous.map,in:previous.in,x:previous.x,y:previous.y,positioning:previous.positioning}:null,
        displacement,ownedDisplacement,observedSegmentClear:ownedDisplacement?can_move({map:current.map,x:previous.x,y:previous.y,
          going_x:current.x,going_y:current.y,base:character.base}):null});
      observation.previous=current;
      if(observation.samples.length>600)observation.samples.shift();};
    sample();observation.timer=setInterval(sample,100);return true;
  })()`);
}
// H50's fight read: the mage rounds the wall to its range and hits.
async function h50Fight(live: LiveGame, info: TestInfo, W: string, seed: {id: string}, geometry: any) {
  const samples:any[]=[];
  try{
    await expect.poll(async()=>{
      const observed=await live.clients[W].run('globalThis.__e2eTargetronMageSampler.samples.splice(0)');
      samples.push(...observed);
      for(const sample of observed){
        expect(sample.map,'Combat recovery must not send the mage to jail or another map').toBe('uhills');
        if(sample.moving&&['combat','combat-approach'].includes(sample.positioning?.movementOwner)&&sample.positioning?.target===seed.id)
          expect(sample.segmentClear,'Every observed combat-owned movement segment must be collision clear').toBe(true);
      }
      return (await live.clients[W].events()).some((event:any)=>event.event==='hit'&&String(event.data?.id)===seed.id&&event.data?.hid===W&&event.data?.damage>0);
    },{timeout:60000,intervals:[100,250],message:'The mage must recover around native UHills terrain and damage Targetron'}).toBe(true);
    // The mage casts on the pass it reaches range, between two of the sampler's 100 ms samples, so
    // the poll can see the hit before any in-range sample exists. Read the samples up to the first
    // one taken at or after the hit.
    const hitAt=(await live.clients[W].events()).find((event:any)=>event.event==='hit'&&String(event.data?.id)===seed.id&&event.data?.hid===W&&event.data?.damage>0).at;
    await expect.poll(async()=>{
      samples.push(...await live.clients[W].run('globalThis.__e2eTargetronMageSampler.samples.splice(0)'));
      return samples.some(sample=>sample.at>=hitAt);
    },{timeout:10000,message:'The sampler must record the mage at its first hit'}).toBe(true);
    expect(samples.some(sample=>sample.distance!==null&&sample.distance<=geometry.range),
      'The mage must reach native attack range').toBe(true);
    expect(samples.some(sample=>sample.ownedDisplacement&&sample.observedSegmentClear||
      sample.moving&&sample.segmentClear&&combatOwned(sample.positioning)&&sample.positioning?.target===seed.id),
      'The selected native encounter must own collision-clear combat movement').toBe(true);
    expect(samples.some(sample=>Math.hypot(sample.x-geometry.origin.x,sample.y-geometry.origin.y)>10),
      'The mage must actually leave its initially blocked position').toBe(true);
    expect(await live.clients[W].run('character.rip')).toBeFalsy();
  }finally{
    samples.push(...await live.clients[W].run(`(()=>{const observation=globalThis.__e2eTargetronMageSampler;
      if(!observation)return [];clearInterval(observation.timer);delete globalThis.__e2eTargetronMageSampler;return observation.samples;})()`));
    reads.H50 = {geometry, samples: samples.length, first: samples[0], last: samples.at(-1)};
    await evidence(live,info,'targetron-mage-native-terrain-combat-recovery',{geometry,seed,samples,
      hits:(await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&String(event.data?.id)===seed.id&&event.data?.hid===W)});
  }
}

// H5 (live-hunt-committed-three-fighter-corner.spec.ts) with H50's mage read beside it.
async function cornerFight({live, info}: LiveWorld, isolated: {removed: string[]; targetrons: string[]; heldRespawns: number}): Promise<string | null> {
  const samples:any[]=[],events:Record<string,any[]>={},from=Date.now();
  let seed:any,geometry50:any;
  await step('H50', () => h50Start(live, info, M));
  await step('H5', async () => {
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
  });
  await step('H50', async () => { geometry50 = await h50Geometry(live, info, M, {removed: isolated.targetrons}); });
  try{
    await step(['H5', 'H50'], async () => {
      // The ambient isolation holds every uhills monster but the ones marked exempt.
      seed=await live.admin(`output=(()=>{
        const original=G.monsters.targetron;globalThis.__e2eCornerOriginal=original;
        G.monsters.targetron={...original,stationary:true};
        const m=new_monster('uhills',{__e2eAmbientExempt:true,type:'targetron',count:1,position:[-575,-80],radius:0},{temp:1});
        m.speed=0;m.moving=false;m.hp=m.max_hp=10000000;m.target=${JSON.stringify(W)};m.u=true;m.abs=true;m.cid++;
        return {id:String(m.id),map:m.map,x:m.x,y:m.y,wire:monster_to_client(m),at:Date.now()};})()`);
    });
    if(!seed)return null;
    // H50's reads before the fight: one Targetron, and the mage still in Upper Hills.
    await step('H50', async () => {
      expect(await live.admin(`output=Object.values(instances.uhills.monsters).filter(m=>m.type==='targetron').map(m=>String(m.id))`),
        'The declared combat scenario starts with exactly its seeded Targetron').toEqual([seed.id]);
      expect(await live.clients[M].run('character.map'),'The mage must remain in UHills before combat').toBe('uhills');
      await h50Sampler(live, M, seed);
    });
    await observeMoves(live);
    await live.post('/formation',{leader:W});
    for(const name of [P,M])await live.post('/formation',{character:name,follow:true});
    await live.post('/focus',{monsterFocus:['targetron'],monsterPriorities:{targetron:999},monsterSearchRadius:600});
    await live.post('/farming-mode',{character:W,mode:'default'});
    const hit=(list:any[],name:string,since=0)=>list.find(e=>e.event==='hit'&&e.at>=since&&e.at<=Date.now()&&String(e.data?.id)===seed.id&&
      e.data?.hid===name&&e.data?.source!=='taunt'&&e.data?.damage>1);
    let committedAt=0;
    await step('H5', async () => {
      await expect.poll(async()=>{const views=await Promise.all(fighters.map(name=>live.clients[name].run(
        '({grouped:!!partyHunting.farm.grouped(),members:partyTasks.partyList()})')));
        return views.every(v=>v.grouped&&fighters.every(name=>v.members.includes(name)));},
        {timeout:30000,message:'All three actual fighter runtimes must adopt the committed formation'}).toBe(true);
      await expect.poll(async()=>{
        events[W]=await since(live,W,from);return !!hit(events[W],W);
      },{timeout:30000,message:'Native Warrior damage must establish the real red fight'}).toBe(true);
      committedAt=hit(events[W],W).at;
      await expect.poll(async()=>{const state=await live.state();return fighters.every(name=>
        state.characters[name]?.groupedCombat?.state?.queue?.some((target:any)=>String(target.id)===seed.id&&target.state==='engaged'));},
        {timeout:15000,message:'The real native fight must be committed to all three fighter controls'}).toBe(true);
    });
    // The red fight stands: H5's casters and H50's mage are read from here on the same fight.
    await Promise.all([
      step('H5', async () => {
        if(!committedAt)throw Error('H5: the red fight was never committed');
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
          for(const name of fighters)events[name]=await since(live,name,from);
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
      }),
      step('H50', async () => {
        if(!geometry50)throw Error('H50: no terrain geometry');
        await h50Fight(live, info, M, seed, geometry50);
      }),
    ]);
  }finally{
    reads.H5 = {seed, samples: samples.length};
    await live.clients[M].run(`(()=>{const o=globalThis.__e2eTargetronMageSampler;if(o){clearInterval(o.timer);delete globalThis.__e2eTargetronMageSampler;}return true;})()`).catch(()=>null);
    await live.admin(`output=(()=>{
      const m=instances.uhills.monsters[${JSON.stringify(seed?.id||'')}];if(m)remove_monster(m,{method:'disappear',nospawn:true});
      if(globalThis.__e2eCornerOriginal){G.monsters.targetron=__e2eCornerOriginal;delete globalThis.__e2eCornerOriginal;}return true;})()`);
    await clearFocus(live);
  }
  return seed?.id ?? null;
}

// A fight ends with no fighter seeing its target alive, no fighter's queue holding one, and no
// fighter's group holding the fight's own monster (`fought`) in its fights. The isolations remove
// monsters with no death, and the game clears a player's target only on that player's own target
// call (server.js socket "target"). In final-gate-closing4 W21 rerun 2 all three kept the removed
// 468, which their status reports carry, and a member's reported target holds the spawn return
// (farm.ts returnToSpawn). So each fighter makes that call for a removed id.
// A removed monster leaves the group's fights only when the bounded search retires it
// (coordinator/targeting/unseen.ts `recoverLostTargets`, the `unseenGoneMs` window with every member
// observing near its last sighting), and the queue reads empty whenever the group has no target
// (queue.ts `lockedQueue`). In final-gate-closing9's W21 run 3 the queue read empty while the group
// regrouped, then named the removed Targetron 493 again, and its sight recovery walked the warrior
// 55 off its H51 start.
// `log` keeps each poll's group read (groupRead), so a fight that comes back after the poll passed
// shows which record held it (final-gate-closing10 W21 run 1: 493's sight recovery walked the
// warrior 57 off its H51 start, as in closing 7 and closing 9).
async function fightEnded(live: LiveGame, message: string, fought: string[] = [], log?: unknown[]) {
  await expect.poll(async()=>{
    const state=await live.state(),views=await Promise.all(fighters.map(n=>live.clients[n].run(
      '(()=>{const e=character.target&&parent.entities[character.target];return !!(e&&!e.dead);})()')));
    log?.push({poll:message,views,...groupRead(state)});
    const group=(n:string)=>state.characters[n]?.groupedCombat?.state;
    return {live:views,queues:fighters.map(n=>(group(n)?.queue||[]).map((t:any)=>t.id)),
      fights:fighters.map(n=>(group(n)?.fights||[]).map((t:any)=>String(t.id)).filter((id:string)=>fought.includes(id)))};
  },{message}).toEqual({live:fighters.map(()=>false),queues:fighters.map(()=>[]),fights:fighters.map(()=>[])});
  await Promise.all(fighters.map(n=>live.clients[n].run('(()=>{if(character.target&&!parent.entities[character.target])change_target(null);return character.target??null;})()')));
  await expect.poll(async()=>Promise.all(fighters.map(n=>live.clients[n].run('character.target??null'))),
    {message:'No fighter keeps a removed target'}).toEqual(fighters.map(()=>null));
}
// The group's fight as the coordinator records it (the leader's farming profile, queue.ts's result)
// and as each fighter's last reply carries it, with the warrior's position and positioning.
function groupRead(state: any) {
  const ids=(list: any)=>(list||[]).map((t: any)=>String(t.id));
  const fight=(g: any)=>g?{seenAt:g.seenAt,resetAt:g.resetAt,phase:g.phase,target:g.target?.id??null,fights:ids(g.fights),queue:ids(g.queue)}:null;
  const g=state.farmingProfiles?.[W]?.groupedCombat,c=state.characters?.[W];
  return {at:Date.now(),coordinator:g?{...fight(g),lost:(g.lostTargets||[]).slice(-3).map((l: any)=>[l.id,l.retiredAt,l.reason]),
    trace:(g.transitionTrace||[]).slice(-3)}:null,copies:Object.fromEntries(fighters.map(n=>[n,fight(state.characters?.[n]?.groupedCombat?.state)])),
    warrior:c&&{x:c.x,y:c.y,positioning:c.combat?.positioning}};
}

// ---- 2. The detour fight: H51, with H50's priest lines ----

// H51 (live-hunt-targetron-terrain.spec.ts). The priest's own focus and farming mode are H50's
// setup (live-hunt-targetron-mage.spec.ts:62-63), so the priest damages the Targetron before it
// joins the formation, which H50's priest line reads.
async function detourFight({live, info}: LiveWorld, corner: string | null) {
  const setupOwnership:any[]=[],samples:any[]=[],fightEnd:any[]=[];
  let geometry:any,seed:any;
  await step('H51', async () => {
    // The corner fight's Targetron is removed with no death. In final-gate-closing7 the poll below
    // passed 250 ms after its disappear, while the queue still held it; the queue then handed it back
    // and its sight recovery walked the warrior 55 off its start along the fight's breadcrumbs
    // (movement/character/steps.ts `queueRecoveryMove`, mode fight-recovery on 1195). fightEnded
    // waits for the group's fights too (final-gate-closing9 W21 run 3).
    await fightEnded(live,'No fighter holds the corner Targetron before the detour setup',corner?[corner]:[],fightEnd);
    try{
      await expect.poll(async()=>{
        const actors=await Promise.all([W,P].map(name=>live.clients[name].run(`(()=>{const r=globalThis,s=r.sharedRoutine,g=r.__partyGroupedCombat;return {name:character.name,focus:r.partyHunting?.farm.focus().slice(),target:g?.target?.id||null,independent:r.partyQueueClient?.independent?.report?.()||null};})()`)));
        setupOwnership.push({at:Date.now(),actors});if(setupOwnership.length>32)setupOwnership.splice(4,1);
        return actors.every(actor=>Array.isArray(actor.focus)&&actor.focus.length===0&&!actor.target&&!actor.independent);
      },{timeout:15000,message:'Native CODE must retire ambient targeting before the declared Priest placement'}).toBe(true);
    }finally{await info.attach('targetron-native-setup-ownership',{body:JSON.stringify(setupOwnership),contentType:'application/json'});}
    // The search runs from the old test's warrior start (live-hunt-targetron-terrain.spec.ts:4).
    // The corner fight leaves the warrior wherever it ended, and from (-548,-124) in
    // final-gate-closing4 W21 rerun 2 no candidate was both blocked, out of reach and walkable.
    // The group read goes on through the start walk, where the removed Targetron came back.
    const walking={on:true},sampler=(async()=>{while(walking.on){fightEnd.push(groupRead(await live.state()));await new Promise(r=>setTimeout(r,250));}})();
    try{await place(live, W, {map: 'uhills', x: -573, y: -80});}
    finally{walking.on=false;await sampler.catch(()=>null);await info.attach('h51-fight-end-reads',{body:JSON.stringify(fightEnd),contentType:'application/json'});}
    geometry=await live.clients[W].run(`(()=>{
      const origin={x:character.real_x,y:character.real_y},points=[];
      // The farthest point the warrior walks straight toward (x,y) before terrain stops it, found
      // by bisection to one game unit.
      const stop=(x,y)=>{let lo=0,hi=1;const at=t=>({x:origin.x+(x-origin.x)*t,y:origin.y+(y-origin.y)*t});
        while((hi-lo)*Math.hypot(x-origin.x,y-origin.y)>1){const t=(lo+hi)/2,p=at(t);if(can_move_to(p.x,p.y))lo=t;else hi=t;}
        return at(lo);};
      // The game's attack distance (old_common_functions.js distance) from the warrior standing at p
      // to a Targetron at (x,y).
      const reach=(p,x,y)=>distance({map:character.map,real_x:p.x,real_y:p.y,awidth:get_width(character),aheight:get_height(character)},
        {map:character.map,type:'monster',mtype:'targetron',x,y});
      for(const radius of [0,32,64,96,128])for(let i=0;i<(radius?16:1);i++){
        const angle=i*Math.PI/8,x=-805+radius*Math.cos(angle),y=-224+radius*Math.sin(angle);
        const clear=can_move({map:character.map,x,y,going_x:x,going_y:y,base:character.base});
        const blocked=!can_move_to(x,y);
        // A goal counts only when the bearing's stop point is out of the warrior's attack range, so
        // its first hit proves it left the bearing.
        if(clear&&blocked){const end=stop(x,y),gap=reach(end,x,y);if(gap>character.range)points.push({x,y,clear,blocked,stop:end,gap});}
      }
      return {map:character.map,origin,range:character.range,base:character.base,speed:character.speed,candidates:points};
    })()`);
    // A goal counts only when the console's own planner walks both fighters to it. A free cell can
    // sit in a pocket no walk reaches: in final-gate-closing4 W21 rerun 2 the goal (-805,-192) had
    // no ALClient route, so the priest's Travel ended at once.
    const identity=await live.clients[P].run('globalThis.__partyMovement?.identity??null');
    expect(identity,'The priest\'s movement owner names its planner geometry').toBeTruthy();
    const priest=await live.clients[P].run('({map:character.map,in:character.in,x:character.real_x,y:character.real_y,speed:character.speed,base:character.base})');
    const walks=async(name:string,from:any,to:any,speed:number,base:unknown)=>{
      const plan=await live.post('/movement-plan',{character:name,id:`W21-H51-${name}-${to.x},${to.y}`,from,to:{map:geometry.map,x:to.x,y:to.y},
        speed,town:false,version:identity.version,fingerprint:identity.fingerprint,base});
      geometry.tried.push({name,to,error:plan.error??null,plot:Array.isArray(plan.plot)?plan.plot.length:null});
      return !plan.error&&Array.isArray(plan.plot);
    };
    // Each planner answer stays in the seed's read, so a search that finds no goal names why
    // (final-gate-closing10 W21 run 2 found none and its dump held no read of the search).
    geometry.priest=priest;geometry.tried=[];
    for(const point of geometry.candidates){
      if(await walks(P,priest,point,priest.speed,priest.base)&&
        await walks(W,{map:geometry.map,...geometry.origin},point,geometry.speed,geometry.base)){geometry.goal=point;break;}
    }
    await info.attach('targetron-native-terrain-seed',{body:JSON.stringify(geometry),contentType:'application/json'});
    expect(geometry.goal,'Find a native collision-safe Targetron position across the screenshot terrain').toBeTruthy();
  });
  if(!geometry?.goal)return;
  await step(['H51','H50'], () => place(live, P, {map: 'uhills', x: geometry.goal.x, y: geometry.goal.y}, 'The native priest must reach the other side through real pathfinding'));
  await live.post('/focus',{character:P,monsterFocus:['targetron'],monsterPriorities:{targetron:999},monsterSearchRadius:600});
  await live.post('/farming-mode',{character:P,mode:'default'});
  await live.post('/focus',{monsterFocus:['targetron'],monsterPriorities:{targetron:999},monsterSearchRadius:600});
  await live.post('/farming-mode',{character:W,mode:'default'});
  await live.post('/checkpoint',{});
  await observeMoves(live);
  try{
    await step('H51', async () => {
      seed=await live.admin(`output=(()=>{const original=G.monsters.targetron;try{
        globalThis.__e2eWarriorTargetronOriginal=original;
        if(!original)throw Error('Native Targetron catalog missing');
        // Declared parked encounter; retain native hitboxes, targeting and damage.
        G.monsters.targetron={...original,speed:0,charge:0,hp:10000000};
        const m=new_monster('uhills',{__e2eAmbientExempt:true,type:'targetron',count:1,position:[${geometry.goal.x},${geometry.goal.y}],radius:0},{temp:1});
        m.speed=0;m.charge=0;m.hp=m.max_hp=10000000;
        target_player(m,get_player('${P}'));return {id:String(m.id),map:m.map,x:m.x,y:m.y,target:m.target};
      }catch(error){G.monsters.targetron=original;delete globalThis.__e2eWarriorTargetronOriginal;throw error;}})()`);
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
      await expect.poll(async()=>(await live.clients[P].events()).some((event:any)=>event.event==='hit'&&
        String(event.data?.hid)===seed.id&&event.data?.id===P&&event.data?.damage>0),
        {timeout:30000,message:'Native Targetron must engage the priest before the warrior follows'}).toBe(true);
    });
    if(!seed)return;
    await step('H50', async () => {
      await expect.poll(async()=>(await live.clients[P].events()).some((event:any)=>event.event==='hit'&&
        String(event.data?.id)===seed.id&&event.data?.hid===P&&event.data?.damage>0),
        {timeout:30000,message:'The native priest must damage Targetron before joining the mage-led formation'}).toBe(true);
    });
    await live.post('/formation',{character:P,follow:true});
    await step('H51', async () => {
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
      const nativeEvents=await live.clients[W].events(),firstDamage=nativeEvents.find(event=>nativeHit(event,W,seed.id));
      expect(firstDamage,'The native bend window must end at the actual first attack damage receipt').toBeTruthy();
      const capture=await live.clients[W].frame.evaluate(()=>(window as any).__e2eTargetronPositions);
      expect(capture.overflow,'Native position capture must remain complete').toBe(false);
      const nativePath=capture.samples.filter((p:any)=>p.map===geometry.map&&p.at<=firstDamage!.at&&Number.isFinite(p.x)&&Number.isFinite(p.y));
      expect(nativePath.some((p:any)=>offBearing(geometry.origin,seed,geometry.base,p)),
        'Actual native movement must bend around the originally blocked direct bearing').toBe(true);
      expect(await live.clients[W].run('character.rip')).toBeFalsy();
    });
  }finally{
    const capture=await live.clients[W].frame.evaluate(()=>{
      const game=window as any,capture=game.__e2eTargetronPositions;
      if(capture)cancelAnimationFrame(capture.frame);
      delete game.__e2eTargetronPositions;return capture;
    }).catch(()=>null);
    await info.attach('targetron-native-position-trace',{body:JSON.stringify(capture),contentType:'application/json'});
    reads.H51 = {geometry, seed, samples: samples.length};
    try{
      await evidence(live,info,'targetron-native-terrain-combat-recovery',{geometry,seed,samples,
        hits:seed?(await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&String(event.data?.id)===seed.id&&event.data?.hid===W):[]});
    }finally{
      await live.admin(`output=(()=>{const m=instances.uhills.monsters[${JSON.stringify(seed?.id||'')}];
        if(m)remove_monster(m,{silent:true});
        if(globalThis.__e2eWarriorTargetronOriginal)G.monsters.targetron=globalThis.__e2eWarriorTargetronOriginal;
        delete globalThis.__e2eWarriorTargetronOriginal;return true;})()`);
      await clearFocus(live);
    }
  }
}

// ---- 3. The selected robot: H52 ----

// H52 (live-hunt-targetron-terrain.spec.ts "selected UHills handoff") from its own start, which the
// party travels to. The priest's planted weapon and shoes go back in this step's finally.
async function selectedRobot({live, info}: LiveWorld) {
  const start: Point = {map: 'uhills', x: -536.23, y: -431.28};
  await step('H52', () => place(live, W, start));
  const before = await live.admin(`output=(p=>JSON.parse(JSON.stringify(p.slots)))(get_player('${P}'))`) as Record<string, unknown>;
  const samples:any[]=[];
  let seed:any;
  try{
    await step('H52', async () => {
      await live.admin(`output=(()=>{const p=get_player('${P}');p.slots.mainhand={name:'firestaff',level:8};p.slots.offhand=null;p.slots.shoes={name:'shoes',level:0};cache_player_items(p);calculate_player_stats(p);resend(p,'reopen+cid');return {range:p.range,speed:p.speed};})()`);
      const geometry=await live.clients[W].run(`(()=>{const closest=(x,y)=>{const points=[];for(let dx=-96;dx<=96;dx+=8)for(let dy=-96;dy<=96;dy+=8){const p={x:x+dx,y:y+dy};if(can_move({map:character.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:character.base}))points.push(p);}return points.sort((a,b)=>Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];};return {priest:closest(-331,-484),target:closest(-648,-209),alternate:closest(-816,-320)};})()`);
      await info.attach('selected-uhills-native-geometry',{body:JSON.stringify(geometry),contentType:'application/json'});
      // place() holds the old `expect.poll(()=>live.clients[P].run(`Math.hypot(character.real_x-(${geometry.priest.x}),character.real_y-(${geometry.priest.y}))`),{timeout:60000}).toBeLessThan(10)`,
      // with its bound of 10 and 60 s, after the character Travel.
      await place(live, P, {map: 'uhills', x: geometry.priest.x, y: geometry.priest.y}, `${P} must reach its start`, 10);
      await live.post('/formation',{leader:W});
      await live.post('/formation',{character:P,follow:true});
      await live.post('/focus',{monsterFocus:['targetron','sparkbot'],monsterPriorities:{targetron:999,sparkbot:500},monsterSearchRadius:800});
      await live.post('/farming-mode',{character:W,mode:'default'});
      await live.post('/checkpoint',{});
      await observeMoves(live);
      seed=await live.admin(`output=(()=>{globalThis.__selectedRobotOriginal={targetron:G.monsters.targetron,sparkbot:G.monsters.sparkbot};for(const type of ['targetron','sparkbot'])G.monsters[type]={...G.monsters[type],speed:0,charge:0,hp:10000000};const primary=new_monster('uhills',{__e2eAmbientExempt:true,type:'targetron',count:1,position:[${geometry.target.x},${geometry.target.y}],radius:0},{temp:1});const alternate=new_monster('uhills',{__e2eAmbientExempt:true,type:'sparkbot',count:1,position:[${geometry.alternate.x},${geometry.alternate.y}],radius:0},{temp:1});for(const m of [primary,alternate]){m.speed=0;m.charge=0;m.hp=m.max_hp=10000000;}return {primary:String(primary.id),alternate:String(alternate.id)};})()`);
      await expect.poll(async()=>{
        for(const name of [W,P])samples.push(await live.clients[name].run('({name:character.name,at:Date.now(),x:character.real_x,y:character.real_y,positioning:globalThis.partyCombatPosition,group:globalThis.sharedRoutine.targeting.queue()})'));
        return (await live.clients[W].events()).some((e:any)=>nativeHit(e,W,seed.primary));
      },{timeout:35000,intervals:[100,250],message:'The selected robot must receive a native warrior attack without exhausted recovery'}).toBe(true);
      expect((await live.clients[W].events()).some((e:any)=>e.event==='hit'&&String(e.data?.id)===seed.alternate&&e.data?.hid===W)).toBe(false);
    });
  }finally{
    reads.H52 = {seed, samples: samples.length};
    await evidence(live,info,'selected-uhills-native-handoff',{seed,samples}).catch(()=>null);
    await live.admin(`output=(()=>{for(const id of ${JSON.stringify(seed?[seed.primary,seed.alternate]:[])}){const m=instances.uhills.monsters[id];if(m)remove_monster(m,{silent:true});}if(globalThis.__selectedRobotOriginal)Object.assign(G.monsters,globalThis.__selectedRobotOriginal);delete globalThis.__selectedRobotOriginal;return true;})()`);
    await live.admin(`output=(()=>{const p=get_player('${P}'),slots=${JSON.stringify(before)};for(const slot of Object.keys(p.slots))p.slots[slot]=slots[slot]??null;cache_player_items(p);calculate_player_stats(p);resend(p,'reopen+cid');return true;})()`);
    await clearFocus(live);
  }
}

// ---- 4. The follow staffs ----

// combat-follow-range's casters (e2e/game/loadouts.ts:58): a +12 staff for the priest and a +15
// staff for the mage, as the held-selection fights' and H7's old tests logged in with. The
// combat-range weapons come back through the undo. The wait is the economy seed's 30 s for the
// clients to read a planted item (live-economy.spec.ts seed).
async function followStaffs(live: LiveGame) {
  const before = await live.admin(`output=Object.fromEntries(${JSON.stringify([P, M])}.map(n=>[n,get_player(n).slots.mainhand]))`) as Record<string, unknown>;
  live.undo('the combat-range caster weapons', () => live.admin(`output=(()=>{const before=${JSON.stringify(before)};for(const [n,item] of Object.entries(before)){const p=get_player(n);if(!p)continue;p.slots.mainhand=item;cache_player_items(p);calculate_player_stats(p);resend(p,'reopen+cid');}return true;})()`));
  await live.admin(`output=(()=>{for(const [n,level] of [['${P}',12],['${M}',15]]){const p=get_player(n);p.slots.mainhand={name:'staff',level};cache_player_items(p);calculate_player_stats(p);resend(p,'reopen+cid');}return true;})()`);
  await expect.poll(async () => Promise.all([P, M].map(n => live.clients[n].run(`character.slots.mainhand?.name+'@'+character.slots.mainhand?.level`))),
    {timeout: 30_000, message: 'The casters must carry the follow staffs before the held-selection fights'}).toEqual(['staff@12', 'staff@15']);
}

// ---- 5. The held-selection fights: H46, H48, H49 with H47 ----

// All roles begin at the same admitted native-clear position (live-hunt-sparkbot-follow.spec.ts).
const leaderPoint={x:-344.13,y:-437.24};
const rangeStart: Point = {map: 'uhills', ...leaderPoint};
const positions = {[W]: rangeStart, [P]: rangeStart, [M]: rangeStart};
type Scene = {id: 'H46' | 'H48' | 'H49'; monster: string; wallRange: boolean; queue?: boolean};
const scenes: Scene[] = [{id: 'H46', monster: 'sparkbot', wallRange: false}, {id: 'H48', monster: 'goo', wallRange: true}, {id: 'H49', monster: 'goo', wallRange: false, queue: true}];

// One fight of live-hunt-sparkbot-follow.spec.ts from the shared start: the party gathers there,
// adopts group and focus, holds, selects the planted monster, and is released. H49's first attack
// carries H47's barrier checks: H47's parked Goo and H49's roaming one share the goo block.
// The barrier an attack crossed. The client records the group view it attacked from
// (e2e/live-game-client.ts `independent`), and the view carries the confirmation only while the
// target is planned (coordinator/targeting/queue.ts `confirmation`). A member whose reply already
// moved the target on attacks with no confirmation in its view (targeting/gates.ts
// `independentPullReady` passes a target that is no longer planned), and the coordinator moves it on
// only once every member confirmed. In W21 rerun 5 the warrior attacked so in the same ms as the
// priest, whose view held the confirmation. So the read takes the first attack that carries it, and
// no attack may come before that one.
function firstConfirmed(attacks: any[]) {
  const sorted = [...attacks].sort((a, b) => a.at - b.at), confirmed = sorted.find(e => e.motion?.independent?.confirmation);
  expect(sorted.filter(e => !confirmed || e.at < confirmed.at), 'No attack may come before the first one sent under the confirmation').toEqual([]);
  return confirmed;
}
// Each fighter's party calls with the call budget's answer, and the invites and requests the game
// sent it (tasks/character/membership.ts `reconcile`). In final-gate-closing8's pair run the game
// party broke up at the last unfollow before H46 (1795583770485) and no fighter sent a party call
// for 79 s, so H46, H48 and H49 waited on `party` false; the dump held no read of why.
async function partyProbe(live: LiveGame) {
  for (const name of fighters) {
    const fresh = await live.clients[name].run(`(()=>{const g=globalThis;if(g.__e2ePartyProbe)return false;const log=g.__e2ePartyProbe=[];
      const calls=g.__partyHooks.calls,band=calls.band,wrapped=calls.band=function(q){const a=band.apply(this,arguments);
        if(q&&q.method==='party')log.push({at:Date.now(),event:q.data?.event,name:q.data?.name??null,answer:a,list:(parent.party_list||[]).slice()});return a;};
      const s=parent.socket,on={invite:d=>log.push({at:Date.now(),got:'invite',name:d?.name??null}),request:d=>log.push({at:Date.now(),got:'request',name:d?.name??null})};
      for(const [e,h] of Object.entries(on))s.on(e,h);
      parent.__e2ePartyProbeUndo=()=>{for(const [e,h] of Object.entries(on))s.off(e,h);if(calls.band===wrapped)calls.band=band;delete g.__e2ePartyProbe;delete parent.__e2ePartyProbeUndo;};
      return true;})()`);
    if (fresh) live.undo(`the party probe on ${name}`, () => live.clients[name].run('parent.__e2ePartyProbeUndo?.()'));
  }
}
async function rangeFight({live, info}: LiveWorld, scene: Scene) {
  const monster=scene.monster,targetPosition=scene.wallRange?[-167,-596]:[-597,-184],queue='queue' in scene&&scene.queue;
  const goo=queue?['H47','H49']:[scene.id];
  await partyProbe(live);
  await step(scene.id, async () => {
    for (const name of fighters) await place(live, name, rangeStart);
  });
  const samples:any[]=[],configured:any[]=[],events:Record<string,any[]>={},from=Date.now();let seed:any,releasedAt:number|undefined;
  await live.admin(`output=(globalThis.__e2eFollowOwnedMonsters=[],true)`);
  try{
    await observeMoves(live);
    await live.post('/formation',{leader:W});for(const name of [P,M])await live.post('/formation',{character:name,follow:true});
    await live.post('/focus',{monsterFocus:[monster],monsterPriorities:{[monster]:999},monsterSearchRadius:600});
    await live.post('/farming-mode',{character:W,mode:'default'});
    await step(scene.id, async () => {
      // A follower that turns its follow back on leaves the game party and walks back to its leader
      // (tasks/coordinator/groups.ts `joinFarmingMembership`, a `return-leader` command), and the
      // console's setup hold stops the re-invite and the walk where they stand. A player waits for the
      // party to form before the fight, so the hold waits for every fighter in the warrior's party with
      // its nomination free (livea-run4 H49: the priest left the party as the hold began and stayed out
      // for the whole held selection, its nomination "blocked: travel intent").
      await expect.poll(async()=>{
       const roles=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{const s=globalThis.sharedRoutine,g=globalThis.__partyGroupedCombat,focus=globalThis.partyHunting?.farm.focus().slice(),nomination=globalThis.__partyNomination?.focus;return {name:character.name,grouped:!!globalThis.partyHunting?.farm.grouped(),leader:s?.targeting.isLeader()===${name===W},groupLeader:g?.leader===${JSON.stringify(W)},members:${JSON.stringify(fighters)}.every(n=>g?.members?.includes(n)),independent:g?.independentApproach===true,focus,nomination,focusReady:!!focus?.includes(${JSON.stringify(monster)}),nominationReady:!nomination||nomination.includes(${JSON.stringify(monster)}),party:character.party===${JSON.stringify(W)},blocked:globalThis.__partyNomination?.blocked};})()`)));
       configured.push({at:Date.now(),roles});if(configured.length>32)configured.splice(4,1);
       return roles.every(r=>r.grouped&&r.leader&&r.groupLeader&&r.members&&r.independent&&r.focusReady&&r.nominationReady&&r.party&&!r.blocked);
      },{timeout:15000,message:'Actual CODE must adopt both configured group and focus before the declared setup hold'}).toBe(true);
      live.consoleDrainLease('native-range-setup');
      await expect.poll(async()=>{const state=await live.state();return fighters.every(name=>state.characters[name]?.consoleMaintenance?.id==='native-range-setup'&&state.characters[name].consoleMaintenance.ready);},{timeout:15000}).toBe(true);
      seed=await live.admin(`output=(()=>{
       const original=G.monsters[${JSON.stringify(monster)}];globalThis.__e2eFollowOriginal=original;G.monsters[${JSON.stringify(monster)}]={...original,stationary:true};
       const m=new_monster('uhills',{__e2eAmbientExempt:true,type:${JSON.stringify(monster)},count:1,position:${JSON.stringify(targetPosition)},radius:0},{temp:1});
       __e2eFollowOwnedMonsters.push({id:String(m.id),type:m.type,map:m.map,instance:m.in});
       if(!${!!queue}){m.speed=0;m.moving=false;}
       const observableCombatSeconds=20,partyDps=${JSON.stringify(fighters)}.map(get_player).reduce((sum,p)=>sum+Math.max(1,p.attack)*Math.max(0.1,p.frequency),0);
       m.target=null;m.hp=m.max_hp=${!!queue}?Math.ceil(partyDps*observableCombatSeconds):10000000;m.u=true;m.abs=true;m.cid++;
       const successors=[];
       if(!can_move({...m,going_x:m.x,going_y:m.y}))throw Error('Actual primary spawn is not native-clear');
       return {id:String(m.id),x:m.x,y:m.y,map:m.map,speed:m.speed,aggro:original.aggro,hp:m.hp,partyDps,observableCombatSeconds,at:Date.now(),successors};})()`);
      await expect.poll(async()=>Promise.all(fighters.map(name=>live.clients[name].run(`!!parent.entities[${JSON.stringify(seed.id)}]`))),{timeout:15000}).toEqual([true,true,true]);
      const staging=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{
       const c=character,e=parent.entities[${JSON.stringify(seed.id)}],body=v=>({map:v.map,in:v.in,x:v.real_x??v.x,y:v.real_y??v.y,awidth:v.awidth??(v.width||0)/(v.mscale||1),aheight:v.aheight??(v.height||0)/(v.mscale||1)});
       const self=body(c),enemy=body(e),goal={...self,...${JSON.stringify(leaderPoint)}};
       return {name:c.name,range:c.range,position:self,enemy,gap:distance(goal,enemy),safety:Math.min(e.range,Math.max(6,c.range-24))+8,goalClear:can_move({map:c.map,x:goal.x,y:goal.y,going_x:goal.x,going_y:goal.y,base:c.base})};})()`)));
      await info.attach('native-sparkbot-follow-staging',{body:JSON.stringify({starts:positions,seed,staging}),contentType:'application/json'});
      expect(staging.every(v=>v.goalClear)).toBe(true);
      if(scene.wallRange){
       const geometry=await Promise.all([P,M].map(name=>live.clients[name].run(`(()=>{const e=parent.entities[${JSON.stringify(seed.id)}];return {name:character.name,range:character.range,inRange:is_in_range(e),sight:can_move_to(e.x,e.y),position:{x:character.real_x,y:character.real_y}};})()`)));
       await info.attach('native-independent-wall-range-precondition',{body:JSON.stringify(geometry),contentType:'application/json'});
       expect(geometry.every(v=>v.inRange&&!v.sight),'Actual casters must be in native attack range while terrain blocks movement to the monster').toBe(true);
      }
      const heldSelection=async()=>{
       const roles=await Promise.all(fighters.map(name=>live.clients[name].run(`(()=>{const g=globalThis.__partyGroupedCombat,n=globalThis.__partyNomination,e=parent.entities[${JSON.stringify(seed.id)}],h=globalThis.__partyConsoleMaintenance;return {name:character.name,selected:g?.target?.id===${JSON.stringify(seed.id)}&&!!g?.selection,group:{selection:g?.selection,target:g?.target,committed:g?.committed,independent:g?.independentApproach,reason:g?.reason,members:g?.members},nomination:n&&{focus:n.focus,blocked:n.blocked,eligible:n.eligible,rejected:n.rejected,revision:n.revision},entity:e&&{id:e.id,map:e.map,in:e.in,x:e.real_x??e.x,y:e.real_y??e.y,hp:e.hp,visible:e.visible,dead:e.dead,moving:e.moving,speed:e.speed,going_x:e.going_x,going_y:e.going_y,inRange:is_in_range(e),target:e.target},hold:h&&{id:h.id,mode:h.mode,phase:h.phase},socket:parent.socket?.connected};})()`)));
       configured.push({at:Date.now(),phase:'held-selection',roles});if(configured.length>32)configured.splice(4,1);
       return roles;
      };
      await expect.poll(async()=>(await heldSelection()).map(r=>r.selected),{timeout:15000,message:'All clients must select the declared target before movement setup'}).toEqual([true,true,true]);
      if(queue){
       expect(seed.aggro||0).toBe(0);expect(seed.speed).toBeGreaterThan(0);
       // Declare the encounter's first leg only after setup is acknowledged. Native
       // movement, packets, interception and subsequent random roaming remain real.
       seed.movement=await live.admin(`output=(()=>{
        const m=instances.uhills.monsters[${JSON.stringify(seed.id)}];
        if(!m||m.dead||m.target||!m.temp)throw Error('Declared held Goo is no longer available');
        const players=${JSON.stringify(fighters)}.map(get_player),candidates=[];
        for(const length of [120,100,80])for(let i=0;i<32;i++){
         const x=m.x+Math.cos(i*Math.PI/16)*length,y=m.y+Math.sin(i*Math.PI/16)*length;
         if(can_move({...m,going_x:x,going_y:y})&&players.every(p=>distance(p,{...m,x,y})>p.range+30))candidates.push({x,y,length});
        }
        const destination=candidates[0];if(!destination)throw Error('No native-clear out-of-range Goo movement leg');
        G.monsters.goo=__e2eFollowOriginal;m.map_def.radius=40;
        m.going_x=destination.x;m.going_y=destination.y;start_moving_element(m);
        return {at:Date.now(),from:{x:m.x,y:m.y},destination,speed:m.speed,duration:destination.length/m.speed};
       })()`);
       await expect.poll(async()=>(await heldSelection()).map(r=>r.selected&&r.entity?.moving&&r.entity.inRange===false&&r.entity.speed>0&&
        Math.hypot(r.entity.going_x-r.entity.x,r.entity.going_y-r.entity.y)/r.entity.speed>=4),
       {timeout:15000,message:'Held selection must include a real moving native leg before testing predictive interception'}).toEqual([true,true,true]);
      }
      releasedAt=Date.now();live.consoleDrainLease(null);
      await expect.poll(async()=>{const state=await live.state();return fighters.every(name=>!state.characters[name]?.consoleMaintenance);},{timeout:15000,message:'The actual ordered host lease release must reach all fighters'}).toBe(true);
      await expect.poll(async()=>{
       const state=await live.state();samples.push({at:Date.now(),roles:fighters.map(name=>({name,x:state.characters[name]?.x,y:state.characters[name]?.y,position:state.characters[name]?.combat?.positioning,recovery:state.characters[name]?.groupedCombat?.formationRecovery}))});
       for(const name of fighters)events[name]=await since(live,name,from);
       return fighters.every(name=>events[name].some(e=>nativeHit(e,name,seed.id)));
      },{timeout:90000,message:'All three native roles must recover and damage the declared Sparkbot'}).toBe(true);
    });
    if(!seed||!releasedAt)return;
    // The move and position reads start at this fight's gathering, as the old test's fresh fixture
    // started its whole ring.
    for(const name of fighters)events[name]=await since(live,name,from);
    let firstAttack:any;
    if(monster==='goo')await step(goo, async () => {
     firstAttack=firstConfirmed(fighters.flatMap(name=>events[name].filter(e=>e.event==='attack-issued'&&e.data?.id===seed.id || e.event==='offensive-skill-issued'&&(e.data?.ids?.includes(seed.id)||!e.data?.ids?.length&&e.motion?.independent?.target===seed.id))));
     expect(firstAttack,'Actual outgoing native attack or hostile skill evidence must exist').toBeTruthy();
     const barrier=firstAttack.motion?.independent;
     expect(barrier?.committed).toBe(true);expect(barrier?.target).toBe(seed.id);
     expect(barrier.confirmation?.selection).toBe(barrier.selection);expect(barrier.confirmation?.target).toBe(seed.id);
     expect(firstAttack.motion.inRange).toBe(true);
     expect(barrier.serverAt).toBeLessThan(barrier.confirmation.expiresAt);
     for(const name of fighters){const ready=barrier?.ready?.[name];
      expect(ready?.selection).toBe(barrier.selection);expect(ready?.target).toBe(seed.id);expect(ready?.ready).toBe(true);
      expect(barrier.serverAt-ready.at).toBeGreaterThanOrEqual(-500);expect(barrier.serverAt-ready.at).toBeLessThanOrEqual(1000);
      expect(ready.confirmation).toBe(barrier.confirmation?.id);
      expect(ready.at).toBeGreaterThanOrEqual(barrier.confirmation.startedAt);}
     if(scene.wallRange)for(const name of [P,M])expect(events[name].some(e=>e.event==='move-issued'&&e.at<=firstAttack.at&&e.motion?.position?.target===seed.id&&e.motion?.position?.movementOwner==='combat-approach'),'An already range-ready caster must not acquire an approach before the first confirmed attack').toBe(false);
     await info.attach('native-independent-all-ready-before-first-attack',{body:JSON.stringify(firstAttack),contentType:'application/json'});
    });
    if(queue)await step('H49', async () => {
     seed.successors=await live.admin(`output=(()=>{const primary=instances.uhills.monsters[${JSON.stringify(seed.id)}];if(!primary||!(primary.hp>0)||primary.dead)throw Error('Declared primary is no longer alive before successor seeding');const successors=[];for(const dx of [-24,-48]){let x=primary.x+dx,y=primary.y,centerFallback=false;if(!can_move({map:primary.map,x,y,going_x:x,going_y:y,base:primary.base})){x=primary.x;y=primary.y;centerFallback=true;if(!can_move({...primary,going_x:x,going_y:y}))throw Error('Current native primary center is not clear for successor declaration');}const next=new_monster('uhills',{__e2eAmbientExempt:true,type:'goo',count:1,position:[x,y],radius:40},{temp:1});__e2eFollowOwnedMonsters.push({id:String(next.id),type:next.type,map:next.map,instance:next.in});next.hp=next.max_hp=10000000;next.u=true;next.abs=true;next.cid++;if(!can_move({...next,going_x:next.x,going_y:next.y}))throw Error('Actual roaming successor spawn is not native-clear');successors.push({id:String(next.id),x:next.x,y:next.y,center:{x,y},centerFallback});}return successors;})()`);
     const queued=seed.successors.map((m:any)=>m.id);
     // Each sample keeps the leader's nomination read (queue-client.ts `queueCandidates`: its block, the
     // eligible ids and each refusal's reason) and the successors as it sees them. In
     // final-gate-closing9's W21 run the queue held 500 and never 501 while 499 lived.
     // An issued attack or hostile skill aimed at one of the queued successors.
     const attacksQueued=(e:any)=>(e.event==='attack-issued'||e.event==='offensive-skill-issued')&&(queued.includes(e.data?.id)||e.data?.ids?.some((id:string)=>queued.includes(id))||queued.includes(e.motion?.independent?.target));
     await expect.poll(async()=>{for(const name of fighters)events[name]=await since(live,name,from);samples.push({at:Date.now(),queue:await live.clients[W].run(`(()=>{const g=globalThis.__partyGroupedCombat,e=parent.entities[${JSON.stringify(seed.id)}],n=globalThis.__partyNomination;return {target:g?.target?.id,ids:g?.queue?.map(t=>t.id),primaryAlive:!!e&&e.hp>0&&!e.dead,
       nomination:n&&{blocked:n.blocked??null,eligible:n.eligible,rejected:n.rejected},successors:${JSON.stringify(queued)}.map(id=>{const s=parent.entities[id];return s?{id,x:s.real_x??s.x,y:s.real_y??s.y,visible:s.visible,target:s.target??null}:{id,seen:false};})};})()`)});return events[W].some(e=>e.event==='death'&&String(e.data?.id)===seed.id)&&fighters.some(name=>events[name].some(attacksQueued));},{timeout:90000,message:'Real native first Goo death must advance to an initially queued successor'}).toBe(true);
     expect(samples.some(s=>s.queue?.target===seed.id&&s.queue.primaryAlive&&queued.every((id:string)=>s.queue.ids?.includes(id))),'Both actual successors must be observed queued while the first native primary is alive').toBe(true);
     const attack=firstConfirmed(fighters.flatMap(name=>events[name]).filter(attacksQueued)),barrier=attack.motion?.independent;
     expect(attack.motion.inRange).toBe(true);expect(barrier?.committed).toBe(true);expect(queued).toContain(barrier?.target);
     expect(attack.motion.attackTarget?.id).toBe(barrier.target);
     expect(barrier.confirmation?.target).toBe(barrier.target);expect(barrier.serverAt).toBeLessThan(barrier.confirmation.expiresAt);
     for(const name of fighters){const ready=barrier.ready[name];expect(ready.confirmation).toBe(barrier.confirmation.id);expect(ready.selection).toBe(barrier.selection);expect(ready.target).toBe(barrier.target);expect(ready.ready).toBe(true);expect(ready.at).toBeGreaterThanOrEqual(barrier.confirmation.startedAt);expect(barrier.serverAt-ready.at).toBeLessThanOrEqual(1000);}
     await info.attach('native-queued-successor-confirmation',{body:JSON.stringify({seed,attack}),contentType:'application/json'});
     const firstMoves=new Map<string,any>();
     for(const name of fighters)for(const event of events[name].filter(e=>e.event==='move-issued')){const r=event.motion?.independentRoute;
      if(r?.id&&!firstMoves.has(name+':'+r.id))firstMoves.set(name+':'+r.id,{name,event});}
     const candidates=[...firstMoves.values()].filter(({event})=>{const r=event.motion?.independentRoute,t=r?.nativeTarget,input=r?.prediction;
      return r?.direct===true&&r.id===event.motion?.position?.approachId&&r.target===t?.id&&t.moving&&t.inRange===false&&Math.hypot(t.going_x-t.x,t.going_y-t.y)>0.000001&&input?.targetSpeed>0&&
        Math.hypot(input.destination.x-t.going_x,input.destination.y-t.going_y)<0.01&&Math.abs(input.targetSpeed-t.speed)<0.01;
     }).sort((a,b)=>a.event.at-b.event.at);
     const first=candidates[0];
     await info.attach('native-moving-target-issued-intercept',{body:JSON.stringify({candidates:candidates.slice(0,12),first}),contentType:'application/json'});
     expect(first,'A coherent first actual direct move must observe a genuinely moving native target outside attack range').toBeTruthy();
     const route=first.event.motion.independentRoute,input=route.prediction,point=route.point,native=route.nativeTarget;
     const dx=input.destination.x-input.target.x,dy=input.destination.y-input.target.y,leg=Math.hypot(dx,dy),px=point.x-input.target.x,py=point.y-input.target.y;
     expect(input.ownSpeed).toBeGreaterThan(0);expect(input.horizon).toBeGreaterThan(0);expect(input.horizon,'The prediction ends with the target leg').toBeLessThanOrEqual(leg/input.targetSpeed+0.000001);
     expect((px*dx+py*dy)/leg,'The actually issued center must lead along its immutable native motion input').toBeGreaterThan(0.000001);
     expect(Math.abs(px*dy-py*dx)/leg).toBeLessThanOrEqual(0.000001);
     expect(Math.hypot(px,py)).toBeLessThanOrEqual(leg+0.000001);
     expect(Math.abs(Math.hypot(px,py)-input.targetSpeed*input.horizon)).toBeLessThanOrEqual(0.000001);
     // The prediction's time is the CODE frame's clock, so the issue time it is held against is too
     // (live-game-client.ts `codeAt`).
     expect(first.event.codeAt-input.at,'Issued inputs and actual native packet share the native clock').toBeGreaterThanOrEqual(0);
     expect(((point.x-native.x)*dx+(point.y-native.y)*dy)/leg,'The issued center must still lead the actual moving monster at its first packet').toBeGreaterThan(0);
    });
    await step(scene.id, async () => {
     for(const name of scene.wallRange?[]:[P,M]){
      const firstHit=events[name].find(e=>nativeHit(e,name,seed.id));
      const ownedMove=events[name].find(e=>e.event==='move-issued'&&e.at<=firstHit.at&&e.motion?.position?.target===seed.id&&
       approachOwned(e.motion.position)&&Math.hypot(e.data.going_x-e.data.x,e.data.going_y-e.data.y)>1);
      expect(ownedMove,'Caster must independently move under the matching owned approach before its first native damage').toBeTruthy();
      expect(events[name].some(e=>e.event==='player'&&e.data?.id===name&&e.sequence>ownedMove.sequence&&e.at<=firstHit.at&&
       Math.hypot(e.data.x-ownedMove.data.x,e.data.y-ownedMove.data.y)>1),'Actual socket displacement must follow the owned recovery move').toBe(true);
     }
     for(const name of scene.wallRange?[]:[P,M])expect(events[name].some(e=>e.event==='player'&&e.data?.id===name&&e.data.map==='uhills'&&Math.hypot(e.data.x-positions[name as typeof P|typeof M].x,e.data.y-positions[name as typeof P|typeof M].y)>20)).toBe(true);
     for(const name of fighters){const moves=events[name].filter(e=>e.event==='move-issued');if(!scene.wallRange)expect(moves.length).toBeGreaterThan(0);expect(moves.every(e=>e.motion?.clear===true)).toBe(true);expect(events[name].some(e=>e.event==='new_map'&&e.data?.name==='jail')).toBe(false);}
    });
  }finally{
    reads[scene.id] = {seed, releasedAt, configured: configured.slice(-2), samples: samples.length};
    live.consoleDrainLease(null);
    const party=Object.fromEntries(await Promise.all(fighters.map(async n=>[n,await live.clients[n].run('globalThis.__e2ePartyProbe??null')])));
    await info.attach(`native-${scene.id}-follow-result`,{body:JSON.stringify({seed,releasedAt,configured,samples,events,party}),contentType:'application/json'});
    await live.admin(`output=(()=>{for(const entry of globalThis.__e2eFollowOwnedMonsters||[]){const m=instances[entry.instance||entry.map]?.monsters?.[entry.id];if(m&&m.temp&&m.type===entry.type&&m.map===entry.map&&m.in===(entry.instance||entry.map))remove_monster(m,{method:'disappear'});}delete globalThis.__e2eFollowOwnedMonsters;if(globalThis.__e2eFollowOriginal){G.monsters[${JSON.stringify(monster)}]=__e2eFollowOriginal;delete globalThis.__e2eFollowOriginal;}return true;})()`);
    await clearFocus(live);
  }
}

// ---- 6. The Sparkbot farm: M19 ----

// M19 (live-farming-handoff.spec.ts) from its terrain start, with the natural uhills bots back.
async function farmHandoff({live, info}: LiveWorld) {
  const samples:unknown[]=[];
  const arrivals:Record<string,{at:number;position:unknown;farm:unknown}>={};
  let farm:any;
  await step('M19', async () => {
    try {
      await travel(live, {map: 'uhills', x: -225, y: -207});
      // The natural bots come back once the party stands outside their spawns, so none of them
      // starts a fight on the walk.
      await restoreNativeMapAmbient(live);
      await live.post('/formation',{leader:W});
      await live.post('/formation',{character:P,follow:true});
      const area=farmingAreas((await live.state(true)).monsterChoices,['sparkbot'])
        .find(candidate=>candidate.map==='uhills'&&contains(candidate,{map:'uhills',x:-544,y:-275},0,1));
      expect(area,'Native catalog must contain the requested Sparkbot farm').toBeTruthy();
      const accepted=await live.post('/navigate-to-monster',{monsterId:'sparkbot',location:area});
      farm=accepted.location;
      expect(farm).toMatchObject({map:'uhills'});
      expect(!!(farm.boundary||farm.shapes||farm.polygon||farm.allOf)).toBe(true);
      await live.post('/focus',{monsterFocus:['targetron','sparkbot'],monsterPriorities:{},monsterSearchRadius:500});
      await expect.poll(async()=>{
        const state=await live.state();
        const players=await live.admin(`output=Object.fromEntries(${JSON.stringify([W,P])}.map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,rip:!!p.rip}]}))`);
        if(farm?.map==='uhills'&&(farm.boundary||farm.shapes||farm.polygon||farm.allOf))for(const name of [W,P]){
          if(!arrivals[name]&&!players[name].rip&&contains(farm,players[name],150,500))
            arrivals[name]={at:Date.now(),position:players[name],farm};
        }
        const hits=await Promise.all([W,P].map(async name=>{
          const raw=(await live.clients[name].events()).filter((event:any)=>event.event==='hit'&&event.data?.hid===name&&event.data?.damage>0);
          return {name,rawCount:raw.length,events:raw.filter((event:any)=>arrivals[name]&&event.at>=arrivals[name].at)};
        }));
        samples.push({at:Date.now(),farm,players,convoy:state.activeConvoy&&{id:state.activeConvoy.id,phase:state.activeConvoy.phase,engagement:state.activeConvoy.farmingEngagement},hits:hits.map(({name,rawCount,events})=>({name,rawCount,count:events.length,last:events.slice(-2)}))});
        if(samples.length>64)samples.shift();
        return [W,P].every(name=>!!arrivals[name]&&!players[name].rip)&&hits.every(result=>result.events.length>0);
      },{timeout:120000,intervals:[500,1000],message:'Both native fighters must enter the UHills farm and actually attack, rather than repeatedly surrendering travel'}).toBe(true);
      await evidence(live,info,'native-uhills-farming-handoff',{farm,arrivals,samples});
    } finally {
      reads.M19 = {farm, arrivals};
      await info.attach('native-uhills-handoff-observations',{body:JSON.stringify({arrivals,samples}),contentType:'application/json'});
    }
  });
}

// ---- 7. The empty Hawk spawn: H7 ----

// H7 (live-hunt-empty-spawn.spec.ts). The saved spot is the old test's Main Hawk spawn and the
// party stands at that test's Main points outside it. A leader on another map than the saved spot
// starts its own farm reunion (runtime/tasks/character/assignment.ts `farmReunionTick`), which
// owns that return in b9b5c91e too, so the empty spawn return is played on the spot's map
// (DEVIATIONS.md "W21 H7 on Main"). The saved spot goes in before the Hawk focus: M19's spot names the Sparkbot farm, and a focus that
// replaces its species would queue a move to a Hawk area (farm.ts focusChanged), which the custom
// spot does not own.
async function emptySpawn({live, info}: LiveWorld) {
  const farm={map:'main',x:1280,y:300,boundary:[1100,200,1450,340]},samples:any[]=[];
  let seed:any,events:Record<string,any[]>={};
  await step('H7', async () => {
   try {
    // The natural bots M19 fought leave the map, so no fighter holds a target. A live walk holds
    // the spawn return (farm.ts returnToSpawn), so M19's walk ends first, within the old tests'
    // uhills walk bound (live-hunt-targetron-terrain.spec.ts:36).
    await isolateNativeMapAmbient(live,'uhills');
    await expect.poll(async()=>!(await live.state()).activeConvoy,{timeout:60_000,message:'The Sparkbot farm walk must end before the spawn return'}).toBe(true);
    // The hold below freezes each fighter's target, so the fight ends before it. The closing-4 rerun
    // held the party mid-fight on Targetron 473 (engaged by the mage in M19): after the transport the
    // priest walked back to uhills for its grouped target, and each fighter's target held the
    // spawn return (farm.ts returnToSpawn).
    await fightEnded(live,'No fighter holds a uhills target before the hold');
    // With no target left, a leader outside the saved spot starts its spawn return 1.5 s later
    // (farm.ts returnToSpawn), and a walk persists across the spot write's restart. In
    // final-gate-closing10 W21 run 1 the Sparkbot fight ended at (-425,-226), 9 px east of the spot's
    // boundary, its return to uhills started under the hold, and the restart brought it back after
    // the release. So the hold waits for no walk with the warrior inside the saved spot, where no
    // return is due.
    await expect.poll(async()=>{const s=await live.state(),c=s.characters[W],spot=s.farmingProfiles?.[W]?.location;
      return !s.activeConvoy&&!!c&&!!spot&&contains(spot,{map:c.map,x:c.x,y:c.y});},
    {timeout:60_000,message:'No spawn return is due before the hold'}).toBe(true);
    live.consoleDrainLease('empty-spawn-setup');
    await expect.poll(async()=>{const s=await live.state();return fighters.every(n=>s.characters[n]?.consoleMaintenance?.ready);}).toBe(true);
    // The followers join before the saved spot. In livea-w03-w21-w23-run2 the mage, 154 from the
    // warrior and not yet following, read the new Main spot and led its own farm reunion walk
    // (movement/character/crossings.ts `sharedPartyWalk` "farm-recovery"), which held the one party
    // walk for the whole 15 s, so the warrior's spawn return never started. In livea-run4 the
    // followers asked for that walk after the spot write's coordinator restart, before the warrior's
    // first report; the walk's start now waits for that report (movement/coordinator/walk.ts
    // `startingLeader`).
    await live.post('/formation',{leader:W});
    for(const name of [P,M])await live.post('/formation',{character:name,follow:true});
    // A saved user waypoint is input. Starting an artificial recovery convoy or
    // calling /farming-return here would bypass the behavior being tested.
    await live.restoreHistoricalSettings(settings=>({farmingProfiles:{...settings.farmingProfiles,
     [W]:{...settings.farmingProfiles[W],location:farm}},location:farm}));
    await live.post('/focus',{monsterFocus:['bigbird'],monsterSearchRadius:600});
    await live.post('/farming-mode',{character:W,mode:'default'});
    // The old test's declared Main points (live-hunt-empty-spawn.spec.ts at 21fe30a2b), put while
    // the console is held, with Main's ambient held in place of Upper Hills'.
    await restoreNativeMapAmbient(live);
    await isolateNativeMapAmbient(live,'main');
    const mainPoints:Record<string,[number,number]>={[W]:[1127,-352],[P]:[1364,-342],[M]:[1383,-304]};
    await live.admin(`output=(()=>{for(const [n,[x,y]] of Object.entries(${JSON.stringify(mainPoints)}))transport_player_to(get_player(n),'main',[x,y]);return true;})()`);
    await expect.poll(async()=>{const s=await live.state();return fighters.every(n=>s.characters[n]?.map==='main');},{message:'the fighters stand on Main'}).toBe(true);
    await observeMoves(live);
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
    reads.H7 = {farm, seed, samples: samples.slice(-4)};
    await info.attach('native-empty-spawn-observations',{body:JSON.stringify({farm,seed,samples,events}),contentType:'application/json'});
    if(seed)await live.admin(`const m=instances.main.monsters[${JSON.stringify(seed.id)}];if(m)remove_monster(m);output=true`);
    await restoreNativeMapAmbient(live,true);
   }
  });
}

async function wallFightsPlay(world: LiveWorld) {
  const {live} = world;
  await live.post('/merchant/force-stand',{enabled:true});
  live.undo('the merchant stand', () => live.post('/merchant/force-stand',{enabled:false}));
  await clearFocus(live);
  live.undo('the ambient isolation', () => restoreNativeMapAmbient(live, true));
  const ambient = await isolateNativeMapAmbient(live, 'uhills') as {retained: {id: string; type: string}[]; queued: number};
  const isolated = {removed: ambient.retained.map(m => m.id), targetrons: ambient.retained.filter(m => m.type === 'targetron').map(m => m.id), heldRespawns: ambient.queued};
  const corner = await cornerFight(world, isolated);
  await detourFight(world, corner);
  await selectedRobot(world);
  await followStaffs(live);
  for (const scene of scenes) await rangeFight(world, scene);
  await farmHandoff(world);
  await emptySpawn(world);
}

const own = (id: string, owner: string, behaviours: string[] = []) => ({
  owner, behaviours, start() {}, reads: () => ({failed: failed[id] ?? null, reads: reads[id] ?? null}),
  verdict() { expect(failed[id], `${id}: every step of the play passes`).toBeUndefined(); },
});

liveWindow({
  id: 'W21', name: 'UHills wall fights, three fighters with a mage',
  // The old tests' bounds summed: H5 240 s, H7 240 s, H46, H48 and H49 240 s each (H47 rode the
  // same file), H50 180 s, H51 180 s, H52 180 s and M19 240 s = 1,980 s. The walks between fights
  // replace the old tests' fixture boots, which those bounds held.
  timeoutMs: 1_980_000,
  use: {loadout: 'combat-range', extraFighter: 'mage', initialPositions: starts},
  play: wallFightsPlay,
  observers: [
    {id: 'H5', ...own('H5', 'movement')}, {id: 'H50', ...own('H50', 'movement')}, {id: 'H51', ...own('H51', 'movement')},
    {id: 'H52', ...own('H52', 'targeting')}, {id: 'H46', ...own('H46', 'targeting')}, {id: 'H48', ...own('H48', 'targeting')},
    {id: 'H49', ...own('H49', 'targeting')}, {id: 'H47', ...own('H47', 'targeting')},
    {id: 'M19', ...own('M19', 'hunting', ['HNT-055'])}, {id: 'H7', ...own('H7', 'hunting', ['HNT-054'])},
  ],
});
