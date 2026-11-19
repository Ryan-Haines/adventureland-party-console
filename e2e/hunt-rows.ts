import {expect,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {failedRowState,type Row} from './scenario-table';
import {groupOf,taskTrail} from './task-records';
import {warrior,priest,world as lifecycleWorld,tokens,profile,location,party,quests,prepareHunt,start,cycle,artifact,rejected} from './game/hunt-lifecycle';
import {world,spawnRare,cleanupEvents} from './game/hunt-events';
import {W,P,M,fighters,hunt,observed,reward,seedCargo,totalLeather,evidence,quantity,killNativeCharacter,killedByParty} from './hunt-interruption-helpers';
import {bandsRead} from './call-budget-rows';

// The Hunt rows, moved in the tasks owner step 8 (the test cut) from live-hunt-controls.spec.ts,
// live-hunt-events.spec.ts and live-hunt-merchant.spec.ts into the default fixture's table
// (live-movement-owner.spec.ts). Each row seeds its own quests and starts its own Hunt.

export async function controlsRow(live:LiveGame,info:TestInfo){
  await party(live);
  const destination = await location(live);
  const backup = { monsterFocus: ['goo'], location: destination };
  await live.post('/farming-mode', { character: P, mode: 'hunt', backup });
  expect(profile(await live.state(), P).monsterHunt).toBeFalsy();
  expect(profile(await live.state(), warrior).monsterHunt).toBeFalsy();
  const merchant = await rejected(live, '/farming-mode', { character: 'E2EMerchant', mode: 'hunt', backup });
  expect(merchant.status).toBe(409);
  await quests(live, info, { [W]: { count: 4 }, [P]: { count: 4 } });
  const before = await lifecycleWorld(live);
  await start(live);
  const cycle = profile(await live.state()).monsterHunt.cycleId;
  await live.post('/focus', { character: W, monsterFocus: [] });
  expect(profile(await live.state()).monsterHunt.cycleId).toBe(cycle);
  // Follow off for the priest mid-walk applies at once. The walk goes
  // on for the warrior, and in the same reply the priest has its own group's task; Follow on
  // again gives it the party's live task.
  await expect.poll(async () => { const c = (await live.state()).activeConvoy; return !!c && [warrior, priest].every(n => c.participants.includes(n)); },
    { timeout: 120_000, message: 'precondition: the Hunt walks both fighters' }).toBe(true);
  const walk = (await live.state()).activeConvoy.id;
  await live.post('/formation', { character: P, follow: false });
  const split = await live.state(), groups = (await live.tasks()).groups;
  expect(split.activeConvoy?.id, 'the walk goes on for the warrior').toBe(walk);
  expect(split.activeConvoy.participants, 'only the priest leaves the walk').toEqual([W]);
  expect(groups.find((g: any) => g.id === `solo:${P}`)?.members, 'the priest has its own group at once').toEqual([P]);
  await live.post('/formation', { character: P, follow: true });
  const joined = (await live.tasks()).groups.find((g: any) => g.id === `party:${W}`);
  expect(joined?.members, 'the priest joins the party at once').toContain(P);
  await expect.poll(async () => {
    const owner = await live.clients[P].run('(()=>{const t=globalThis.partyTasks.assignment.memberTask();return t&&t.task&&t.task.owner;})()');
    return !!owner && owner === (await live.tasks()).groups.find((g: any) => g.id === `party:${W}`)?.live?.owner;
  }, { timeout: 30_000, message: 'the joined priest is assigned the party live task' }).toBe(true);
  await expect.poll(async () => tokens((await lifecycleWorld(live))[W]), { timeout: 180_000 }).toBe(tokens(before[W]) + 1);
  // The game pays the token before the coordinator's Daisy step sees the claim done and ends the
  // hand-in task. A live rerun ended the hand-in half a second after the Scatter post.
  const huntTask = async () => (await live.tasks()).groups.find((g: any) => g.id === `party:${W}`);
  await expect.poll(async () => profile(await live.state()).monsterHunt?.turnIn?.phase === 'complete' && !/:hunt-turn-in$/.test(String((await huntTask())?.live?.owner)),
    { timeout: 60_000, message: 'precondition: the hand-in task has ended' }).toBe(true);
  // Hunt keeps the combat mode. With the Hunt task live,
  // Scatter and then Default reach every member's client and the reply's party mode, and the Hunt
  // cycle keeps the group. The Hunt's task kind follows its stage (`hunt:<cycle>:<kind>`),
  // so the owner may move between the cycle's own kinds; any other end of the cycle's task fails.
  const huntOwner = String((await huntTask())?.live?.owner);
  expect(huntOwner, 'precondition: the Hunt task is live').toMatch(/^hunt:[^:]+:/);
  const huntCycle = huntOwner.slice(0, huntOwner.lastIndexOf(':') + 1);
  // The mission and the hand-in end each other with `hunt-ended` as the Hunt moves between its kinds, so
  // only ends after this point can come from the combat mode changes.
  const seenSeq = Math.max(0, ...((await huntTask())?.ring ?? []).map((e: any) => Number(e.seq) || 0));
  for (const combatMode of ['scatter', 'default']) {
    await live.post('/farming-mode', { character: W, combatMode });
    for (const name of [W, P]) await expect.poll(() => live.clients[name].run('globalThis.partyHunting.farm.mode()'),
      { timeout: 15_000, message: `${combatMode} reaches ${name} under Hunt` }).toBe(combatMode);
    await expect.poll(async () => profile(await live.state()).partyFarmingMode, { timeout: 15_000, message: `the reply's party mode is ${combatMode}` }).toBe(combatMode);
    const task = await huntTask();
    expect(String(task?.live?.owner).startsWith(huntCycle), `the Hunt cycle keeps the group under ${combatMode}: ${task?.live?.owner}`).toBe(true);
    expect(task?.ring.filter((e: any) => e.seq > seenSeq && e.decision === 'ended' && String(e.owner).startsWith(huntCycle) &&
      !['replaced:hunt-mission', 'replaced:hunt-turn-in', 'replaced:farming'].includes(e.code)), 'the Hunt task did not end').toEqual([]);
  }
  // A target mode change ends the old entry's task `replaced:<kind>`, and a
  // combat mode change reaches the characters with the next reply. The single `mode` Scatter is
  // the combat mode Scatter with target Farming, so it ends the Hunt; ending on Default
  // keeps the Scatter poll below a real change.
  await live.post('/farming-mode', { character: W, mode: 'scatter' });
  await expect.poll(() => live.clients[P].run('globalThis.partyHunting.farm.mode()'), { timeout: 15_000, message: 'the combat mode reaches the priest' }).toBe('scatter');
  await expect.poll(async () => (await live.tasks()).groups.find((g: any) => g.id === `party:${W}`)?.ring.some((e: any) =>
    e.decision === 'ended' && String(e.owner).startsWith('hunt:') && e.code === 'replaced:farming'), { timeout: 120_000, message: 'the Hunt task ends replaced by Farming' }).toBe(true);
  // CB12: every party call of the game party's
  // members asks the job band, counted on each socket since its record began.
  const bands = Object.fromEntries(await Promise.all([W, P, M].map(async (n) => [n, (await bandsRead(live, n)).view?.answers ?? null])));
  await artifact(live, info, 'follower-preference-and-cleared-backup-real-reward', { before, cycle, merchant, walk, bands });
  console.log('CALL-BUDGET-CB12 ' + JSON.stringify(Object.fromEntries(Object.entries(bands).map(([n, a]: [string, any]) => [n, { survival: a?.survival?.party ?? null, job: a?.job?.party ?? null, background: a?.background?.party ?? null }]))));
  for (const [n, a] of Object.entries(bands) as [string, any][]) {
    expect(a, `CB12: ${n}'s budget answers`).toBeTruthy();
    expect([a.survival.party ?? null, a.background.party ?? null], `CB12: ${n}'s party calls ask no band but job`).toEqual([null, null]);
  }
  expect(Object.values(bands).reduce((sum: number, a: any) => sum + (a?.job?.party?.send ?? 0), 0), 'CB12: party calls ask the job band').toBeGreaterThan(0);
}

export const interruptionRows:Row[]=['phoenix','goldenbat','cutebee','hen','rooster','tinyp'].map(type=>[`native ${type} interruption kills and loots before resuming the same Hunt`,async(live,info)=>{
  try {
    const goo=await prepareHunt(live,{count:500});await start(live,W,goo.monster,goo.location);const cycleId=await cycle(live);
    await expect.poll(async()=>(await live.state()).monsterHunt?.stage,{timeout:120_000}).toBe('farming');
    if(type==='phoenix') {
      // Failure inventory: a follower's personal reset can be newer than its
      // destination group; stale queues must stay rejected without stalling it.
      const previous=(await live.state()).farmingProfiles[W].groupedCombatResetAt;
      await live.post('/formation',{character:P,follow:false});
      await expect.poll(async()=>(await live.state()).characters[P]?.groupedCombat?.epoch,{timeout:20_000}).toBeGreaterThan(previous);
      await live.post('/formation',{character:P,follow:true});
      await expect.poll(async()=>{
        const state=await live.state(),epoch=state.farmingProfiles[W].groupedCombatResetAt;
        // Scatter publishes no group snapshot. The existing leader receives the
        // new group epoch when rare combat restores grouped mode below.
        return epoch>previous&&state.characters[P]?.groupedCombat?.epoch===epoch&&
          state.characters[W]?.groupedCombat?.epoch<=epoch;
      },{timeout:20_000,message:'The destination group must admit the rejoining native follower reset epoch'}).toBe(true);
      const state=await live.state();
      expect(state.monsterHunt.cycleId).toBe(cycleId);
      await info.attach('phoenix-native-follow-reset-boundary',{body:JSON.stringify({previous,groupEpoch:state.farmingProfiles[W].groupedCombatResetAt,members:[W,P].map(name=>({name,epoch:state.characters[name].groupedCombat.epoch}))}),contentType:'application/json'});
    }
    if(type==='tinyp') {
      await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});add_item(p,{name:'fieldgen0'});resend(p,'reopen');return p.items.filter(i=>i?.name==='fieldgen0')})()`);
      await expect.poll(async()=>quantity((await live.state()).characters[W].items.map((entry:any)=>entry?.item),'fieldgen0')).toBe(1);
    }
    await live.post('/rare-hunting',{rules:{[type]:{enabled:true,keepMoving:false,priority:999}},useFieldGenerators:type==='tinyp'});
    await live.clients[W].run('parent.__e2eObserveMoves=true;parent.__e2eObservedMoveCount=0');
    const before=await world(live),spawnedAt=Date.now(),spawn=await spawnRare(live,type);
    await info.attach('native-rare-initial-encounter',{body:JSON.stringify(spawn),contentType:'application/json'});
    if(type==='tinyp') {
      const fields=()=>live.admin(`output=Object.values(instances[${JSON.stringify(spawn.map)}].monsters).filter(m=>m.type==='fieldgen0'&&m.owner===${JSON.stringify(W)}).map(m=>({id:m.id,owner:m.owner,map:m.map,x:m.x,y:m.y,hp:m.hp}))`);
      await expect.poll(async()=>(await fields()).length,{timeout:45_000,message:'The native runtime must consume and deploy its field generator'}).toBeGreaterThan(0);
      expect(quantity((await world(live)).players[W].items,'fieldgen0')).toBe(0);
      await info.attach('native-field-generator-deployment',{body:JSON.stringify(await fields()),contentType:'application/json'});
    }
    // The row's own cleanup removes the rare, so a missed hit prints the row's state before it.
    try {
      await expect.poll(async()=>(await Promise.all([W,P].map(name=>live.clients[name].events()))).flat()
        .some((event:any)=>event.event==='hit'&&String(event.data?.id)===String(spawn.id)&&[W,P].includes(event.data?.hid)&&event.data?.damage>0),
      {timeout:45_000,message:'A native party hit receipt must prove damage to the spawned rare, including a killing blow'}).toBe(true);
    } catch(error) {await failedRowState(live,`native ${type} interruption, before cleanup`,String(spawn.id));throw error;}
    // The rare holds the party as a rare task, and the status line names the
    // rare, never an event, while no event task is live or waiting.
    // A rare that dies on the party's first blows holds the group for one tick, so the ring's
    // granted rare counts as well as the status line.
    await expect.poll(async()=>{const read=await live.tasks(),g=groupOf(read,W);const phase=g?.status?.phase??'';
      return /^rare:/.test(phase)||(g?.ring??[]).some((e:any)=>e.decision==='granted'&&e.kind==='rare')?'rare:held':phase;},{timeout:30_000,message:'The rare holds the party as a rare'}).toMatch(/^rare:/);
    expect(groupOf(await live.tasks(),W).status.reasons.filter((r:any)=>/^event-/.test(r.kind)),'an event reason during a rare').toEqual([]);
    if(type==='phoenix')await expect.poll(async()=>{
      const state=await live.state(),epoch=state.farmingProfiles[W].groupedCombatResetAt;
      return [W,P].every(name=>state.characters[name]?.groupedCombat?.epoch===epoch);
    },{timeout:20_000,message:'Native members must acknowledge the shared reset when rare combat publishes grouped snapshots'}).toBe(true);
    await expect.poll(async()=>live.admin(`output=!!instances[${JSON.stringify(spawn.map)}]?.monsters[${JSON.stringify(spawn.id)}]`),{timeout:120_000,message:'Real combat must kill the seeded rare'}).toBe(false);
    await expect.poll(async()=>{const s=await live.state();return s.monsterHunt?.cycleId===cycleId&&s.monsterHunt.stage==='farming'&&!s.rareHuntState?.encounter&&!s.farmingProfiles?.[W]?.rareHuntReturn;},{timeout:90_000}).toBe(true);
    const gemTotal=(snapshot:any)=>[W,P,M].reduce((sum,name)=>sum+quantity(snapshot.players[name].items,'gem0'),0);
    await expect.poll(async()=>gemTotal(await world(live)),{timeout:45_000,message:'The rare\'s guaranteed native drop must reach party inventory'}).toBeGreaterThan(gemTotal(before));
    const lootReceipts=async()=>(await Promise.all([W,P,M].map(name=>live.clients[name].events()))).flat().filter((event:any)=>event.at>=spawnedAt&&event.event==='chest_opened'&&event.data?.items?.some((item:any)=>item.name==='gem0'));
    await expect.poll(async()=>(await lootReceipts()).length,
      {timeout:15_000,message:'The native chest receipt must reach the client after inventory updates on the server'}).toBeGreaterThan(0);
    const loot=await lootReceipts();
    expect(loot.length,'Native chest_opened must confirm the seeded rare drop was looted').toBeGreaterThan(0);
    await info.attach('native-rare-chest-opened',{body:JSON.stringify({spawn,loot}),contentType:'application/json'});
    const afterRare=await world(live);
    expect(afterRare.players[W].xp).toBeGreaterThan(before.players[W].xp);
    const resumedAt=Date.now(),resumedDeadline=resumedAt+90_000;
    let existingProgress:any=null,nextEncounter:any=null;
    const encounterObservations:any[]=[];
    {
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
        // Position checking and encounter declaration share one native tick.
        // Combat can legitimately cross the habitat edge between HTTP requests.
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
      if(existingProgress){
        await info.attach('native-rare-followup-existing-progress',{body:JSON.stringify({type,...existingProgress}),contentType:'application/json'});
      } else {
        await info.attach('native-rare-followup-mission-encounter',{body:JSON.stringify({type,nextEncounter}),contentType:'application/json'});
        const missionKill=await killedByParty(live,nextEncounter.id,Math.max(1,Math.min(45_000,resumedDeadline-Date.now())));
        await info.attach('native-rare-followup-mission-kill',{body:JSON.stringify(missionKill),contentType:'application/json'});
      }
    }
    await expect.poll(async()=>(await world(live)).players[W].quest?.c,{timeout:Math.max(1,resumedDeadline-Date.now())}).toBeLessThan(afterRare.players[W].quest.c);
    // The Hunt mission the rare suspended resumes with its record; the rare ends, never resumed.
    const trail=await taskTrail(live,`party:${W}`,0);
    expect(trail.trail.some(([d,k])=>d==='resumed'&&k==='hunt-mission'),'the Hunt resumes after the rare').toBe(true);
    expect(trail.trail.some(([d,k])=>d==='resumed'&&k==='rare'),'a rare resumed').toBe(false);
    await info.attach('native-rare-hunt-resumed',{body:JSON.stringify({cycleId,spawn,before,afterRare,final:await world(live),state:await live.state()}),contentType:'application/json'});
  } finally {
    try {
      const packets=(await live.clients[W].events()).filter((event:any)=>['move-issued','player','new_map','game_log'].includes(event.event)).slice(-400);
      await info.attach('native-rare-return-movement-packets',{body:JSON.stringify(packets),contentType:'application/json'});
    } finally {
      try {await live.clients[W].run('parent.__e2eObserveMoves=false');}
      finally {await cleanupEvents(live);}
    }
  }
}]);

// The two hold variants put the warrior on Manual before the
// collection. Under Carries on the visit waits until the hold ends; under Follows me the merchant
// delivers where the warrior stands. The escape, death recovery, Cave and turn-in refusals
// are the rule table's column (movement-rules "task failure 4"): /bank-party is a player
// command, which ends an escape or a death recovery first, so no live setup queues a visit
// into one.
export const merchantRows:Row[]=(['coordinator restart','queued merchant death','active merchant death','a member on Manual that carries on','a member on Manual that follows me'] as const)
  .map(fault=>[`Hunt collection resumes after ${fault} without losing or duplicating cargo`,async(live,info)=>{
  const setup={...await prepareHunt(live,{monster:'armadillo',count:1}),before:await observed(live)};await seedCargo(live);
  const total=await totalLeather(live);
  if(fault==='queued merchant death')await live.post('/merchant/force-stand',{enabled:true});
  await start(live,W,setup.monster,setup.location);
  await expect.poll(async()=>{const s=await live.state();return hunt(s)?.stage==='mission-travel'&&!!s.activeConvoy;},{timeout:90000}).toBe(true);
  const cycle=hunt(await live.state()).cycleId;
  const held=fault==='a member on Manual that carries on'?'carries-on':fault==='a member on Manual that follows me'?'follows-me':null;
  if(held){
    await live.post('/formation',{character:W,handControl:{on:true,party:held}});
    await expect.poll(async()=>(await live.tasks()).groups.some((g:any)=>g.holds.some((h:any)=>h.member===W&&h.by==='manual'&&h.party===held)),
      {timeout:30000,message:'The warrior goes on Manual'}).toBe(true);
    await expect.poll(async()=>await live.clients[W].run('globalThis.partyTasks.holds.handControl()?.by')==='manual'&&!(await observed(live))[W].moving,
      {timeout:30000,message:'The warrior on Manual stops'}).toBe(true);
  }
  const heldAt=held&&(await observed(live))[W];
  await live.post('/bank-party',{});
  if(held==='carries-on'){
    // The visit queues and waits: the merchant holds a job naming the warrior while
    // the warrior keeps its marked stack and its Manual hold; releasing the hold lets it run below.
    await expect.poll(async()=>{const s=await live.state();return [s.merchantCurrent,...(s.merchantQueue||[])].some((job:any)=>job?.target===W);},
      {timeout:90000,message:'The merchant queues the visit into the warrior on Manual'}).toBe(true);
    expect(groupOf(await live.tasks(),W).holds.some((h:any)=>h.member===W&&h.by==='manual'&&h.party==='carries-on'),'the Manual hold still stands').toBe(true);
    expect(quantity((await observed(live))[W].items,'leather'),'no visit into a member on Manual that carries on').toBeGreaterThan(0);
    await live.post('/formation',{character:W,handControl:{on:false}});
  }
  if(fault==='queued merchant death') {
    await expect.poll(async()=>(await live.state()).merchantQueue.length,{timeout:20000}).toBeGreaterThan(0);
  } else if(held) {
    await expect.poll(async()=>!!(await live.state()).merchantCurrent||quantity((await observed(live))[W].items,'leather')===0,{timeout:90000}).toBe(true);
  } else {
    await expect.poll(async()=>!!(await live.state()).merchantCurrent,{timeout:90000}).toBe(true);
    await expect.poll(async()=>{const s=await live.state();return !!s.activeConvoy?.merchantInterruption||s.commands?.[W]?.type==='merchant-handoff';},
      {timeout:90000,intervals:[100,250],message:'Native collection must actually interrupt the owned Hunt convoy before fault injection'}).toBe(true);
  }
  await evidence(live,info,'hunt-merchant-owned-before-fault',{fault,total,cycle,destination:setup.location});
  if(fault==='coordinator restart')await live.restartCoordinator();
  else if(held) { /* the hold is the fault */ }
  else {
    const death=await killNativeCharacter(live,M);
    await info.attach('native-merchant-death',{body:JSON.stringify(death,null,2),contentType:'application/json'});
    await expect.poll(async()=>(await observed(live))[M].rip,{timeout:15000}).toBe(true);
    await expect.poll(async()=>{const m=(await observed(live))[M];return !m.rip&&m.hp>0;},{timeout:120000}).toBe(true);
    if(fault==='queued merchant death')await live.post('/merchant/force-stand',{enabled:false});
  }
  const continued=hunt(await live.state());
  if(fault==='queued merchant death'&&continued?.cycleId!==cycle) {
    const completed=await observed(live);
    expect(fighters.every(name=>quantity(completed[name].items,'monstertoken')===quantity(setup.before[name].items,'monstertoken')+1),
      'A queued merchant may outlive this Hunt only after both original owners actually received their rewards').toBe(true);
    await live.post('/farming-mode',{character:W,mode:'default'});
  } else expect(continued?.cycleId).toBe(cycle);
  const rendezvousSamples:any[]=[];let lastRendezvousSample=0;
  // The merchant is never in a party convoy, and its job is the merchant
  // group's own task.
  const merchantInConvoy:any[]=[];let jobTask=false;
  try{await expect.poll(async()=>{
    const native=await observed(live),coordinator=await live.state();
    if(coordinator.activeConvoy?.participants?.includes(M))merchantInConvoy.push({at:Date.now(),convoy:coordinator.activeConvoy.purpose});
    jobTask||=(await taskTrail(live,`merchant:${M}`,0)).trail.some(([,k])=>k==='merchant-job');
    if(fault==='active merchant death'&&Date.now()-lastRendezvousSample>=1000){
      lastRendezvousSample=Date.now();let client:any;
      try{client=await live.clients[M].frame.evaluate(()=>{
        const game=window as any,root=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
        const merchant=game.character,target=game.get_player?.('E2EWarrior'),smart=root?.smart;
        return {character:merchant&&{name:merchant.name,map:merchant.map,in:merchant.in,x:merchant.real_x??merchant.x,y:merchant.real_y??merchant.y,rip:merchant.rip,moving:merchant.moving},
          target:target&&{name:target.name,map:target.map,in:target.in,x:target.real_x??target.x,y:target.real_y??target.y,rip:target.rip,visible:target.visible},
          distance:merchant&&target?Math.hypot((target.real_x??target.x)-(merchant.real_x??merchant.x),(target.real_y??target.y)-(merchant.real_y??merchant.y)):null,
          directClear:target&&root?.can_move_to?.(target.real_x??target.x,target.real_y??target.y),realm:String(game.server_region)+String(game.server_identifier),
          commandId:root?.__partyLastCommand,activeJob:root?.__merchantHolder,
          navigationIntent:root?.__partyNavigationIntent,route:smart&&{moving:smart.moving,found:smart.found,map:smart.map,x:smart.x,y:smart.y,remaining:smart.plot?.length}};
      });}catch(error){client={observationError:String(error)};}
      if(rendezvousSamples.length===96)rendezvousSamples.splice(64,1);
      rendezvousSamples.push({at:lastRendezvousSample,server:Object.fromEntries([W,M].map(name=>[name,{...native[name],items:undefined}])),client});
    }
    return quantity(native[W].items,'leather');
  },{timeout:180000,message:'The native merchant must actually collect the marked stack'}).toBe(0);}
  finally{if(fault==='active merchant death')await info.attach('native-merchant-recovery-rendezvous-samples',{body:JSON.stringify({fault,cycle,total,rendezvousSamples}),contentType:'application/json'});}
  if(held==='follows-me'){
    // The merchant delivered where the warrior on Manual stands; only the merchant moved.
    const at=(await observed(live))[W];
    expect(Math.hypot(at.x-heldAt.x,at.y-heldAt.y),'the warrior on Manual stays where it stood').toBeLessThan(1);
    await live.post('/formation',{character:W,handControl:{on:false}});
  }
  expect(merchantInConvoy,'the merchant in a party convoy').toEqual([]);
  expect(jobTask,'the collection is a merchant group job task').toBe(true);
  await expect.poll(async()=>{const s=await live.state();return !s.merchantCurrent&&!s.merchantQueue.length&&!s.merchantMarked?.[W]?.length;},{timeout:180000}).toBe(true);
  expect(await totalLeather(live)).toBe(total);
  await reward(live,setup.before);
  await live.restartCoordinator();
  expect(await totalLeather(live)).toBe(total);
  await evidence(live,info,'hunt-merchant-recovered-and-rewarded',{fault,total,cycle});
}]);
