import {expect, type LiveGame} from '../live-fixtures';
import type {TestInfo} from '@playwright/test';
import {liveWindow, type LiveWorld} from '../windows';
import {groupOf, taskTrail, taskSeq} from '../task-records';
import {prepareHunt, start, cycle} from '../game/hunt-lifecycle';
import {world, spawnRare, cleanupEvents} from '../game/hunt-events';
import {W, P, M, quantity, killedByParty} from '../hunt-interruption-helpers';

// W13 Goo Hunt interrupted by rares (test-windows DESIGN.md 2.2 W13 and Q4 (a)). One play:
// the party Hunts goo on a 500-kill quest and, once it farms, meets a phoenix, a golden bat, a cute
// bee, a hen, a rooster and a tinyp in turn. Each rare's rule is enabled at priority 999 and the
// rare is planted beside the warrior; the party kills it, loots its gem and goes back to the same
// goo Hunt. Before the phoenix the priest unfollows and refollows, so its reset epoch is newer
// than the group's (T24). Before the tinyp the warrior carries a field generator and deploys it
// (T29). Last, the golden bat's rule is disabled, three malformed rare settings are refused, and a
// golden bat planted beside the farm is left alive while the quest drops (H13).
// Failure modes: T24-T29, the rare is not hit or killed, an event reason holds the party, the
// gem is not looted, no xp, the Hunt does not resume the same cycle or a rare task resumes; T24,
// the rejoining follower's epoch is refused; T29, the field generator is not consumed or deployed;
// H13, a malformed setting changes passiveHunting, or the party leaves the Hunt for a disabled rare.
// Each check's assertions are its old row's, with their messages, so the coverage ledger matches
// them. A failed step records its message under its check and the play goes on.
// Every old spec this window cites is at 21fe30a2b.
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
const step = async (id: string, run: () => Promise<unknown>) => {
  try { await run(); } catch (error) { failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); }
};
const rares = [['T24', 'phoenix'], ['T25', 'goldenbat'], ['T26', 'cutebee'], ['T27', 'hen'], ['T28', 'rooster'], ['T29', 'tinyp']] as const;

// T24's half before its rare (hunt-rows.ts interruptionRows): a follower's own reset can be newer
// than its destination group's, and stale queues stay refused without stalling it.
async function followReset(live: LiveGame, info: TestInfo, cycleId: string) {
  const previous=(await live.state()).farmingProfiles[W].groupedCombatResetAt;
  await live.post('/formation',{character:P,follow:false});
  await expect.poll(async()=>(await live.state()).characters[P]?.groupedCombat?.epoch,{timeout:20_000}).toBeGreaterThan(previous);
  await live.post('/formation',{character:P,follow:true});
  await expect.poll(async()=>{
    const state=await live.state(),epoch=state.farmingProfiles[W].groupedCombatResetAt;
    // Scatter publishes no group snapshot. The leader receives the new group epoch when rare
    // combat restores grouped mode below.
    return epoch>previous&&state.characters[P]?.groupedCombat?.epoch===epoch&&
      state.characters[W]?.groupedCombat?.epoch<=epoch;
  },{timeout:20_000,message:'The destination group must admit the rejoining native follower reset epoch'}).toBe(true);
  const state=await live.state();
  expect(state.monsterHunt.cycleId).toBe(cycleId);
  await info.attach('phoenix-native-follow-reset-boundary',{body:JSON.stringify({previous,groupEpoch:state.farmingProfiles[W].groupedCombatResetAt,members:[W,P].map(name=>({name,epoch:state.characters[name].groupedCombat.epoch}))}),contentType:'application/json'});
}

// One rare's interruption, as the old row read it (hunt-rows.ts interruptionRows).
async function interruption(live: LiveGame, info: TestInfo, type: string, cycleId: string) {
  if(type==='tinyp') {
    await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});add_item(p,{name:'fieldgen0'});resend(p,'reopen');return p.items.filter(i=>i?.name==='fieldgen0')})()`);
    await expect.poll(async()=>quantity((await live.state()).characters[W].items.map((entry:any)=>entry?.item),'fieldgen0')).toBe(1);
  }
  await live.post('/rare-hunting',{rules:{[type]:{enabled:true,keepMoving:false,priority:999}},useFieldGenerators:type==='tinyp'});
  // The ring position before this rare, so the resume reads only this rare's interruption.
  const seq=await taskSeq(live,`party:${W}`);
  const before=await world(live),spawnedAt=Date.now(),spawn=await spawnRare(live,type);
  reads[type]={spawn};
  await info.attach('native-rare-initial-encounter',{body:JSON.stringify(spawn),contentType:'application/json'});
  if(type==='tinyp') {
    const fields=()=>live.admin(`output=Object.values(instances[${JSON.stringify(spawn.map)}].monsters).filter(m=>m.type==='fieldgen0'&&m.owner===${JSON.stringify(W)}).map(m=>({id:m.id,owner:m.owner,map:m.map,x:m.x,y:m.y,hp:m.hp}))`);
    await expect.poll(async()=>(await fields()).length,{timeout:45_000,message:'The native runtime must consume and deploy its field generator'}).toBeGreaterThan(0);
    expect(quantity((await world(live)).players[W].items,'fieldgen0')).toBe(0);
    await info.attach('native-field-generator-deployment',{body:JSON.stringify(await fields()),contentType:'application/json'});
  }
  // The encounter's end code, which the leader's log loses when the next encounter's diagnostics
  // begin (hunting/coordinator/rares.ts `diagnostic`), and the reads its release rule weighs
  // (`released`, `groupedRound`): each member's grouped queue and rare observation. In
  // final-gate-closing7 T24's phoenix pursuit ended 500 ms after its start and was never asked again.
  const pursuit:{logs:any[],samples:any[]}={logs:[],samples:[]};reads[type].pursuitLogs=pursuit.logs;
  let sampling=true;
  const sampler=(async()=>{while(sampling){
    const state=await live.state().catch(()=>null);
    if(state){
      for(const entry of state.combatLogs?.[W]??[])if(entry?.details?.rare&&entry.at>=spawnedAt&&!pursuit.logs.some(l=>l.at===entry.at&&l.message===entry.message))pursuit.logs.push(entry);
      const e=state.rareHuntState?.encounter;
      if(pursuit.samples.length<240)pursuit.samples.push({at:Date.now(),encounter:e?{id:e.target?.id,stage:e.stage,awaitingSelection:e.awaitingSelection,start:e.start}:null,
        retry:Object.keys(state.rareRetryEvidence??{}),members:Object.fromEntries([W,P,M].map(n=>{const c=state.characters[n],g=c?.groupedCombat;
          const o=c?.rareObservation;
          return [n,{observation:o?{at:o.at,grouped:o.grouped,sightings:(o.sightings??[]).map((x:any)=>x.id)}:null,epoch:g?.epoch,target:g?.state?.target?.id??null,
            queue:(g?.state?.queue??[]).map((t:any)=>[String(t.id),t.state])}];}))});
    }
    await new Promise(r=>setTimeout(r,250));
  }})();
  try{
    await expect.poll(async()=>(await Promise.all([W,P].map(name=>live.clients[name].events()))).flat()
      .some((event:any)=>event.event==='hit'&&String(event.data?.id)===String(spawn.id)&&[W,P].includes(event.data?.hid)&&event.data?.damage>0),
    {timeout:45_000,message:'A native party hit receipt must prove damage to the spawned rare, including a killing blow'}).toBe(true);
  }finally{sampling=false;await sampler;await info.attach(`native-rare-pursuit-${type}`,{body:JSON.stringify(pursuit),contentType:'application/json'});}
  // The rare holds the party as a rare task, and the status line names the rare, never an event,
  // while no event task is live or waiting. A rare that dies on the party's first blows holds the
  // group for one tick, so the ring's granted rare counts as well as the status line.
  await expect.poll(async()=>{const read=await live.tasks(),g=groupOf(read,W);const phase=g?.status?.phase??'';
    return /^rare:/.test(phase)||(g?.ring??[]).some((e:any)=>e.seq>seq&&e.decision==='granted'&&e.kind==='rare')?'rare:held':phase;},{timeout:30_000,message:'The rare holds the party as a rare'}).toMatch(/^rare:/);
  expect(groupOf(await live.tasks(),W).status.reasons.filter((r:any)=>/^event-/.test(r.kind)),'an event reason during a rare').toEqual([]);
  if(type==='phoenix')await expect.poll(async()=>{
    const state=await live.state(),epoch=state.farmingProfiles[W].groupedCombatResetAt;
    return [W,P].every(name=>state.characters[name]?.groupedCombat?.epoch===epoch);
  },{timeout:20_000,message:'Native members must acknowledge the shared reset when rare combat publishes grouped snapshots'}).toBe(true);
  await expect.poll(async()=>live.admin(`output=!!instances[${JSON.stringify(spawn.map)}]?.monsters[${JSON.stringify(spawn.id)}]`),{timeout:120_000,message:'Real combat must kill the seeded rare'}).toBe(false);
  await expect.poll(async()=>{const s=await live.state();return s.monsterHunt?.cycleId===cycleId&&s.monsterHunt.stage==='farming'&&!s.rareHuntState?.encounter&&!s.farmingProfiles?.[W]?.rareHuntReturn;},{timeout:90_000}).toBe(true);
  const gemTotal=(snapshot:any)=>[W,P,M].reduce((sum,name)=>sum+quantity(snapshot.players[name].items,'gem0'),0);
  await expect.poll(async()=>gemTotal(await world(live)),{timeout:45_000,message:"The rare's guaranteed native drop must reach party inventory"}).toBeGreaterThan(gemTotal(before));
  const lootReceipts=async()=>(await Promise.all([W,P,M].map(name=>live.clients[name].events()))).flat().filter((event:any)=>event.at>=spawnedAt&&event.event==='chest_opened'&&event.data?.items?.some((item:any)=>item.name==='gem0'));
  await expect.poll(async()=>(await lootReceipts()).length,
    {timeout:15_000,message:'The native chest receipt must reach the client after inventory updates on the server'}).toBeGreaterThan(0);
  const loot=await lootReceipts();
  expect(loot.length,'Native chest_opened must confirm the seeded rare drop was looted').toBeGreaterThan(0);
  await info.attach('native-rare-chest-opened',{body:JSON.stringify({spawn,loot}),contentType:'application/json'});
  const afterRare=await world(live);
  expect(afterRare.players[W].xp).toBeGreaterThan(before.players[W].xp);
  // The resume bound is the old row's (hunt-rows.ts:158).
  const resumedAt=Date.now(),resumedDeadline=resumedAt+90_000;
  let existingProgress:any=null,nextEncounter:any=null;
  const encounterObservations:any[]=[];
  await expect.poll(async()=>{
    const current=await world(live),state=await live.state(),mission=state.monsterHunt?.missions?.[state.monsterHunt.currentIndex],bounds=mission?.destination?.boundary,p=current.players[W];
    if(state.monsterHunt?.cycleId!==cycleId||state.monsterHunt.stage!=='farming')return false;
    if(p.quest?.id==='goo'&&p.quest.c<afterRare.players[W].quest.c){
      const events=(await Promise.all([W,P].map(name=>live.clients[name].events()))).flat();
      const hit=events.find((event:any)=>event.at>=resumedAt&&event.event==='hit'&&event.data?.kill===true&&
        event.data?.damage>0&&[W,P].includes(event.data?.hid)&&events.some((death:any)=>death.at>=event.at&&
          death.event==='death'&&String(death.data?.id)===String(event.data.id)));
      if(hit){existingProgress={source:'existing-native-progress',huntCycleId:cycleId,baseline:afterRare.players[W].quest,
        quest:p.quest,hit,death:events.find((event:any)=>event.at>=hit.at&&event.event==='death'&&String(event.data?.id)===String(hit.data.id))};return true;}
    }
    if(!Array.isArray(bounds))return false;
    const destination=mission.destination;
    // Position checking and encounter declaration share one native tick. Combat can cross the
    // habitat edge between HTTP requests.
    nextEncounter=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)}),destination=${JSON.stringify(destination)},bounds=destination.boundary;
      if(!p||p.map!==destination.map||p.x<bounds[0]||p.x>bounds[2]||p.y<bounds[1]||p.y>bounds[3])return null;
      const ambient=Object.values(instances[p.in].monsters||{}).filter(m=>m.type==='goo'&&m.hp>0&&m.x>=bounds[0]&&m.x<=bounds[2]&&m.y>=bounds[1]&&m.y<=bounds[3])
        .map(m=>({id:String(m.id),map:m.map,in:m.in,x:m.x,y:m.y,hp:m.hp,distance:Math.hypot(m.x-p.x,m.y-p.y),reachable:can_move({map:p.map,x:p.x,y:p.y,going_x:m.x,going_y:m.y,base:p.base})}));
      const existing=ambient.sort((a,b)=>a.distance-b.distance)[0];
      if(existing)return {...existing,source:'existing-native',ambient,destination};
      for(const [dx,dy] of [[35,0],[-35,0],[0,35],[0,-35]]){const x=p.x+dx,y=p.y+dy;
        if(x<bounds[0]||x>bounds[2]||y<bounds[1]||y>bounds[3]||!can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))continue;
        const m=new_monster(p.in,{__e2eAmbientExempt:true,type:'goo',position:[x,y],radius:0,count:1},{temp:1});m.e2eHunt=true;
        return {id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,source:'declared-native',ambient,destination};}
      return null;})()`);
    encounterObservations.push({at:Date.now(),position:{map:p.map,x:p.x,y:p.y},quest:p.quest,encounter:nextEncounter});
    return !!nextEncounter;
  },{timeout:Math.max(1,resumedDeadline-Date.now()),message:'The retained Hunt must produce real native progress or atomically prepare its next encounter'}).toBe(true);
  await info.attach('native-rare-followup-observations',{body:JSON.stringify(encounterObservations),contentType:'application/json'});
  if(!existingProgress){
    const missionKill=await killedByParty(live,nextEncounter.id,Math.max(1,Math.min(45_000,resumedDeadline-Date.now())));
    await info.attach('native-rare-followup-mission-kill',{body:JSON.stringify(missionKill),contentType:'application/json'});
  }
  await expect.poll(async()=>(await world(live)).players[W].quest?.c,{timeout:Math.max(1,resumedDeadline-Date.now())}).toBeLessThan(afterRare.players[W].quest.c);
  // The Hunt mission the rare suspended resumes with its record; the rare ends, never resumed.
  const trail=await taskTrail(live,`party:${W}`,seq);
  expect(trail.trail.some(([d,k])=>d==='resumed'&&k==='hunt-mission'),'the Hunt resumes after the rare').toBe(true);
  expect(trail.trail.some(([d,k])=>d==='resumed'&&k==='rare'),'a rare resumed').toBe(false);
  reads[type]={spawn,before:before.players[W].quest,afterRare:afterRare.players[W].quest,existingProgress:!!existingProgress,trail:trail.trail};
}

// H13 (live-hunt-events.spec.ts): the golden bat's rule off, three malformed posts refused, and a
// golden bat left alive while the Hunt farms on.
async function disabledRare(live: LiveGame, info: TestInfo, cycleId: string) {
  await live.post('/rare-hunting',{rules:{goldenbat:{enabled:false}},useFieldGenerators:false});
  const saved=(await live.state()).passiveHunting;
  for(const body of [{goldenbat:'true'},{rules:{fieldgen0:{enabled:true}}},{rules:{unknown_native_monster:{enabled:true}}}]) {
    const r=await fetch(live.url+'/party-api/rare-hunting',{method:'POST',headers:{'Content-Type':'application/json',Origin:live.url},body:JSON.stringify(body)});
    expect(r.status).toBe(400);
  }
  expect((await live.state()).passiveHunting).toEqual(saved);
  // The leader nominates a rare from its own copy of the rules (queue-client.ts queueCandidates),
  // which its next heartbeat reply brings (status/api.ts HeartbeatState). final-gate-closing10
  // planted the bat 250 ms after the change, the leader queued it from the old copy and the party
  // killed it. The bat is planted once the leader's copy holds the rule off, within the two report
  // gaps that bound a character's reports (movement owner.ts reportOrSilence).
  const gap=Number((await live.state()).characters[W]?.reportIntervalMs);
  await expect.poll(()=>live.clients[W].run(`globalThis.__partyHooks.ask('targeting.passiveStop',{mtype:'goldenbat'})`),
    {timeout:2*gap,message:"The leader's copy of the rules turns the golden bat off"}).toBe(false);
  const spawn=await spawnRare(live,'goldenbat'),before=await world(live);
  await expect.poll(async()=>(await world(live)).players[W].quest?.c,{timeout:90_000}).toBeLessThan(before.players[W].quest.c);
  expect(await live.admin(`output=!!instances[${JSON.stringify(spawn.map)}]?.monsters[${JSON.stringify(spawn.id)}]`)).toBe(true);
  expect((await live.state()).monsterHunt.cycleId).toBe(cycleId);
  await info.attach('native-disabled-rare',{body:JSON.stringify({spawn,before:before.players[W].quest,final:(await world(live)).players[W].quest}),contentType:'application/json'});
  reads.H13={spawn,saved};
}

async function raresPlay(live: LiveGame, info: TestInfo) {
  // The planted rares, the field generator and any goo a resume declares carry e2eHunt, and the
  // cleanup removes them and the deployed field generator.
  live.undo('the planted rares and field generator', () => cleanupEvents(live));
  const goo=await prepareHunt(live,{count:500});await start(live,W,goo.monster,goo.location);const cycleId=await cycle(live);
  for (const id of ['T24', 'H13']) await step(id, async () => {
    await expect.poll(async()=>(await live.state()).monsterHunt?.stage,{timeout:120_000}).toBe('farming');
  });
  await live.clients[W].run('parent.__e2eObserveMoves=true;parent.__e2eObservedMoveCount=0');
  await step('T24', () => followReset(live, info, cycleId));
  for (const [id, type] of rares) await step(id, () => interruption(live, info, type, cycleId));
  await step('H13', () => disabledRare(live, info, cycleId));
  await info.attach('native-rare-return-movement-packets', {body: JSON.stringify((await live.clients[W].events()).filter((event: any) => ['move-issued', 'player', 'new_map', 'game_log'].includes(event.event)).slice(-400)), contentType: 'application/json'});
}

const own = (id: string, behaviours: string[]) => ({
  owner: 'hunting', behaviours, start() {}, reads: () => ({failed: failed[id] ?? null, reads: reads[id] ?? null}),
  verdict() { expect(failed[id], `${id}: every step of the play passes`).toBeUndefined(); },
});
const rareBehaviours = ['GRP-011', 'GRP-017', 'GRP-031', 'HNT-131', 'HNT-132', 'HNT-138'];

liveWindow({
  id: 'W13', name: 'Goo Hunt interrupted by rares',
  // The old rows' runs summed from the catalog's wall times (T24 17 s, T25 13, T26 14, T27 15,
  // T28 15, T29 13) fall far below their bounds, so the bound is the old bounds of the steps the
  // play runs: 120 s to farm (hunt-rows.ts:96), per rare 45 s hit + 30 s rare task + 120 s kill +
  // 90 s resume + 45 s gem + 15 s receipt (hunt-rows.ts:131-154) with the 90 s resume deadline
  // (:158) and 45 s field generator (:125) once, then H13's 90 s quest poll
  // (live-hunt-events.spec.ts:111): 120 + 6 x 435 + 45 + 90 = 2,865 s.
  timeoutMs: 2_865_000,
  async play({live, info}: LiveWorld) { await raresPlay(live, info); },
  observers: [
    {id: 'T24', ...own('T24', rareBehaviours)}, {id: 'T25', ...own('T25', rareBehaviours)}, {id: 'T26', ...own('T26', rareBehaviours)},
    {id: 'T27', ...own('T27', rareBehaviours)}, {id: 'T28', ...own('T28', rareBehaviours)}, {id: 'T29', ...own('T29', rareBehaviours)},
    {id: 'H13', ...own('H13', ['HNT-068'])},
  ],
});
