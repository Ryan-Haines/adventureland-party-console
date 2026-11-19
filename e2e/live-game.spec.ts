import './chronal-clock-reconnect.case';
import { gooHunt, convoy } from './gameplay-scenarios';
import { test, expect } from './live-fixtures';
import type { LiveGame } from './live-fixtures';
import type { TestInfo } from '@playwright/test';
import { seedSmallGoobrawl } from './game/event-scenario';
import { killNativeCharacter } from './hunt-interruption-helpers';
import { createHash } from 'node:crypto';

import { warrior as W, priest as P, merchant as M, quantity, observed, evidence, point, arrived, party, travel, seedQuest, start, hunt, type Location } from './game/hunt-lifecycle';
type Live = LiveGame;
const names = [W, P, M];

test('Steam-style CODE replacement retires old socket callbacks and pending heartbeat', async ({live},info)=>{
  // Failure modes: detached CODE callbacks still dereference native parent;
  // socket listeners accumulate; an old pending heartbeat applies after reload;
  // retirement disconnects the game or prevents the new runtime from operating.
  // Deployment can also be deferred by a real activity owner, a stopped loader,
  // or a changed runner context. Preserve those actual boundaries on failure.
  const loaderObservations:unknown[]=[],deploymentResponses:unknown[]=[];
  const client=live.clients[W],game=client.frame;
  const animationClock=await game.evaluate(()=>new Promise<{timestamp:number;now:number;backend:string}>(resolve=>requestAnimationFrame(timestamp=>resolve({timestamp,now:performance.now(),backend:(window as any).__e2eChronalClock?.backend||'native'}))));
  await info.attach('native-animation-clock-domain',{body:JSON.stringify(animationClock),contentType:'application/json'});
  expect(Number.isFinite(animationClock.timestamp)).toBe(true);
  if(animationClock.backend==='chronal-network')expect(animationClock.timestamp).toBe(animationClock.now);
  else expect(animationClock.timestamp).toBeLessThanOrEqual(animationClock.now);

  const before=await game.evaluate(()=>{
    const host=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
    host.__e2eRetiringRunner=runner;host.__e2eRetiringGame=host;
    // The lifecycle owner's run scope registers every CODE listener as a wrapper made in the
    // runner frame, so the runner realm's functions are the managed ones and the rest are the
    // game's own.
    host.__e2eManagedResponses=host.socket.listeners('game_response').filter((fn:Function)=>fn instanceof runner.Function);
    host.__e2eNativeResponses=host.socket.listeners('game_response').filter((fn:Function)=>!host.__e2eManagedResponses.includes(fn));
    return {generation:runner.__partyRuntimeGeneration,at:runner.__partyStatusSuccessAt,listeners:host.socket.listeners('server_info').length,
      responseListeners:host.socket.listeners('game_response').length,managedResponses:host.__e2eManagedResponses.length,name:host.character.name};
  });
  const oldFrame=game.childFrames().find(frame=>new URL(frame.url()).pathname==='/runner')!;
  let release!:()=>void,held=false,deploy=false;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await client.page.route('**/party-api/status*',async route=>{
    if(!held&&route.request().frame()===oldFrame){held=true;await gate;}
    try{await route.continue();}catch(error){if(!oldFrame.isDetached())throw error;}
  });
  // Declared deployment boundary: identical maintained runtime bytes with an
  // innocuous comment and a matching checksum represent a new published build.
  let deployedFile='',deployedBody='',deployedHash='';
  // Explicit deployment publication is required; a rebuilt manifest alone must
  // never retire the running native frame.
  await client.page.route('**/CODE/adventure_land/activation.json*',async route=>{
    if(!deploy)return route.continue();
    const manifest=await (await client.page.request.get(live.url+'/CODE/adventure_land/manifest.json')).json();
    manifest.classes.warrior.sha256=deployedHash;
    await route.fulfill({json:{id:'native-code-replacement',manifest}});
  });
  await client.page.route('**/CODE/adventure_land/manifest.json*',async route=>{
    const response=await route.fetch(),manifest=await response.json();
    if(deploy)manifest.classes.warrior.sha256=deployedHash;
    if(deploy&&deploymentResponses.length<80)deploymentResponses.push({at:Date.now(),kind:'manifest',oldFrame:route.request().frame()===oldFrame,warriorHash:manifest.classes.warrior.sha256});
    await route.fulfill({response,json:manifest});
  });
  await client.page.route('**/CODE/adventure_land/generated/**/*.js*',async route=>{
    if(deploy&&new URL(route.request().url()).pathname.endsWith('/'+deployedFile)){
      if(deploymentResponses.length<80)deploymentResponses.push({at:Date.now(),kind:'class',oldFrame:route.request().frame()===oldFrame,hash:deployedHash});
      await route.fulfill({status:200,contentType:'text/javascript',body:deployedBody});
    }
    else await route.continue();
  });
  try{
    const asset=await game.evaluate(async()=>{
      const runner=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      const base=runner.__partyServer+'/CODE/adventure_land/';
      const manifest=await (await fetch(base+'manifest.json')).json();
      return {file:manifest.classes.warrior.file,body:await(await fetch(base+manifest.classes.warrior.file)).text()};
    });
    deployedFile=asset.file;deployedBody=asset.body+'\n// Native E2E declared deployment revision.\n';
    deployedHash=createHash('sha256').update(deployedBody).digest('hex');
    await expect.poll(()=>held,{timeout:20_000}).toBe(true);deploy=true;
    await expect.poll(async()=>{
      const observation=await game.evaluate(()=>{
        const host=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
        return {at:Date.now(),replaced:!!runner&&runner!==host.__e2eRetiringRunner,
          caracAL:!!host.caracAL,connected:host.socket.connected,codeActive:host.code_active,
          loaderPresent:!!runner?.__partyCodeLoader,loaderGeneration:runner?.__partyLoaderGeneration,runtimeGeneration:runner?.__partyRuntimeGeneration,
          runtimeStartedAt:runner?.__partyLoaderRuntimeStartedAt,statusSuccessAt:runner?.__partyStatusSuccessAt,
          stopped:host.localStorage.getItem('party-code-stopped:'+host.character.name),
          occupied:!!runner?.__partyHooks?.skills.allows({rank:'damage',occupied:true}),canReload:runner?.sharedRoutine?.canReload?.(),combatOwner:runner?.__partyMovement?.live()?.owner??null};
      });
      if(loaderObservations.length<80)loaderObservations.push(observation);
      return observation.replaced;
    },{timeout:30_000,message:'The actual loader must replace its native CODE iframe'}).toBe(true);
    release();
    await expect.poll(()=>client.snapshot().then(s=>s.statusAt||0),{timeout:30_000}).toBeGreaterThan(before.at);
    const after=await game.evaluate(()=>{
      const host=window as any,old=host.__e2eRetiringRunner;
      return {sameGame:host===host.__e2eRetiringGame,connected:host.socket.connected,name:host.character.name,
        listeners:host.socket.listeners('server_info').length,responseListeners:host.socket.listeners('game_response').length,
        nativeResponsesPreserved:host.__e2eNativeResponses.every((fn:Function)=>host.socket.listeners('game_response').includes(fn)),
        managedLeft:host.__e2eManagedResponses.filter((fn:Function)=>host.socket.listeners('game_response').includes(fn)).length,oldGeneration:old.__partyRuntimeGeneration};
    });
    await info.attach('native-code-replacement-lifecycle',{body:JSON.stringify({before,after,held,errors:client.errors,state:await live.state()}),contentType:'application/json'});
    expect(after.sameGame).toBe(true);expect(after.connected).toBe(true);expect(after.name).toBe(before.name);
    expect(after.listeners,'Retired CODE must remove its game-window socket listeners').toBe(before.listeners);
    expect(before.managedResponses).toBeGreaterThan(0);
    expect(after.managedLeft,'Retired CODE must remove its game_response listeners').toBe(0);
    expect(after.responseListeners,'The new CODE registers as many game_response listeners as the old one held').toBe(before.responseListeners);
    expect(after.nativeResponsesPreserved).toBe(true);
    expect(after.oldGeneration,'Retired callbacks must lose runtime ownership').toBeGreaterThan(before.generation);
    expect(client.errors.filter(error=>/null.*(?:character|S)|(?:character|S).*null/.test(error))).toEqual([]);
    const destination=await point(live,W,120);await travel(live,W,destination);await arrived(live,[W],destination,60_000);
    await evidence(live,info,'native-code-replacement-new-runtime-arrival',{before,after,destination});
  }finally{
    release();
    await info.attach('native-loader-deployment-observations',{body:JSON.stringify({before,held,deploy,deployedHash,loaderObservations,deploymentResponses}),contentType:'application/json'});
  }
});


test.describe('real server, native clients, maintained character runtime', () => {
  test.setTimeout(240_000);

  test('a console character order produces real walking and observed arrival', async ({ live, page }, info) => {
    await page.goto(live.url);
    await expect(page.getByRole('heading', { name: M, exact: true })).toBeVisible();
    const before = await observed(live), destination = await point(live, M);
    await travel(live, M, destination);
    await expect.poll(async () => Math.hypot((await observed(live))[M].x-before[M].x, (await observed(live))[M].y-before[M].y), { timeout: 30_000 }).toBeGreaterThan(50);
    await arrived(live, [M], destination);
    const client = await live.clients[M].snapshot();
    expect(Math.hypot(client.x-destination.x, client.y-destination.y)).toBeLessThan(35);
    await evidence(live, info, 'walk-arrival', { before, destination, client });
  });

  test('a two-character convoy reaches the destination through real movement', async ({ live }, info) => {
    await convoy(live, info);
  });

  test('a lost native follower reconnects and finishes the current convoy', async ({ live }, info) => {
    await party(live);
    const before = await observed(live), destination = await point(live, W, 450);
    await live.post('/travel', destination);
    await expect.poll(async () => Math.hypot((await observed(live))[P].x-before[P].x, (await observed(live))[P].y-before[P].y), { timeout: 40_000 }).toBeGreaterThan(30);
    await evidence(live, info, 'before-native-connection-loss', { destination });
    await live.reconnectClient(P);
    await arrived(live, [W, P], destination);
    expect((await live.clients[P].snapshot()).name).toBe(P);
    await evidence(live, info, 'native-reconnect-arrival', { destination });
  });

  // The healing title checks the Town landing (step 4 item 6) and the cast that a heal must not
  // cancel (step 11 item 11) in one run; a plain cast is the same run with less checked.
  test('Town executes a real cast after travel and returns both party members without passive healing cancelling the channel', async ({ live }, info) => {
    await party(live);
    const away = await point(live, W, 350);
    await live.post('/travel', away);
    await arrived(live, [W, P], away);
    const spawn = await live.admin(`output={map:'main',x:G.maps.main.spawns[0][0],y:G.maps.main.spawns[0][1],scatter:G.maps.main.spawns[0][3]||0}`);
    const beforeTown = await observed(live);
    // Failure inventory: a 15-HP deficit triggers passive healing during Town;
    // native healing clears the caster's channel and splits the returning party.
    // Declare the initial healing condition once, at the first real channel.
    // No cast, heal, transport, arrival or successful response is fabricated.
    await live.admin(`output=(()=>{
      const fixture=globalThis.__e2eTownHealing={armedAt:Date.now()};
      fixture.timer=setInterval(()=>{const p=get_player(${JSON.stringify(P)});
        if(fixture.seed||!p?.c?.town)return;
        fixture.seed={at:Date.now(),map:p.map,x:p.x,y:p.y,hp:p.hp,max_hp:p.max_hp,mp:p.mp,max_mp:p.max_mp,channel:{...p.c.town}};
        // As in the CI incident, MP recovery takes priority over topping off HP.
        // Otherwise regen_hp can erase the injury before the party status sees it.
        p.hp=p.max_hp-15;p.mp=Math.floor(p.max_mp*.4);
        fixture.seed.declaredHp=p.hp;fixture.seed.declaredMp=p.mp;resend(p,'u+cid');clearInterval(fixture.timer);
      },10);return {armedAt:fixture.armedAt,missingHp:15,mpRatio:.4};})()`);
    try {
    await live.post('/town-party', {});
    await expect.poll(async () => {
      const current = await observed(live);
      // Upstream transport scatters each axis within half the configured spawn width.
      return [W, P].every(name => current[name].townAt > beforeTown[name].townAt &&
        current[name].map === spawn.map && !current[name].moving &&
        Math.abs(current[name].x-spawn.x) <= spawn.scatter/2+1 &&
        Math.abs(current[name].y-spawn.y) <= spawn.scatter/2+1);
    }, { timeout: 90_000, message: 'Both native Town casts must complete inside the actual server spawn bounds' }).toBe(true);
    await expect.poll(async () => (await live.state()).townCycle?.pending?.length || 0).toBe(0);
    const seed=await live.admin('output=globalThis.__e2eTownHealing.seed');
    expect(seed,'The native Town channel must receive the declared minor injury').toBeTruthy();
    const events=await live.clients[P].events();
    const receipt=events.find((event:any)=>event.event==='new_map'&&event.at>=seed.at&&event.data?.name===spawn.map&&event.data?.effect===1);
    expect(receipt,'The first real cast must produce a Town transport').toBeTruthy();
    // Native transport and a later heal can share one ChronAL window timestamp.
    // End the channel at its transport receipt's sequence, not an inclusive time.
    const channelHeals=events.filter((event:any)=>event.at>=seed.at&&event.sequence<receipt.sequence&&event.event==='hit'&&event.data?.hid===P&&event.data?.source==='heal');
    const starts=events.filter((event:any)=>event.at>=seed.at&&event.sequence<receipt.sequence&&event.event==='game_response'&&event.data?.place==='town'&&event.data?.in_progress);
    await info.attach('native-town-healing-channel',{body:JSON.stringify({seed,receipt,channelHeals,starts,postArrivalHeals:events.filter((event:any)=>event.sequence>receipt.sequence&&event.at===receipt.at&&event.event==='hit'&&event.data?.hid===P&&event.data?.source==='heal')}),contentType:'application/json'});
    expect(channelHeals,'Routine heals must not cancel Town channeling').toEqual([]);
    expect(starts.length,'No second Town request may be needed after the declared injury').toBeLessThanOrEqual(1);
    expect(receipt.at-seed.at,'The original three-second native cast must finish without a walking fallback').toBeLessThan(8000);
    await evidence(live, info, 'town-server-arrival', { away, spawn });
    } finally {
      await live.admin('output=(()=>{const fixture=globalThis.__e2eTownHealing;if(fixture)clearInterval(fixture.timer);delete globalThis.__e2eTownHealing;return true;})()');
    }
  });

  test('a merchant route crosses a real door into the bank and returns home', async ({ live }, info) => {
    const bank = await live.admin(`output={map:'bank',x:G.maps.bank.spawns[0][0],y:G.maps.bank.spawns[0][1]}`);
    await travel(live, M, bank);
    await arrived(live, [M], bank);
    await evidence(live, info, 'bank-door-arrival');
    // Idle merchant policy returns to this stand. Main's Town spawn is only a
    // transient arrival on that route and can be left between observations.
    const home = { map: 'main', x: -63, y: 100 };
    await travel(live, M, home);
    await arrived(live, [M], home);
    await evidence(live, info, 'bank-door-return');
  });

  test('starting Hunt in the dashboard obtains a real first quest from Daisy', async ({ live, page }, info) => {
    await party(live);
    expect((await observed(live))[W].quest).toBeNull();
    await page.goto(live.url);
    const warrior = page.locator('article').filter({ has: page.getByRole('heading', { name: W, exact: true }) });
    await warrior.getByRole('button', { name: /^Farming settings .+/ }).click();
    await warrior.getByRole('button', { name: 'Hunt', exact: true }).click();
    const preparation = page.getByRole('dialog', { name: 'Getting ready to hunt', exact: true });
    await preparation.getByRole('button', { name: 'No monsters selected 0', exact: true }).click();
    await page.getByRole('checkbox', { name: /\bGoo · goo\b/ }).check();
    await page.keyboard.press('Escape');
    await preparation.locator('button[aria-pressed]').first().click();
    await preparation.getByRole('button', { name: 'Save backup and start Hunt', exact: true }).click();
    await expect(preparation).not.toBeVisible();
    await expect.poll(async () => (await observed(live))[W].quest?.c || 0, { timeout: 120_000 }).toBeGreaterThan(0);
    const result = await observed(live);
    expect(result[W].quest.id).toBeTruthy();
    await evidence(live, info, 'dashboard-hunt-real-quest', { result });
  });

  test('Hunt kills real monsters then returns to Daisy and receives a real token', async ({ live }, info) => {
    test.setTimeout(240_000);
    await gooHunt(live, info);
  });

  test('a completed Hunt survives restart and claims its reward only once', async ({ live }, info) => {
    await party(live);
    await seedQuest(live, 'goo', 0);
    const before = await observed(live), tokens = quantity(before[W].items, 'monstertoken');
    await start(live);
    await live.restartCoordinator();
    await expect.poll(async () => quantity((await observed(live))[W].items, 'monstertoken'), { timeout: 120_000 }).toBe(tokens+1);
    await live.post('/farming-mode', { character: W, mode: 'default' });
    await live.restartCoordinator();
    expect(quantity((await observed(live))[W].items, 'monstertoken')).toBe(tokens+1);
    await evidence(live, info, 'exactly-once-hunt-reward', { before });
  });

  test('Hunt off and a new destination prevent the previous mission resuming after restart', async ({ live }, info) => {
    await party(live);
    await seedQuest(live, 'goo', 20);
    await start(live);
    await expect.poll(async () => !!hunt(await live.state())).toBe(true);
    await live.post('/farming-mode', { character: W, mode: 'default' });
    const destination = await point(live, W, 250, -1);
    await live.post('/travel', destination);
    await live.restartCoordinator();
    await arrived(live, [W, P], destination);
    expect(hunt(await live.state())).toBeFalsy();
    await evidence(live, info, 'hunt-off-manual-ownership', { destination });
  });

  for (const joining of [true, false]) {
  test(`Hunt off ${joining ? 'as soon as the leader joins' : 'after the party joins'} a real event preserves evacuation without reviving Hunt`, async ({ live }, info) => {
    const encounter = await seedSmallGoobrawl(live);
    await info.attach('goobrawl-initial-encounter', { body: JSON.stringify(encounter), contentType: 'application/json' });
    await party(live);
    await seedQuest(live, 'goo', 30);
    await start(live);
    await live.post('/formation', { character: W, eventSelections: ['goobrawl'] });
    await live.admin(`events.goobrawl=true;delete timers.goobrawl;output=true`);
    await expect.poll(async () => { const state=await observed(live);return (joining ? [W] : [W,P]).every(name=>state[name].map==='goobrawl'); }, { timeout: 90_000 }).toBe(true);
    const atCancellation = await observed(live);
    await live.post('/farming-mode', { character: W, mode: 'default' });
    // Cancelling Hunt must preserve the already-authorized party event entry.
    await expect.poll(async () => { const state=await observed(live);return [W,P].every(name=>state[name].map==='goobrawl'); }, { timeout: 90_000 }).toBe(true);
    const remainingArenaIds:string[]=await live.admin(`output=Object.values(instances.goobrawl.monsters).filter(m=>!m.dead&&m.hp>0).map(m=>String(m.id))`);
    await live.admin(`timers.goobrawl=new Date(0);output=true`);
    // Failure inventory: timer expiry does not remove native survivors. Their
    // real combat can consume the evacuation budget before return is admitted.
    // Observe completion of that distinct native phase before timing transport.
    await expect.poll(async()=>({monsters:await live.admin(`output=Object.values(instances.goobrawl.monsters).filter(m=>!m.dead&&m.hp>0).length`),huntActive:!!hunt(await live.state())}),
      {timeout:120_000,message:'Hunt cancellation must retain native event combat until the remaining arena monsters die'}).toEqual({monsters:0,huntActive:false});
    const nativeCombat=(await Promise.all([W,P].map(name=>live.clients[name].events()))).flat();
    if(remainingArenaIds.length)expect(nativeCombat.some((event:any)=>remainingArenaIds.includes(String(event.data?.id))&&
      (event.event==='death'||event.event==='hit'&&event.data?.kill)),
      'Cancelled Hunt must still kill an observed surviving event monster').toBe(true);
    await info.attach('hunt-off-native-survivor-completion',{body:JSON.stringify({remainingArenaIds,hunt:hunt(await live.state())||null}),contentType:'application/json'});
    await expect.poll(async () => { const state=await observed(live);return [W,P].every(name=>state[name].map==='main'); }, { timeout: 120_000 }).toBe(true);
    expect(hunt(await live.state())).toBeFalsy();
    await evidence(live, info, 'event-exit-with-hunt-off', { joining, atCancellation });
  });
  }

  test.describe('fragile loadout death recovery', () => {
  test.use({loadout:'fragile'});
  test('a real character death is observed and the maintained runtime respawns it', async ({ live }, info) => {
    const fault = await killNativeCharacter(live, W);
    await expect.poll(async () => (await observed(live))[W].rip, { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => { const p=(await observed(live))[W];return !p.rip&&p.hp>0; }, { timeout: 120_000 }).toBe(true);
    await expect.poll(async () => (await live.clients[W].snapshot()).rip,
      {timeout:15_000,message:'The real revival must propagate from the server to the native client'}).toBeFalsy();
    await evidence(live, info, 'real-death-and-respawn', { fault });
  });
  });

  test('a merchant delivery transfers one real item without creating or losing copies', async ({ live }, info) => {
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { deliveries: true } });
    // Failure inventory: zero gold targets add a full native bank deposit after
    // the item transfer, so an unrelated gold run consumes delivery's receipt
    // deadline. Retain the seeded gold for this one-item conservation scenario.
    const initialGold=await observed(live);
    for(const name of [W,M])await live.post('/command',{character:name,type:'gold-target',amount:initialGold[name].gold});
    await info.attach('declared-item-delivery-gold-targets',{body:JSON.stringify([W,M].map(name=>({name,gold:initialGold[name].gold}))),contentType:'application/json'});
    await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(M)});p.items[10]={name:'helmet',level:0};cache_player_items(p);resend(p,'u+cid+reopen');return p.items[10]})()`);
    await expect.poll(async () => (await live.state()).characters[M]?.items?.some((entry: any) => entry?.slot===10 && entry.item?.name==='helmet'), { timeout: 20_000 }).toBe(true);
    const before=await observed(live), total=names.reduce((sum,name)=>sum+quantity(before[name].items,'helmet'),0);
    const serviceStartedAt=Date.now(),gold=names.reduce((sum,name)=>sum+before[name].gold,0);
    await live.post('/command', { character:M,type:'give',target:W,slot:10,item:{name:'helmet',level:0} });
    await expect.poll(async()=>quantity((await observed(live))[W].items,'helmet'),{timeout:120_000}).toBe(quantity(before[W].items,'helmet')+1);
    const after=await observed(live);
    expect(names.reduce((sum,name)=>sum+quantity(after[name].items,'helmet'),0)).toBe(total);
    const completed = async () => { const state = await live.state(); return !state.merchantCurrent && !state.merchantQueue?.length && !state.merchantDeliveries?.[W]?.length; };
    await expect.poll(completed, { timeout: 30_000, message: 'The actual delivery must complete its durable job' }).toBe(true);
    expect((await live.state()).merchantActivity.some((entry:any)=>entry.at>=serviceStartedAt&&entry.message==='Entered bank'),
      'An item-only delivery with no bank cargo or surplus gold must not add a bank return leg').toBe(false);
    expect(names.reduce((sum,name)=>sum+after[name].gold,0)).toBe(gold);
    await live.restartCoordinator();
    await expect.poll(completed, { timeout: 30_000 }).toBe(true);
    const restored=await observed(live);
    expect(names.reduce((sum,name)=>sum+quantity(restored[name].items,'helmet'),0)).toBe(total);
    await evidence(live,info,'conserved-live-delivery',{before,after});
  });
});
