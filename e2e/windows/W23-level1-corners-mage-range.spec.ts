import {expect} from '../live-fixtures';
import {liveWindow, type LiveWorld} from '../windows';
import {W as warrior, P, evidence} from '../hunt-interruption-helpers';
import {arrived} from '../game/hunt-lifecycle';

// W23 Level 1 corridors and Phoenix range with a mage (test-windows DESIGN.md 2.2 W23, fixture
// changed in DEVIATIONS.md). One play from H33's start at level1(0,395.76) with the warrior, the
// priest and the extra mage (E2EBankBoi):
//   H33 and H34: Level 1's monsters go and their respawns are held; the warrior leads, the priest
//   and the mage follow; a stationary 10M HP Prat stands at (-11,115) across the corridors; the
//   warrior and the priest (H33) and the mage (H34) each round the corners and hit it; the Prat
//   goes and the respawns come back.
//   H29: the party travels to main(0,0), the old test's start, with the priest leading; a Phoenix
//   with 60 s of the party's damage in HP stands at the mage's range plus 55 on a clear line; the
//   mage closes and hits it.
// The extra mage gives H33's warrior run and H34's mage run one corridor (DESIGN.md 4.2 H34), and
// it is H29's mage. H29's lines name the mage W, as its old test's primary mage was.
// Failure modes: H33 and H34, a fighter waits past the acquisition bound, an owned segment crosses
// terrain or it never turns off the blocked bearing; H29, the mage holds outside its range of a
// fast target or never lands damage.
// Each check's assertions are its old test's, with their messages, so the coverage ledger matches
// them. A failed step records its message under its check and the play goes on.
// Every old spec this window cites is at 21fe30a2b.
const M = 'E2EBankBoi';
const W = warrior;
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
const step = async (ids: string[], run: () => Promise<unknown>) => {
  try { await run(); return true; } catch (error) { for (const id of ids) failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); return false; }
};

async function cornersAndRangePlay({live, info}: LiveWorld) {
  live.undo('the merchant stand', () => live.post('/merchant/force-stand', {enabled: false}));
  // H33 and H34 (live-hunt-multi-corner.spec.ts, one run of both classes).
  let origin:any,seed:any;
  const samples:any[]=[],timings:any[]=[];
  const crews: [string, string[]][] = [['H33', [W, P]], ['H34', [M]]];
  try{
    const ready = await step(['H33', 'H34'], async () => {
      await live.post('/merchant/force-stand',{enabled:true});
      origin=await live.clients[W].run('({x:character.real_x,y:character.real_y,range:character.range,speed:character.speed,blocked:!can_move_to(-11,115)})');
      const geometry=await live.clients[W].run(`({base:character.base,own:can_move_to(character.real_x,character.real_y),steps:Array.from({length:8},(_,i)=>{const a=i*Math.PI/4,x=character.real_x+24*Math.cos(a),y=character.real_y+24*Math.sin(a);return {x,y,clear:can_move_to(x,y)};})})`);
      await info.attach('native-origin-geometry',{body:JSON.stringify(geometry),contentType:'application/json'});
      expect(origin.blocked,'The screenshot target must be across native terrain').toBe(true);
      // The held respawns come back in the step's finally.
      await live.admin(`output=(()=>{for(const m of Object.values(instances.level1.monsters))remove_monster(m,{method:'disappear',nospawn:true});globalThis.__e2eMultiCornerRespawns=[];for(let i=monster_respawns.length-1;i>=0;i--)if(monster_respawns[i][0]?.map==='level1')globalThis.__e2eMultiCornerRespawns.push(...monster_respawns.splice(i,1));return true;})()`);
      await live.post('/formation',{leader:W});
      await live.post('/formation',{character:P,follow:true});
      await live.post('/formation',{character:M,follow:true});
      await live.post('/focus',{monsterFocus:['prat'],monsterPriorities:{prat:999},monsterSearchRadius:800});
      await live.post('/farming-mode',{character:W,mode:'default'});
      await live.post('/checkpoint',{});
      await Promise.all([W,P,M].map(name=>live.clients[name].run(`(()=>{
        const old=globalThis.__e2eCombatRecoveryTiming;if(old)clearInterval(old.timer);
        // The key holds the walked segment, so each segment the fighter starts is sampled: the mage's
        // short approach steps kept the key of its first sample and left no sample with a segment
        // (livea-w03-w21-w23-run1 H34: 4 samples, none moving, routed 0).
        const state={name:character.name,origin:{x:character.real_x,y:character.real_y},targets:{},samples:[],cadence:{calls:0,maxGap:0,lastAt:undefined}};
        const observe=()=>{const at=Date.now(),previous=state.cadence.lastAt,gap=previous===undefined?0:at-previous;
          state.cadence.lastAt=at;state.cadence.calls++;state.cadence.maxGap=Math.max(state.cadence.maxGap,gap);
          const position=globalThis.partyCombatPosition,id=position?.target;if(!id)return;
          const target=state.targets[String(id)]??=( {acquiredAt:at} ),displacement=Math.hypot(character.real_x-state.origin.x,character.real_y-state.origin.y);
          if(target.firstDisplacementAt===undefined&&displacement>1)target.firstDisplacementAt=at;
          if(target.firstIntentAt===undefined&&position?.destination)target.firstIntentAt=at;
          if(target.movedAt===undefined&&displacement>8)target.movedAt=at;
          const journey=globalThis.__partyMovement?.report?.(),independent=position?.mode==='independent-approach'&&position?.movementOwner==='combat-approach'&&position?.approachId&&journey?.owner?.recoveryStage===position.approachId;
          const segment=character.moving&&Number.isFinite(character.going_x)&&Number.isFinite(character.going_y)?{x:character.going_x,y:character.going_y}:null;
          const clear=segment?can_move({map:character.map,x:character.real_x,y:character.real_y,going_x:segment.x,going_y:segment.y,base:character.base}):null;
          const status=globalThis.partyQueueClient?.formation?.approachStatus?.(),key=JSON.stringify([id,position?.mode,status,position?.intent,position?.movementOwner,position?.destination,segment]);
          if(state.samples.length<100&&(key!==state.lastKey||gap>100||displacement>1&&target.firstDisplacementAt===at||target.movedAt===at))
            state.samples.push({at,gap,target:id,independent,segment,clear,x:character.real_x,y:character.real_y,displacement,status,position:{...position,destination:position?.destination?{...position.destination}:undefined}});
          state.lastKey=key;};
        state.timer=setInterval(observe,25);globalThis.__e2eCombatRecoveryTiming=state;observe();return true;
      })()`)));
      seed=await live.admin(`output=(()=>{const original=G.monsters.prat;globalThis.__multiCornerOriginal=original;G.monsters.prat={...original,stationary:true};const m=new_monster('level1',{type:'prat',count:1,position:[-11,115],radius:0},{temp:1});m.speed=0;m.moving=false;m.hp=m.max_hp=10000000;m.abs=true;m.u=true;m.cid++;return {id:String(m.id),x:m.x,y:m.y,at:Date.now(),wire:monster_to_client(m)};})()`);
      expect(seed.wire.speed).toBe(0);expect(seed.wire.hp).toBe(10000000);expect(seed.wire.max_hp).toBe(10000000);
      await expect.poll(async()=>Promise.all([W,P,M].map(name=>live.clients[name].run(`(()=>{
        const t=parent.entities[${JSON.stringify(seed.id)}];return !!t&&t.max_hp===10000000&&!t.moving&&
          Math.hypot((t.real_x??t.x)-(${seed.x}),(t.real_y??t.y)-(${seed.y}))<1;
      })()`))),{timeout:30000,message:'Both real clients must observe the declared stationary Prat wire overrides'}).toEqual([true,true,true]);
    });
    // Each crew's hits, timing and segments: the warrior and the priest for H33, the mage for H34.
    if (ready) await Promise.all(crews.map(([id, crew]) => step([id], async () => {
      const own: any[] = [];
      await expect.poll(async()=>{
        for(const name of crew){const sample=await live.clients[name].run(`(()=>{const p=globalThis.partyCombatPosition,d=p?.destination;return {name:character.name,at:Date.now(),x:character.real_x,y:character.real_y,routeState:globalThis.partyQueueClient?.formation?.approachStatus?.(),positioning:p,clear:d?can_move({map:character.map,x:character.real_x,y:character.real_y,going_x:d.x,going_y:d.y,base:character.base}):null};})()`);own.push(sample);samples.push(sample);}
        return Promise.all(crew.map(async name=>(await live.clients[name].events()).some((e:any)=>e.event==='hit'&&String(e.data?.id)===seed.id&&e.data?.hid===name&&e.data?.damage>1)));
      },{timeout:45000,intervals:[100,250],message:'Both native fighters must round the corridor and attack'}).toEqual(crew.map(()=>true));
      const crewTimings: any[] = [];
      for(const name of crew){
        const timing=await live.clients[name].run(`(()=>{const s=globalThis.__e2eCombatRecoveryTiming;return {name:s.name,origin:s.origin,targets:s.targets,cadence:s.cadence,samples:s.samples};})()`);
        timings.push(timing);crewTimings.push(timing);
        const observed=timing.targets[seed.id];
        const mine=own.filter(s=>s.name===name),first=mine.find(s=>Math.hypot(s.x-origin.x,s.y-origin.y)>8);
        const acquired=mine.find(s=>s.positioning?.target===seed.id);
        expect(first,'Each fighter must start moving around the blockage').toBeTruthy();
        expect(acquired,'Each fighter must acquire the encounter').toBeTruthy();
        expect(observed?.movedAt,'The native client must observe displacement for this target').toBeTruthy();
        expect(observed.movedAt-observed.acquiredAt,'Combat recovery must begin promptly after target acquisition').toBeLessThan(3500);
        expect(observed.movedAt-seed.at,'Target acquisition and recovery must stay bounded').toBeLessThan(6000);
      }
      const routed=crewTimings.flatMap(t=>t.samples).filter(s=>s.target===seed.id&&s.segment&&(s.independent===true||s.position?.movementOwner==='combat'));
      reads[id] = {crew, routed: routed.length, moved: crewTimings.map(t => ({name: t.name, target: t.targets[seed.id] ?? null}))};
      expect(routed.length).toBeGreaterThan(0);
      expect(routed.every(s=>s.clear===true),'Every observed owned native combat segment must clear terrain').toBe(true);
      expect(own.some(s=>Math.abs(s.x-origin.x)>60),'Combat recovery must turn away from the blocked direct bearing').toBe(true);
      for(const name of crew)expect(await live.clients[name].run('character.rip')).toBeFalsy();
    })));
  }finally{
    const retained=await Promise.allSettled([W,P,M].map(name=>live.clients[name].run(`(()=>{const s=globalThis.__e2eCombatRecoveryTiming;if(!s)return null;clearInterval(s.timer);delete globalThis.__e2eCombatRecoveryTiming;return {name:s.name,origin:s.origin,targets:s.targets,cadence:s.cadence,samples:s.samples};})()`)));
    await info.attach('native-combat-recovery-timing',{body:JSON.stringify({timings,retained}),contentType:'application/json'});
    await evidence(live,info,'multi-corner-native-combat',{crews,origin,seed,samples});
    await info.attach('level1-combat-view',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
    await live.admin(`output=(()=>{const m=instances.level1.monsters[${JSON.stringify(seed?.id)}];if(m)remove_monster(m,{silent:true});if(globalThis.__multiCornerOriginal)G.monsters.prat=globalThis.__multiCornerOriginal;delete globalThis.__multiCornerOriginal;
      monster_respawns.push(...(globalThis.__e2eMultiCornerRespawns||[]));delete globalThis.__e2eMultiCornerRespawns;return true;})()`);
  }

  // H29 (live-hunt-mage-range.spec.ts) at its old start, main(0,0), with the priest leading.
  await step(['H29'], async () => {
  const spot = {map: 'main', x: 0, y: 0};
  await live.post('/travel', spot);
  // arrived's bound (game/hunt-lifecycle.ts, 120 s) is the shared travel's. The Phoenix is planted
  // from the mage's place, so the mage arrives too: final-gate-closing10 planted it while the mage
  // still channelled its Town warp, and no point at the mage's range from there was walkable.
  // arrived reads the three account characters only (hunt-lifecycle.ts `observed`), so the mage's
  // arrival is the server's own read with arrived's distance and bound.
  await arrived(live, [warrior, P], spot);
  await expect.poll(()=>live.admin(`output=(()=>{const p=get_player(${JSON.stringify(M)});
    return !!p&&p.map==='main'&&!p.moving&&!(p.c&&p.c.town)&&Math.hypot(p.x,p.y)<35;})()`),
    {timeout:120_000,message:'Real server must observe the mage arriving'}).toBe(true);
  const W = M;
  expect(await live.clients[W].run('character.ctype')).toBe('mage');
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:P});
  await live.post('/formation',{character:W,follow:true});
  await live.post('/formation',{character:warrior,follow:true});
  await expect.poll(async()=> !!(await live.state(true)).monsterChoices?.some((entry:any)=>entry.id==='phoenix'),
    {timeout:30_000,message:'The native monster catalog must authorize Phoenix before configuring its rule'}).toBe(true);
  // The old HP bound, 60 s of the fighters' damage (live-hunt-mage-range.spec.ts:21), counts the
  // warrior too, so the Phoenix lasts as long as it did for the mage and the priest alone.
  const seed=await live.admin(`output=(()=>{
    const p=get_player(${JSON.stringify(W)}),priest=get_player(${JSON.stringify(P)}),fighter=get_player(${JSON.stringify(warrior)});
    const distance=p.range+55;
    for(let i=0;i<32;i++){
      const a=i*Math.PI/16,x=p.x+distance*Math.cos(a),y=p.y+distance*Math.sin(a);
      if(!can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))continue;
      const m=new_monster(p.in,{type:'phoenix',position:[x,y],radius:0,count:1},{temp:1});
      m.hp=m.max_hp=Math.ceil((p.attack*p.frequency+priest.attack*priest.frequency+fighter.attack*fighter.frequency)*60);
      m.e2eHunt=true;
      return {id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,speed:m.speed,range:m.range,
        mage:{name:p.name,type:p.type,x:p.x,y:p.y,range:p.range},initialDistance:Math.hypot(m.x-p.x,m.y-p.y)};
    }
    throw Error('No collision-safe Phoenix outside mage range');
  })()`);
  const timeline:unknown[]=[];
  try{
  expect(seed.initialDistance).toBeGreaterThan(seed.mage.range);
  expect(seed.mage.range,'Use normal native mage range, not a +100 weapon range bonus').toBeLessThan(220);
  await info.attach('native-mage-phoenix-initial-seed',{body:JSON.stringify(seed),contentType:'application/json'});
    await live.post('/focus',{monsterFocus:['phoenix'],monsterPriorities:{phoenix:999},monsterSearchRadius:500});
    await live.post('/rare-hunting',{rules:{phoenix:{enabled:true,keepMoving:false,priority:999}},useFieldGenerators:false});
    await expect.poll(async()=>{
      timeline.push(await live.clients[W].run(`(()=>{const t=parent.entities[${JSON.stringify(seed.id)}];return {at:Date.now(),target:character.target,x:character.real_x,y:character.real_y,range:character.range,distance:t?distance(character,t):null,position:globalThis.partyCombatPosition||null}})()`));
      return (await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&String(event.data?.id)===seed.id&&event.data?.hid===W&&event.data?.damage>0).length;
    },{timeout:60000,intervals:[250,500],message:'The real mage must reengage and produce native Phoenix damage'}).toBeGreaterThan(0);
    reads.H29 = {seed, samples: timeline.length};
    await evidence(live,info,'native-mage-phoenix-range-recovered',{seed,timeline,hits:(await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&String(event.data?.id)===seed.id&&event.data?.hid===W)});
    await info.attach('native-mage-phoenix-range-client',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
  }finally{
    await info.attach('native-mage-phoenix-position-timeline',{body:JSON.stringify(timeline),contentType:'application/json'});
    // The old test left a Phoenix the party did not kill on the map.
    await live.admin(`output=(()=>{for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(m.e2eHunt&&String(m.id)===${JSON.stringify(seed.id)})remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
  }
  });
}

const own = (id: string, owner: string, behaviours: string[]) => ({
  owner, behaviours, start() {}, reads: () => ({failed: failed[id] ?? null, reads: reads[id] ?? null}),
  verdict() { expect(failed[id], `${id}: every step of the play passes`).toBeUndefined(); },
});

liveWindow({
  id: 'W23', name: 'Level 1 corridors and Phoenix range with a mage',
  // The old tests' bounds: H33 and H34 180 s for their one corridor and H29 180 s, plus arrived's
  // 120 s for the party travel H29's old test started at by fixture.
  timeoutMs: 480_000,
  // The fighters start in the Level 1 corridor. The merchant keeps its seeded start: from level1 it
  // walks out to Main before the window begins, which the reset proof reads as a dirty start
  // (step6-run1: E2EMerchant on main 1937,-12).
  use: {loadout: 'combat-range', extraFighter: 'mage', initialPositions: Object.fromEntries(['E2EWarrior', 'E2EPriest', 'E2EBankBoi'].map(n => [n, {map: 'level1', x: 0, y: 395.76}]))},
  play: cornersAndRangePlay,
  observers: [
    {id: 'H33', ...own('H33', 'movement', [])},
    {id: 'H34', ...own('H34', 'movement', [])},
    {id: 'H29', ...own('H29', 'targeting', ['HNT-072'])},
  ],
});
