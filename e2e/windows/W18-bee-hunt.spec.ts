import {expect, type LiveGame} from '../live-fixtures';
import type {Request, Response} from '@playwright/test';
import {liveWindow, type LiveWorld} from '../windows';
import {zones, contains} from '../../runtime/hunting/zones';
import type {PlanRequest, PlanResult} from '../../runtime/movement/geometry/contracts';
import {warrior as W, priest as P, fighters, world, tokens, profile, party, quests, location, start, artifact} from '../game/hunt-lifecycle';

// W18 Bee Hunt: far spawn and incident spot (test-windows DESIGN.md 2.2 W18). One play on the
// fragile loadout, whose ordinary walking speed the incident's detour needs
// (live-hunt-town-recovery.spec.ts:6-9). The priest equips Ice Skates and the bees turn peaceful;
// both fighters walk to the Bee incident spot at Main (520, 710) and take completed bee quests
// with that spawn preferred; the Hunt returns them to Daisy, the warrior's Town lands in town and
// the priest's Town is held until then and stopped mid-cast, so the priest walks out round the
// obstacle and home, and both claim (H53). The player turns the Hunt off; then the warrior
// prefers the bee spawn farthest from where it stands, both take a 1000-bee quest and the party
// Hunts and farms there (H25).
// H53 comes first: its arrival wait needs both fighters without a quest
// (live-hunt-town-recovery.spec.ts:62), and its claim leaves the party at Daisy with none.
// Failure modes: H53, the interrupted cast gets another Town step, a valid detour burns recovery
// attempts as false rendezvous failures, or the stranded member waits forever; H25, the Hunt goes
// to the nearest spawn, never farms or kills there, or the walk never visits the preferred area.
// Each check's assertions are its old test's, with their messages, so the coverage ledger matches
// them. A failed step records its message under its check and the play goes on.
// Every old spec this window cites is at 21fe30a2b.
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
const step = async (id: string, run: () => Promise<unknown>) => {
  try { await run(); return true; } catch (error) { failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); return false; }
};

// H53 (live-hunt-town-recovery.spec.ts). The 30 s progress-timeout assertion at :215 is gone
// (DESIGN.md 4.3 H53: a removed mechanism).
async function partialTownFailure({live, info}: LiveWorld) {
  await location(live, 'bee');
  const equipmentSeed = await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(P)});if(p.items[10])throw Error('Occupied equipment seed slot');p.items[10]={name:'iceskates',level:0};cache_player_items(p);resend(p,'reopen+cid');return {slot:10,item:p.items[10],previousShoes:p.slots.shoes,speed:p.speed}})()`);
  await expect.poll(() => live.clients[P].run('character.items[10]?.name')).toBe('iceskates');
  const equipReceipt = await live.clients[P].run('(async()=>({result:await equip(10),shoes:character.slots.shoes,speed:character.speed}))()');
  await expect.poll(() => live.admin(`output=get_player(${JSON.stringify(P)}).slots.shoes?.name`)).toBe('iceskates');
  const equipmentStats = await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(P)}),warcry=p.s.warcry||null,definition=G.conditions.warcry;
    const active=!!warcry&&Number(warcry.ms)>0;
    if(active&&(!Number.isFinite(definition?.speed)||definition.speed<0))throw Error('Unknown native War Cry speed definition');
    return {shoes:p.slots.shoes,speed:p.speed,hp:p.hp,max_hp:p.max_hp,warcry,warcryDefinition:definition,
      baselineSpeed:p.speed-(active?definition.speed:0)}})()`);
  expect(equipmentStats.baselineSpeed).toBeLessThanOrEqual(40);
  expect(equipmentStats.baselineSpeed).toBeGreaterThan(0);
  await info.attach('town-native-iceskates-equipment', { body: JSON.stringify({ equipmentSeed, equipReceipt, equipmentStats,
    rationale: 'Native Ice Skates have baseline speed <=40; subtract only an active native War Cry speed bonus for this equipment assertion. Retain actual speed and buff definition: maintained War Cry can temporarily accelerate the real walk. The pinned2561-unit full walk at40speed takes about64s, under120s absolute bound.' }), contentType: 'application/json' });
  const candidates = zones((await live.state(true)).monsterChoices, ['bee']).filter(area => area.map === 'main');
  // Native 15555 Bee boundary [448,694,592,812] contains the incident's
  // Main(520,710) origin. Returning on foot must detour southeast first.
  const destination = candidates.find(area => contains(area, { map: 'main', x: 520, y: 710 }, 0));
  expect(destination).toBeTruthy();
  if (!destination) throw new Error('Pinned native Bee incident area is unavailable');
  // The bees stay peaceful through H25's farm too, which the fragile loadout would not survive
  // otherwise; the undo puts their definition back.
  const peacefulBees = await live.admin(`output=(()=>{
    const original=globalThis.__e2eHuntRareOriginal||={};
    original.bee||=JSON.parse(JSON.stringify(G.monsters.bee));
    const monsters=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})).filter(m=>m.type==='bee');
    const before=monsters.map(m=>({id:m.id,aggro:m.aggro,aa:m.aa,rage:m.rage,target:m.target}));
    Object.assign(G.monsters.bee,{aggro:0,aa:0,rage:0});
    for(const m of monsters)Object.assign(m,{aggro:0,aa:0,rage:0,target:null});
    return {original:original.bee,monsters:before};
  })()`);
  live.undo('the peaceful bees', () => live.admin(`output=(()=>{
      const original=globalThis.__e2eHuntRareOriginal?.bee;
      if(!original)return false;
      Object.assign(G.monsters.bee,original);
      for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))
        if(m.type==='bee')Object.assign(m,{aggro:original.aggro,aa:original.aa,rage:original.rage});
      delete globalThis.__e2eHuntRareOriginal.bee;
      if(!Object.keys(globalThis.__e2eHuntRareOriginal).length)delete globalThis.__e2eHuntRareOriginal;return true;
    })()`));
  await info.attach('town-initial-peaceful-bees', {body:JSON.stringify(peacefulBees),contentType:'application/json'});
  // Reach this region with real native navigation before assigning the
  // initially completed quests. This scenario covers return recovery, not kills.
  for (const character of fighters) await live.post('/command', {
    character, type: 'character-travel', location: { map: 'main', x: 520, y: 710 }, label: 'Native Town recovery incident origin',
  });
  await expect.poll(async () => {
    const current = await world(live);
    return fighters.every(name => !current[name].quest && contains(destination, current[name], 0));
  }, { timeout: 150_000, message: 'Both native fighters must reach the incident Bee region before quest setup' }).toBe(true);
  await party(live);
  await live.post('/hunt-settings', { character: W, preferredSpawns: { bee: JSON.stringify([destination.map, destination.x, destination.y]) } });
  await quests(live, info, { [W]: { id: 'bee', count: 0 }, [P]: { id: 'bee', count: 0 } });
  const before = await world(live);
  await info.attach('town-recovery-native-movement-stats', {
    body: JSON.stringify(await live.admin(`output=Object.fromEntries(['${W}','${P}'].map(name=>{const p=Object.values(players).find(p=>p.name===name);return [name,{speed:p.speed,map:p.map,x:p.x,y:p.y,hp:p.hp,max_hp:p.max_hp}]}))`)),
    contentType: 'application/json',
  });
  // Withhold genuine Town requests (including native retries) until the leader
  // arrives. Preserve every packet and bound this transport fault.
  await live.clients[P].run(`(() => {
    const socket = parent.socket, emit = socket.emit;
    const fault = globalThis.__e2eTownFault = { delayed: false, released: false, events: [], generation:globalThis.__partyRuntimeGeneration };
    const origin={map:character.map,x:character.real_x,y:character.real_y};
    const pending = [];
    let timer;
    fault.release = reason => {
      if (fault.released) return;
      fault.armed = reason === 'authoritative-leader-town-arrival';
      fault.released = true; clearTimeout(timer);
      for (const packet of pending.splice(0)) {
        fault.events.push({ event: 'town-request-forwarded', reason, at: Date.now() });
        emit.apply(socket, packet);
      }
    };
    socket.emit = function(event, ...args) {
      if (event === 'town' && !fault.released) {
        pending.push([event, ...args]);
        fault.events.push({ event: 'town-request-delayed', at: Date.now(), queued: pending.length });
        if (!fault.delayed) timer = setTimeout(() => fault.release('bounded-gate-expired'), 30000);
        fault.delayed = true;
        return socket;
      }
      if (event === 'town') fault.events.push({ event: 'native-town-request', at: Date.now() });
      return emit.apply(socket, [event, ...args]);
    };
    // Observe the real server cast in the client: an external round trip can
    // miss the entire window if normal healing interrupts it first.
    const onPlayer = data => {
      if (!fault.armed || fault.interruption || !data.c?.town) return;
      fault.interruption = {map:data.map || character.map,x:data.x,y:data.y,casting:true,nativeTown:data.c.town,at:Date.now()};
      stop('town');
      fault.events.push({event:'native-stop-town',...fault.interruption});
    };
    socket.on('player', onPlayer);
    fault.restore = () => { fault.release('fixture-cleanup'); socket.off('player', onPlayer); socket.emit = emit; };
    return true;
  })()`);
  const plans: unknown[] = [];
  const planResponses: { url: string; request?: PlanRequest & { character?: string }; status?: number; body?: Partial<PlanResult>; error?: string }[] = [];
  const pendingResponses: Promise<void>[] = [];
  const context = live.clients[W].page.context();
  const observePlan = (request: Request) => {
    if (request.method() === 'POST' && /movement.*plan|pathfind|\/plan(?:\?|$)/.test(new URL(request.url()).pathname)) {
      try { plans.push({ url: request.url(), body: request.postDataJSON() }); } catch { /* non-JSON native request */ }
    }
  };
  const observeResponse = (response: Response) => {
    if (new URL(response.url()).pathname !== '/party-api/movement-plan') return;
    pendingResponses.push((async () => {
      try { planResponses.push({ url: response.url(), request: response.request().postDataJSON(), status: response.status(), body: await response.json() }); }
      catch (error) { planResponses.push({ url: response.url(), error: String(error) }); }
    })());
  };
  context.on('request', observePlan);
  context.on('response', observeResponse);
  let split: Awaited<ReturnType<typeof world>>;
  let interruption: {at:number;map:string;x:number;y:number;casting:boolean};
  const recoveryPositions: { at: number; map: string; x: number; y: number; distanceFromTown: number; ownedWalking: boolean }[] = [];
  let ownedWalking = false;
  const recoveryStates: { at: number; id?: string; phase?: string; attempts: number; failure?: string; code?: string; message?: string }[] = [];
  const recordRecoveryState = async () => {
    const state = await live.state(), convoy = state.activeConvoy;
    const status = state.characters[P], report = status?.convoyNavigation, expected = convoy?.expected?.[P];
    ownedWalking = !!convoy?.returnTownRally && !!convoy?.disableTown && convoy.phase !== 'communication-hold' &&
      report?.id === convoy.id && report?.epoch === convoy.epoch && !!expected &&
      report.commandId === expected.commandId && report.navigationRevision === expected.revision &&
      report.runtimeId === expected.runtimeId && status.seenAt >= Date.now() - 3000;
    recoveryStates.push({ at: Date.now(), id: convoy?.id, phase: convoy?.phase, attempts: convoy?.recoveryAttempts || 0,
      failure: convoy?.failure, code: convoy?.failureCode, message: profile(state).monsterHunt?.message });
  };
  const recordRecovery = (current: Awaited<ReturnType<typeof world>>) => {
    const follower = current[P];
    recoveryPositions.push({ at: Date.now(), map: follower.map, x: follower.x, y: follower.y, distanceFromTown: Math.hypot(follower.x, follower.y), ownedWalking });
  };
  try {
    await start(live, W, 'bee');
    await expect.poll(async () => {
      const current = await world(live);
      if (!fighters.every(name => current[name].quest?.id === 'bee' && current[name].quest.c === 0) ||
        current[W].map !== 'main' || Math.hypot(current[W].x, current[W].y) >= 90 ||
        current[P].map !== 'main' || Math.hypot(current[P].x, current[P].y) <= 250) return false;
      split = current;
      return live.clients[P].run(`(() => {
        const fault = globalThis.__e2eTownFault;
        if (!fault.delayed || fault.released) return false;
        fault.release('authoritative-leader-town-arrival'); return true;
      })()`);
    }, { timeout: 180_000, intervals: [50, 100], message: 'Release the genuine follower Town request only after actual leader Town arrival' }).toBe(true);
    await expect.poll(() => live.clients[P].run('!!globalThis.__e2eTownFault.interruption'),
      {timeout:8_000,message:'The client must observe and stop the actual native Town cast'}).toBe(true);
    interruption = await live.clients[P].run('globalThis.__e2eTownFault.interruption');
    recordRecovery(await world(live));
    await info.attach('partial-town-native-fault', { body: JSON.stringify({ split, interruption }), contentType: 'application/json' });
    // Native melee/follow positioning can finish slightly outside the spawn edge.
    // Initial arrival is strictly inside; the measured outward detour below
    // independently proves this return still crosses the incident's obstacle.
    expect(contains(destination, split![P], 100), 'The interrupted follower must remain near the actual incident Bee region').toBe(true);
    await expect.poll(async () => {
      await recordRecoveryState();
      recordRecovery(await world(live));
      const convoy = (await live.state()).activeConvoy;
      return !!convoy?.disableTown && !!convoy?.returnTownRally && !!convoy?.returnTown?.walking;
    }, { timeout: 20_000, intervals: [100, 250], message: 'Real interrupted cast must select a walking Town rally' }).toBe(true);
    const recovery = (await live.state()).activeConvoy;
    const huntCycle = profile(await live.state()).monsterHunt.cycleId;
    expect(recovery.returnTownRally).toMatchObject({ map: 'main', x: 0, y: 0 });
    await recordRecoveryState();
    await expect.poll(async () => {
      await recordRecoveryState();
      const currentWorld = await world(live);
      recordRecovery(currentWorld);
      const current = currentWorld[P];
      return current.map === 'main' && Math.hypot(current.x, current.y) > Math.hypot(split![P].x, split![P].y) + 100;
    }, { timeout: 45_000, intervals: [500, 1000], message: 'The stranded native follower must actually walk outward around the obstacle' }).toBe(true);
    await expect.poll(async () => {
      await recordRecoveryState();
      const current = await world(live);
      recordRecovery(current);
      return fighters.every(name => tokens(current[name]) === tokens(before[name]) + 1);
    }, { timeout: 150_000, intervals: [500, 1000], message: 'Both completed native quests must reach Daisy and receive one reward' }).toBe(true);
    const final = await world(live);
    const finalState = await live.state();
    const recoveryHistory = (finalState.combatLogs?.[W] || []).filter((entry: any) =>
      entry.details?.convoyId === recovery.id && entry.at >= recoveryPositions[0]!.at);
    expect(recoveryHistory.filter((entry: any) => /rendezvous.*(no progress|timed out)/i.test(entry.details?.reason || '')),
      'Valid walking detours must not consume recovery attempts through false rendezvous failures').toEqual([]);
    expect(recoveryStates.filter(sample => sample.id === recovery.id).every(sample => sample.attempts <= (recovery.recoveryAttempts || 0)),
      'The initial interrupted Town may recover, but subsequent real walking must not exhaust generic retry budget').toBe(true);
    expect(Math.max(...recoveryPositions.map(position => position.distanceFromTown)),
      'The actual native walking route must first take the follower farther from Town').toBeGreaterThan(Math.hypot(split![P].x, split![P].y) + 100);
    const nativeTownRequests = await live.clients[P].run('globalThis.__e2eTownFault.events.filter(event => event.event === "native-town-request")');
    const townEligibility = recoveryHistory.filter((entry: any) => entry.message === 'Convoy Aggro clear; Town eligible');
    if (nativeTownRequests.length) {
      expect(townEligibility.some((entry: any) => entry.at >= interruption.at && entry.at <= nativeTownRequests[0].at),
        'A later native Town request requires an explicit coordinator eligibility transition after the interruption').toBe(true);
    }
    // Upstream sets last.town only when the real cast finishes and transports.
    const nativeTownCompletedAt = await live.admin(`output=Number(get_player(${JSON.stringify(P)}).last.town)||null`);
    const completedRecoveryTown = nativeTownCompletedAt >= interruption.at;
    if (completedRecoveryTown) expect(nativeTownRequests.length, 'A completed native Town must have its genuine socket request in the ledger').toBeGreaterThan(0);
    const recoveryMethod = completedRecoveryTown ? 'walking followed by explicitly eligible native Town' : 'walking';
    await Promise.all(pendingResponses);
    const walkingRallies = planResponses.filter(result => result.request?.character === P &&
      result.request.town === false && result.request.to.map === 'main' &&
      Math.hypot(result.request.to.x, result.request.to.y) < 1);
    expect(walkingRallies.length, 'Recovery must request a real walking-only Town rally route').toBeGreaterThan(0);
    expect(walkingRallies.some(result => result.status === 200 && !!result.body?.plot?.length),
      'The native client must receive a successful walking rally plan').toBe(true);
    for (const result of walkingRallies.filter(result => result.status === 200))
      expect(result.body!.plot!.every(step => !step.town && step.method !== 'town'),
        'A walking fallback must never receive another Town warp').toBe(true);
    expect(fighters.every(name => final[name].map === 'main')).toBe(true);
    expect(profile(await live.state()).monsterHunt?.message || '').not.toContain('Waiting for fresh Main town arrival');
    // The blocked return finished once the block lifted (both rewards above),
    // and no sample held it for the player's Retry (the turn-in climbs its ladder).
    expect(recoveryStates.filter(sample => /Daisy return held|request Retry return/.test(String(sample.message || ''))),
      'a Daisy return held for Retry').toEqual([]);
    reads.H53 = {split: split!, interruption, recovery: recovery?.id, huntCycle, recoveryMethod, nativeTownRequests: nativeTownRequests.length};
    await artifact(live, info, 'partial-town-native-reunion-and-rewards', { before, destination, split, interruption, recovery, huntCycle, plans, planResponses, recoveryPositions, recoveryStates, recoveryHistory, recoveryMethod, nativeTownRequests, nativeTownCompletedAt, townEligibility });
  } finally {
    context.off('request', observePlan);
    context.off('response', observeResponse);
    await Promise.all(pendingResponses);
    // The fault comes off the priest's page here, so H25's walk runs on the native socket.
    const faults = await live.clients[P].run(`(() => { const fault = globalThis.__e2eTownFault; if (!fault) return null; fault.restore(); delete globalThis.__e2eTownFault; return fault.events; })()`).catch(error => ({ error: String(error) }));
    await info.attach('town-fault-and-planner-requests', { body: JSON.stringify({ faults, plans, planResponses, recoveryPositions, recoveryStates }), contentType: 'application/json' });
  }
}

// H25 (live-hunt-lifecycle.spec.ts). The restart between the preference and the Hunt is gone
// (DESIGN.md 4.3 H25: preferredSpawns persistence is a unit row), so the preference is read back
// before the Hunt starts.
async function preferredSpawn({live, info}: LiveWorld) {
  await party(live);
  await location(live, 'bee');
  const initial = (await world(live))[W];
  const choices = zones((await live.state(true)).monsterChoices, ['bee']).filter(area => area.map === initial.map)
    .sort((a, b) => Math.hypot(a.x-initial.x, a.y-initial.y)-Math.hypot(b.x-initial.x, b.y-initial.y));
  expect(choices.length, 'Preference must override the default nearest spawn').toBeGreaterThan(1);
  const destination = choices[choices.length-1]!, key = JSON.stringify([destination.map, destination.x, destination.y]);
  await live.post('/hunt-settings', { character: W, preferredSpawns: { bee: key } });
  expect(profile(await live.state()).huntSettings.preferredSpawns.bee).toBe(key);
  await quests(live, info, { [W]: { id: 'bee', count: 1000 }, [P]: { id: 'bee', count: 1000 } });
  await live.clients[W].run(`(()=>{const observation={positions:[],timer:null};globalThis.__e2ePreferredSpawnPositions=observation;
    observation.timer=setInterval(()=>{observation.positions.push({map:character.map,x:character.real_x,y:character.real_y});
      if(observation.positions.length>3000)observation.positions.shift();},100);return true;})()`);
  try{
  await start(live, W, 'bee');
  await expect.poll(async () => profile(await live.state()).monsterHunt?.stage, { timeout: 120_000 }).toBe('farming');
  const countAtArrival = (await world(live))[W].quest.c;
  await expect.poll(async () => (await world(live))[W].quest.c, { timeout: 90_000 }).toBeLessThan(countAtArrival);
  const mission = profile(await live.state()).monsterHunt.missions[0].destination;
  expect(JSON.stringify([mission.map, mission.x, mission.y])).toBe(key);
  const actual = (await world(live))[W];
  expect(actual.map).toBe(destination.map);
  const positions=await live.clients[W].run('globalThis.__e2ePreferredSpawnPositions.positions');
  expect(positions.some((point:any)=>point.map===destination.map&&contains(destination,point,120)),
    'The actual native journey must visit the configured preferred area').toBe(true);
  reads.H25 = {destination: {map: destination.map, x: destination.x, y: destination.y}, key, countAtArrival, mission: [mission.map, mission.x, mission.y]};
  await artifact(live, info, 'preferred-spawn-native-combat', { destination, key });
  }finally{
    const positions=await live.clients[W].run(`(()=>{const observation=globalThis.__e2ePreferredSpawnPositions;
      if(!observation)return [];clearInterval(observation.timer);delete globalThis.__e2ePreferredSpawnPositions;return observation.positions;})()`);
    // The Hunt's mission and its route recovery name why the mission left the preferred spawn: the
    // closing run's H25 took the nearest other spawn after two refused route publications.
    const hunt=profile(await live.state()).monsterHunt;
    await info.attach('preferred-spawn-native-position-history',{body:JSON.stringify({destination,key,positions,
      hunt:hunt?{stage:hunt.stage,missions:hunt.missions,routeRecovery:hunt.routeRecovery}:null}),contentType:'application/json'});
  }
}

async function beeHuntPlay(world: LiveWorld) {
  await step('H53', () => partialTownFailure(world));
  // The player turns the first Hunt off before choosing the far spawn.
  await endHunt(world.live);
  await step('H25', () => preferredSpawn(world));
  await endHunt(world.live);
}
const endHunt = (live: LiveGame) => live.post('/farming-mode', { character: W, mode: 'default' });

const own = (id: string, owner: string) => ({
  owner, behaviours: [], start() {}, reads: () => ({failed: failed[id] ?? null, reads: reads[id] ?? null}),
  verdict() { expect(failed[id], `${id}: every step of the play passes`).toBeUndefined(); },
});

liveWindow({
  id: 'W18', name: 'Bee Hunt: far spawn and incident spot',
  // The old tests' bounds summed: H53 420 s (live-hunt-town-recovery.spec.ts) + H25 300 s
  // (live-hunt-lifecycle.spec.ts describe).
  timeoutMs: 720_000,
  use: {loadout: 'fragile'},
  play: beeHuntPlay,
  observers: [{id: 'H53', ...own('H53', 'movement')}, {id: 'H25', ...own('H25', 'hunting')}],
});
