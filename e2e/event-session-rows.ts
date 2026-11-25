// One event session per window (test-windows DESIGN.md 2.2 W25-W39): the party stays in the one
// world for the whole play, and each round starts where the round before it left the party. In
// W25 and W26 the staging round saves the checkpoint every later return reads, its boss dies in
// combat, the next boss carries its native threshold adds, and the return the staging round's
// check reads runs from a later boss that is still alive at the deselection. A round that needs
// another start point gets there by a player travel command, never a reset.
// Two checks share one round where one walk or fight serves both. Rounds stay apart where the
// behaviours need different states (DEVIATIONS.md "Live B"): an empty advertised point against a
// boss beside the walk, a member in the walk at its death against one dead before admission, one
// refused plan against every plan refused, a restart that keeps the walk against one that
// replaces it.
import {observeNativeNavigationHttp} from './native-navigation-http-observer';
import {installTerminalSettlementFault} from './native-terminal-settlement-fault';
import {observeNativePlanner} from './native-planner-observation';
import {isolateNativeMapAmbient, restoreNativeMapAmbient} from './native-map-ambient-isolation';
import {expect, type LiveGame, reloadCode} from './live-fixtures';
import {killNativeCharacter} from './hunt-interruption-helpers';
import {announceSpawn, nativeEventSpawn} from './game/event-spawn';
import {fighters, halloweenCleanup, halloweenRestore, prepare, spawn, world, STAGING_WAIT_MS, W, P} from './halloween-rows';
import {admissionDeathPlay, clearRecoveryGreen, newlyVisibleBossPlay, respawnCatchupPlay, seedRecoveryGreen} from './event-recovery-rows';
import {codeTurnoverPlay, eventLimitsPlay, failedEntryPlay, fixedEndTimerPlay, focusChangePlay, retiredExitPlay} from './event-recovery-rows';
import {arenaReconnectPlay, entryFailurePlay} from './event-entry-rows';
import {eventOverridePlay} from './event-override-rows';
import {followerBossPlay} from './convoy-event-defense-rows';
import {e1Row} from './user-holds-rows';
import {cantJoinRow, up1Row} from './event-death-rejoin-rows';
import {pretravelPlay} from './pretravel-rows';
import {cipherEarlyBrewPlay, cipherHuntPlay, cipherMerchantPlay, cipherPriorityPlay, gargoylePlay, horsemanWalkPlay, horsemanWavesPlay} from './october-rows';
import {prepareHunt, start, cycle} from './game/hunt-lifecycle';
import {quantity, world as huntEventsWorld} from './game/hunt-events';
import {hostOfflinePlay} from './merchant-event-rows';
import {stagingSlicePlay} from './anniversary-staging-rows';
import {unjoinedHorsemanPlay} from './october-additions-rows';
import {absentSpawnPlay} from './halloween-rows';
import {goobrawlPlay, goobrawlRows} from './live-game-rows';
import {eventsHooksPlay} from './events-hooks-rows';
import {tasksHooksPlay} from './tasks-hooks-rows';
import {huntOffEventPlay} from './goobrawl-hunt-off-rows';
import {endSmallGoobrawl} from './game/event-scenario';
import {eventScrub, walkUntil} from './event-window-helpers';
import {cipherIngredients} from '../runtime/events/october';
import type {Page, Route, TestInfo} from '@playwright/test';

type Point = {map: string; x: number; y: number};
type Checkpoint = Awaited<ReturnType<typeof prepare>>;
type Encounter = Point & {id: string};

// The Halloween checkpoint the old walk tests started from (live-fixtures.ts halloween start).
export const halloweenCheckpoint = {map: 'halloween', x: -550, y: -290};
// A cross-map walk between the event maps takes the 150 s the old empty-hint and admission plays
// gave theirs (event-recovery-rows.ts), the longest of these plays' own walk bounds.
const WALK_MS = 150_000;
// A return ends within the staging round's own deadline for Mr. Green, 240 s
// (halloween-rows.ts stagingRoundPlay).
const RETURN_MS = 240_000;

// The player sends the party to a point; the round waits until both stand there with no walk. The
// walk progress rule bounds the wait (walk-progress.ts), since a walk after a respawn starts in
// Town and outlasts any one fixed bound (W39 run liveb-step10-run1.log: 150 s ran out on Main).
export async function travelTo(live: LiveGame, to: Point) {
  await live.post('/travel', to);
  await walkUntil(live, fighters, async () => {
    const s = await live.state(); if (s.activeConvoy) return false;
    return live.admin(`output=${JSON.stringify(fighters)}.every(name=>{const p=get_player(name);return p.map===${JSON.stringify(to.map)}&&!p.moving&&Math.hypot(p.x-(${to.x}),p.y-(${to.y}))<65;})`);
  }, `The player's travel must bring both fighters to ${to.map} (${to.x}, ${to.y})`);
}

// A round's planted boss ends with the round: the next round plants its own, and a boss left alive
// would be the one the party fights there.
export async function clearPlanted(live: LiveGame, types: string[]) {
  await live.admin(`output=(()=>{const types=${JSON.stringify(types)},removed=[];
    for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(m.temp&&types.includes(m.type)){removed.push(String(m.id));remove_monster(m,{silent:true});}
    for(const t of types)delete E[t];broadcast_e();return removed;})()`);
  // Removing a boss the party attended ends its occurrence, and the round's end starts an event
  // return about 1 s later. The next round waits for the attendance to end and for that return,
  // so its travel and plants never run beside it (W30a's E21 checkpoint did, closing-3 pair run).
  await expect.poll(async () => {
    const attendance = (await live.state()).eventAttendance ?? {};
    return fighters.every(n => types.every(t => !attendance[n]?.[t] || attendance[n][t].ended));
  }, {timeout: RETURN_MS, message: `The attendance of ${types.join(', ')} must end once its boss is removed`}).toBe(true);
  await settle(live);
}

// A deselection's return ends before the next round starts its walk.
export async function settle(live: LiveGame) {
  await expect.poll(async () => {
    const s = await live.state();
    return !s.eventReturn && !s.activeConvoy && fighters.every(n => s.characters[n] && !s.characters[n].rip);
  }, {timeout: RETURN_MS, message: 'The deselected event return must end before the next round'}).toBe(true);
}

// The staging round (E4, E5 first half): the boss is announced 55 s ahead, the party stages at its
// spawn, the coordinator restarts during staging, the boss is seeded at the spawn time, the
// warrior is killed after the first damage and comes back to hit it. The boss stays alive for the
// return that follows.
async function stagingRound(live: LiveGame, info: TestInfo, id: string) {
  const encounter = {id, ...await nativeEventSpawn(live.admin, id)};
  const timer = await announceSpawn(live, encounter.id, 55000);
  await info.attach('declared-native-spawn-announcement', {body: JSON.stringify(timer), contentType: 'application/json'});
  const savedCheckpoint = await prepare(live, encounter.id);
  await info.attach('native-pre-event-checkpoint-receipt', {body: JSON.stringify(savedCheckpoint), contentType: 'application/json'});
  await expect.poll(async () => {
    const state = await live.state();
    return fighters.every(name => state.characters[name]?.joinedEvent === encounter.id &&
      state.characters[name]?.serverStagingEvents?.some((event: any) => event.name === encounter.id));
  }, {timeout: STAGING_WAIT_MS, message: 'Both real clients must attend the announced boss before it is live'}).toBe(true);
  await expect.poll(async () => {
    const native = await world(live, encounter.id);
    return !native.boss && fighters.every(name => native.players[name] && Math.hypot(native.players[name].x - encounter.x, native.players[name].y - encounter.y) < 80);
  }, {timeout: 35_000, message: 'Staging must actually walk to the fixed native spawn region'}).toBe(true);
  await live.restartCoordinator();
  await expect.poll(async () => (await live.state()).characters[W]?.joinedEvent, {timeout: 20_000}).toBe(encounter.id);
  await expect.poll(() => Date.now() >= Date.parse(timer.spawn), {timeout: 60_000}).toBe(true);
  expect((await live.state()).eventReturn, 'Ten seconds of non-live staging must not retire attendance').toBeFalsy();
  const seeded = await spawn(live, encounter.id, encounter.map, encounter.x, encounter.y);
  await info.attach('native-halloween-encounter-seed', {body: JSON.stringify(seeded), contentType: 'application/json'});
  await expect.poll(async () => (await world(live, encounter.id)).boss?.hp, {timeout: 60_000}).toBeLessThan(seeded.hp);
  const death = await killNativeCharacter(live, W);
  await expect.poll(async () => {
    const native = await world(live, encounter.id), state = await live.state();
    const packets = await live.clients[W].events();
    const dead = packets.find((entry: any) => entry.at >= death.at && entry.event === 'player' && entry.data?.rip && entry.data?.hp === 0);
    const respawn = dead && packets.find((entry: any) => entry.at > dead.at && entry.event === 'player' && !entry.data?.rip && entry.data?.hp > 0);
    const reentryHit = respawn && packets.some((entry: any) => entry.at > respawn.at && entry.event === 'hit' &&
      String(entry.data?.id) === String(seeded.id) && entry.data?.hid === W && entry.data?.damage > 0);
    return native.players[W] && !native.players[W].rip && native.players[W].map === encounter.map && state.characters[W]?.joinedEvent === encounter.id && reentryHit;
  }, {timeout: 180_000, message: 'Native death must preserve event reentry instead of losing the saved activity'}).toBe(true);
  await info.attach('native-halloween-death-and-reentry', {body: JSON.stringify({death, native: await world(live, encounter.id), coordinator: await live.state()}), contentType: 'application/json'});
  return {encounter, savedCheckpoint};
}

// The threshold round (E1, E2): with the event selected again, the next boss carries its native
// add spawns, and the party attacks an add at each threshold, resumes the boss, kills it and loots
// the add drop. The round ends with the deselection.
async function thresholdRound(live: LiveGame, info: TestInfo, encounter: {id: string; add: string; drop: string; map: string; x: number; y: number}) {
  const ledgers: any[] = [];
  const observedHits = new Map<string, any>();
  const attacks: any[] = [];
  const issuedPackets = new Map<string, {at: number; actor: string; id: string; sequence: number}>();
  let scenarioError: unknown;
  const attackStartedAt = Date.now();
  const before = await live.admin(`output=${JSON.stringify(fighters)}.map(name=>({name,items:get_player(name).items}))`);
  await live.admin(`output=(()=>{
    globalThis.__e2eThresholdAdds=[];
    const original=new_monster;globalThis.__e2eAddSpawner=original;
    new_monster=function(...args){const m=original.apply(this,args);
      if(m&&m.type===${JSON.stringify(encounter.add)}&&m.master){
        if(globalThis.__e2eHalloweenDeclared?.[String(m.master)])
          globalThis.__e2eHalloweenDeclared[String(m.id)]={type:m.type,map:m.map,master:String(m.master)};
        const boss=instances[m.in]?.monsters[m.master];globalThis.__e2eThresholdAdds.push({id:String(m.id),master:String(m.master),type:m.type,at:Date.now(),bossHp:boss?.hp,bossMaxHp:boss?.max_hp});
      }return m;};return true;})()`);
  try {
    const seed = await spawn(live, encounter.id, encounter.map, encounter.x, encounter.y, true);
    await info.attach('native-threshold-spawn-definition', {body: JSON.stringify(seed), contentType: 'application/json'});
    await expect.poll(async () => {
      const sample = await live.admin(`output=(()=>{const boss=instances[${JSON.stringify(seed.map)}]?.monsters[${JSON.stringify(seed.id)}];return {adds:globalThis.__e2eThresholdAdds,boss:boss?{id:String(boss.id),hp:boss.hp,max_hp:boss.max_hp,map:boss.map,x:boss.x,y:boss.y,target:boss.target||null,points:Object.keys(boss.points||{}),spawns:boss.spawns,last:boss.last}:null}})()`);
      ledgers.push({at: Date.now(), ...sample});
      const selection = await live.state();
      ledgers[ledgers.length - 1].selections = fighters.map(name => ({name, target: selection.characters[name]?.combatSelection?.target}));
      const actorEvents = await Promise.all(fighters.map(name => live.clients[name].events()));
      const events = actorEvents[0];
      for (let index = 0; index < fighters.length; index++) for (const event of actorEvents[index]) {
        const id = String(event.data?.id);
        if (event.event !== 'attack-issued' || event.data?.actor !== fighters[index] || event.at < attackStartedAt || !Number.isFinite(event.sequence) ||
          id !== String(seed.id) && !sample.adds.some((add: any) => add.id === id)) continue;
        const key = JSON.stringify([fighters[index], event.sequence, event.at, id]);
        if (!issuedPackets.has(key) && issuedPackets.size >= 2048) throw Error('Native threshold issued-packet evidence exceeded2048 records');
        issuedPackets.set(key, {at: event.at, actor: event.data.actor, id, sequence: event.sequence});
      }
      attacks.length = 0; attacks.push(...issuedPackets.values());
      for (const event of events) {
        if (event.event === 'hit' && fighters.includes(event.data?.hid) && event.data?.damage > 0 &&
          (String(event.data.id) === String(seed.id) || sample.adds.some((add: any) => String(event.data.id) === add.id)))
          observedHits.set(String(event.data.pid || `${event.at}:${event.data.id}`), event);
      }
      return [0.75, 0.5, 0.25].every(threshold => sample.adds.some((add: any) =>
        add.master === String(seed.id) && add.bossHp / add.bossMaxHp <= threshold && add.bossHp / add.bossMaxHp > threshold - 0.2 &&
        attacks.some(attack => attack.id === add.id && attacks.some(previous => previous.actor === attack.actor &&
          previous.id === String(seed.id) && previous.at < attack.at) &&
          [...observedHits.values()].some((event: any) => String(event.data.id) === add.id && event.data.hid === attack.actor && event.at >= attack.at))));
    }, {timeout: 300_000, intervals: [250, 500], message: 'Native boss damage must spawn and the party must attack adds at each threshold'}).toBe(true);
    const firstAddHit = [...observedHits.values()].filter(event => String(event.data.id) !== String(seed.id)).sort((a, b) => a.at - b.at)[0];
    expect([...observedHits.values()].some(event => String(event.data.id) === String(seed.id) && event.at > firstAddHit.at),
      'Actual party boss damage must resume after a native add engagement').toBe(true);
    await expect.poll(async () => !(await world(live, encounter.id)).boss, {timeout: 180_000}).toBe(true);
    await expect.poll(async () => {
      const items = await live.admin(`output=${JSON.stringify(fighters)}.flatMap(name=>get_player(name).items)`);
      return items.reduce((n: number, item: any) => n + (item?.name === encounter.drop ? (item.q || 1) : 0), 0) >
        before.flatMap((p: any) => p.items).reduce((n: number, item: any) => n + (item?.name === encounter.drop ? (item.q || 1) : 0), 0);
    }, {timeout: 30_000, message: 'Real native add loot must reach party inventory'}).toBe(true);
    await info.attach('native-threshold-add-combat-and-loot', {body: JSON.stringify({seed, before, ledgers, attacks,
      events: await live.clients[W].events(), after: await live.admin(`output=${JSON.stringify(fighters)}.map(name=>({name,items:get_player(name).items}))`), state: await live.state()}), contentType: 'application/json'});
  } catch (error) { scenarioError = error; throw error; }
  finally {
    const cleanupErrors: {step: string; error: string}[] = [];
    const cleanup = async (step: string, action: () => Promise<unknown>) => {
      try { await action(); } catch (error) { cleanupErrors.push({step, error: String(error)}); }
    };
    await cleanup('capture final native threshold evidence', async () => info.attach('native-threshold-observer-final', {body: JSON.stringify({ledgers, attacks, hits: [...observedHits.values()],
      native: await live.admin(`output={adds:globalThis.__e2eThresholdAdds,players:${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return p?{name,present:true,map:p.map,x:p.x,y:p.y,rip:p.rip}:{name,present:false}})}`),
      state: await live.state()}), contentType: 'application/json'}));
    await cleanup('restore native add spawner', () => live.admin(`if(globalThis.__e2eAddSpawner){new_monster=globalThis.__e2eAddSpawner;delete globalThis.__e2eAddSpawner;}output=true`));
    await cleanup('deselect native event', () => live.post('/formation', {character: W, eventSelections: []}));
    if (cleanupErrors.length) {
      await info.attach('native-threshold-cleanup-errors', {body: JSON.stringify({scenarioError: String(scenarioError || ''), cleanupErrors}), contentType: 'application/json'});
      if (!scenarioError) throw Error('Native threshold cleanup failed: ' + JSON.stringify(cleanupErrors));
    }
  }
}

// The return (E4, E5, E6): the player deselects the event with the staged boss alive. On Mr. Green
// the warrior's CODE turns over on the event-exit walk; on Mr. Pumpkin the last completion reply
// is lost. Both walk back to the checkpoint the staging round saved. It runs right after the
// staging round because a player travel saves its own point as the party's location, which then
// replaces that checkpoint.
async function returnRound(live: LiveGame, info: TestInfo, encounter: Encounter, savedCheckpoint: Checkpoint, terminal: boolean) {
  const navigationHttp = encounter.id === 'mrpumpkin' ? observeNativeNavigationHttp(live.clients[W].page) : null;
  const terminalFault = terminal ? await installTerminalSettlementFault(live, live.clients[W].page) : null;
  const returnPhases: {deselectedAt: number; replacementRequestedAt?: number; replacementAcknowledgedAt?: number; recoveryStartedAt: number; recoveryDeadline: number; arrivalObservedAt?: number} = {
    deselectedAt: Date.now(), recoveryStartedAt: Date.now(), recoveryDeadline: 0};
  let returnDeadline = returnPhases.deselectedAt + (encounter.id === 'mrgreen' ? 240_000 : 180_000);
  returnPhases.recoveryDeadline = returnDeadline;
  try {
    await live.post('/formation', {character: W, eventSelections: []});
    if (encounter.id === 'mrgreen') {
      let before: any, after: any;
      const observations: any[] = [];
      try {
        await expect.poll(async () => {
          const state = await live.state(), convoy = state.activeConvoy, warrior = state.characters[W];
          const parent = convoy?.walkingParents?.[W];
          if (convoy?.purpose !== 'shared-walk-return' || convoy.walkingActivity !== 'event-return' ||
            convoy.phase !== 'travel' || parent?.command?.type !== 'event-return-town' ||
            parent.command.cycleId !== state.eventReturn?.cycleId) return false;
          if (!Number.isFinite(warrior?.convoyNavigation?.commandId) || !Number.isFinite(warrior?.lastCommandId) ||
            warrior.convoyNavigation.commandId <= parent.command.id ||
            warrior.lastCommandId <= parent.command.id || warrior?.movement?.progress?.phase !== 'walking') return false;
          before = state; return true;
        }, {timeout: 90_000, message: 'Turn over CODE only during the actual owned event-exit child walk'}).toBe(true);
        returnPhases.replacementRequestedAt = Date.now();
        await reloadCode(live, W);
        await expect.poll(async () => {
          const state = await live.state(), warrior = state.characters[W];
          observations.push({at: Date.now(), recovery: state.eventReturn, warrior});
          if (!warrior || warrior.dashboardRuntime === before.characters[W].dashboardRuntime ||
            Date.now() - warrior.seenAt > 3000) return false;
          const original = before.eventReturn;
          expect(state.eventReturn?.cycleId).toBe(original.cycleId);
          for (const name of fighters) expect(state.eventReturn?.waypoints[name].revision).toBe(original.waypoints[name].revision);
          after = state; returnPhases.replacementAcknowledgedAt = Date.now(); return true;
        }, {timeout: 30_000, message: 'A fresh replacement CODE runtime must retain the original event-return owner'}).toBe(true);
        returnPhases.recoveryStartedAt = returnPhases.replacementAcknowledgedAt!;
        returnDeadline = returnPhases.recoveryDeadline = returnPhases.recoveryStartedAt + 240_000;
      } finally {
        await info.attach('native-green-exit-code-turnover', {body: JSON.stringify({before, after, observations, phases: returnPhases, native: await world(live, encounter.id)}), contentType: 'application/json'});
      }
    }
    if (terminalFault) {
      const proof = await terminalFault.prove(returnDeadline);
      const retired = await terminalFault.finish();
      expect(retired.forwardingErrors, 'Fault transport must drain cleanly before normal checkpoint travel').toEqual([]);
      expect(retired.pendingHeld, 'No completed fault may retain a native request during checkpoint travel').toBe(false);
      await info.attach('native-terminal-settlement-fault-proof', {body: JSON.stringify(proof), contentType: 'application/json'});
    }
    // Each fighter's own native player packet inside 100 of the checkpoint, and the coordinator's
    // return ended. A live boss that targets a fighter there is a party threat, so the resumed farm
    // may leave the point at once: in final-gate-closing12's W26a both stood inside 100 together
    // for under a game second, between the poll's samples, after the Pumpkin took the warrior's taunt.
    const reached = async (name: string) => (await live.clients[name].events()).some((event: any) => event.event === 'player' &&
      event.at >= returnPhases.recoveryStartedAt && event.data?.map === savedCheckpoint.location.map &&
      Math.hypot(event.data.x - savedCheckpoint.location.x, event.data.y - savedCheckpoint.location.y) < 100);
    await expect.poll(async () => (await Promise.all(fighters.map(reached))).every(Boolean) && !(await live.state()).eventReturn,
      {timeout: Math.max(1, returnDeadline - Date.now()), message: 'Deselection must return both actual clients to their saved pre-event checkpoint'}).toBe(true);
    returnPhases.arrivalObservedAt = Date.now();
    const nativeArrivalReceipts = await Promise.all(fighters.map(async name => {
      const events = await live.clients[name].events(), main = events.filter((event: any) => event.event === 'new_map' &&
        event.at >= returnPhases.recoveryStartedAt && event.data?.name === 'main').at(-1);
      const arrival = main && events.find((event: any) => event.event === 'player' && event.at > main.at && event.data?.map === savedCheckpoint.location.map &&
        Math.hypot(event.data.x - savedCheckpoint.location.x, event.data.y - savedCheckpoint.location.y) < 100);
      return {name, main, arrival};
    }));
    await info.attach('halloween-saved-checkpoint-return', {body: JSON.stringify({savedCheckpoint, phases: returnPhases, nativeArrivalReceipts, native: await world(live, encounter.id), coordinator: await live.state()}), contentType: 'application/json'});
  } finally {
    try { await info.attach('native-event-return-phase-timing', {body: JSON.stringify({phases: returnPhases, observedAt: Date.now(), native: await world(live, encounter.id)}), contentType: 'application/json'}); }
    finally {
      try { if (terminalFault) await info.attach('native-terminal-settlement-fault-final', {body: JSON.stringify(await terminalFault.finish()), contentType: 'application/json'}); }
      finally { if (navigationHttp) await info.attach('native-pumpkin-return-http', {body: JSON.stringify(await navigationHttp.finish()), contentType: 'application/json'}); }
    }
  }
}

// The empty-hint round (E29): the player sends both
// fighters to a stale last-seen point far from the spawn, Mr. Green is seeded at its catalog spawn
// with server_info still advertising that point, and both leave the empty point and hit the boss.
async function emptyHintRound(live: LiveGame, info: TestInfo) {
  const hint = {map: 'spookytown', x: 255, y: -1425}, spawn = await nativeEventSpawn(live.admin, 'mrgreen');
  let seed: any; const observations: any[] = [];
  // The walk to the hint and the reacquisition read the event route, not the ambient packs on it.
  const ambient = await isolateNativeMapAmbient(live, 'spookytown');
  await info.attach('empty-hint-native-ambient-input', {body: JSON.stringify(ambient), contentType: 'application/json'});
  try {
    for (const character of fighters) await live.post('/command', {character, type: 'character-travel', location: hint, label: 'Empty-hint journey starting waypoint'});
    // The walk from the staging checkpoint crosses main, the tunnel and Halloween into Spooky Town,
    // so its bound is the progress rule, not a start beside the hint.
    const hintWalk = await walkUntil(live, fighters, async () => live.admin(`output=${JSON.stringify(fighters)}.every(name=>{const p=get_player(name);return p&&!p.rip&&p.map===${JSON.stringify(hint.map)}&&Math.hypot(p.x-(${hint.x}),p.y-(${hint.y}))<30;})`),
      'Both native fighters must reach the empty hint before catalog reacquisition starts');
    await info.attach('empty-hint-walk-progress', {body: JSON.stringify(hintWalk), contentType: 'application/json'});
    seed = await seedRecoveryGreen(live, spawn, hint);
    await expect.poll(() => live.clients[W].run('parent.S.mrgreen && ({map:parent.S.mrgreen.map,x:parent.S.mrgreen.x,y:parent.S.mrgreen.y})'), {timeout: 15_000}).toEqual(hint);
    await live.post('/formation', {character: W, eventSelections: ['mrgreen']});
    await expect.poll(async () => {
      const s = await live.state(); observations.push({at: Date.now(), convoy: s.activeConvoy && {id: s.activeConvoy.id, location: s.activeConvoy.location}, characters: Object.fromEntries(fighters.map(n => [n, {map: s.characters[n]?.map, x: s.characters[n]?.x, y: s.characters[n]?.y, event: s.characters[n]?.joinedEvent}]))}); if (observations.length > 100) observations.shift();
      const events = await live.clients[W].events(); return fighters.every(n => events.some((e: any) => e.event === 'hit' && e.data?.hid === n && String(e.data?.id) === seed.id && e.data?.damage > 0));
    }, {timeout: 150_000, message: 'Both fighters must leave the empty advertised waypoint and hit the actual native boss at its catalog spawn'}).toBe(true);
    const final = await live.state(); expect(final.characters[W].map).toBe(spawn.map);
    expect(await live.clients[W].run('({map:parent.S.mrgreen.map,x:parent.S.mrgreen.x,y:parent.S.mrgreen.y})')).toEqual(hint);
    expect(Math.hypot(final.characters[W].x - hint.x, final.characters[W].y - hint.y)).toBeGreaterThan(500);
    await info.attach('native-empty-last-seen-spawn-recovery', {body: JSON.stringify({hint, spawn, seed, observations, state: await live.state(), events: await live.clients[W].events()}), contentType: 'application/json'});
  } finally {
    try { await live.post('/formation', {character: W, eventSelections: []}).catch(() => {}); await clearRecoveryGreen(live, seed); }
    finally { await info.attach('empty-hint-native-ambient-restored', {body: JSON.stringify(await restoreNativeMapAmbient(live, true)), contentType: 'application/json'}); }
  }
}

// The across-the-wall round (E38): the player sends
// the party across the wall from Mr. Pumpkin, the boss is seeded visible but out of reach and range,
// and the event walk keeps the route until the warrior can attack it.
async function acrossWallRound(live: LiveGame, info: TestInfo) {
  await travelTo(live, {map: 'halloween', x: -200, y: 460});
  const seed = await live.admin(`output=(()=>{
    const original=G.monsters.mrpumpkin;
    try{G.monsters.mrpumpkin={...original,hp:10000000,attack:1,speed:0,charge:0,range:1,aggro:0,spawns:[]};
      const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[-534,763,-534,763]},{temp:1});m.e2eTerrainApproach=true;
      E.mrpumpkin={live:true,map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:m.id,map:m.map,x:m.x,y:m.y};
    }finally{G.monsters.mrpumpkin=original;}})()`);
  let baseline: any, walk: any, endpoint: any;
  try {
    await expect.poll(async () => live.clients[W].frame.evaluate((id) => !!(window as any).entities[id], String(seed.id)), {timeout: 20_000}).toBe(true);
    baseline = await live.clients[W].frame.evaluate((id) => {
      const game = window as any, runner = (document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any, m = game.entities[id];
      return {visible: !!m, position: {map: game.character.map, x: game.character.x, y: game.character.y}, boss: {x: m.x, y: m.y}, direct: runner.can_move_to(m.x, m.y), inRange: runner.is_in_range(m)};
    }, String(seed.id));
    expect(baseline.visible).toBe(true); expect(baseline.direct).toBe(false); expect(baseline.inRange).toBe(false);
    await live.post('/formation', {character: W, eventSelections: ['mrpumpkin']});
    await expect.poll(async () => {
      const s = await live.state(); if (s.activeConvoy?.walkingEvent === 'mrpumpkin') walk = s;
      const events = await live.clients[W].events(); return events.some((e: any) => e.event === 'hit' && String(e.data?.id) === String(seed.id) && fighters.includes(e.data?.hid));
    }, {timeout: 150_000}).toBe(true);
    endpoint = await live.admin(`output=(()=>{const p=get_player('${W}');return {map:p.map,x:p.x,y:p.y};})()`);
    expect(endpoint.map).toBe('halloween');
    expect(Math.hypot(endpoint.x - baseline.position.x, endpoint.y - baseline.position.y)).toBeGreaterThan(100);
    await info.attach('native-visible-boss-terrain-approach', {body: JSON.stringify({seed, baseline, walk, endpoint, final: await live.state(), events: await live.clients[W].events()}), contentType: 'application/json'});
  } finally {
    await live.post('/formation', {character: W, eventSelections: []});
    await live.admin(`output=(()=>{const m=get_monster('mrpumpkin');if(m?.e2eTerrainApproach)remove_monster(m,{silent:true});delete E.mrpumpkin;broadcast_e();return true;})()`);
  }
}

// One walk from the Halloween checkpoint to Mr. Pumpkin for two checks (E26, E41): the warrior's
// first plan to the boss is refused as Town unavailable, the walk falls back to walking, and once
// it walks on Halloween far from the advertised spawn the boss stands beside the warrior. Both must
// attack it there, short of the advertised spawn.
async function refusedEntrySightingRound(live: LiveGame, info: TestInfo) {
  const advertised = {map: 'halloween', x: -495, y: 685}, samples: any[] = [];
  await live.post('/formation', {leader: W});
  await live.post('/formation', {character: P, follow: true});
  const seed = await live.admin(`output=(()=>{const original=G.monsters.mrpumpkin;
    globalThis.__entryRecoveryOriginalPumpkin=original;
    G.monsters.mrpumpkin={...original,hp:100000000,attack:1,speed:0,charge:0,range:1,aggro:0,peaceful:true,spawns:[]};
    const m=new_monster('halloween',{type:'mrpumpkin',count:1,boundary:[-495,685,-495,685]},{temp:1});
    E.mrpumpkin={live:true,id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,max_hp:m.max_hp};broadcast_e();
    return {id:String(m.id),map:m.map,x:m.x,y:m.y};
  })()`);
  const context = live.clients[W].page.context(), requests: any[] = [], unmatched: any[] = [], validationErrors: any[] = [];
  const observer = observeNativePlanner(context);
  const restoreObservation = await observer.install(live.clients[W]);
  let refusals = 0, baseline: any, moved: any, firstHit: any;
  const rejectEntry = async (route: Route) => {
    const req = route.request(), body = req.method() === 'POST' ? req.postDataJSON() : null;
    if (body?.character !== W || body.to?.map !== seed.map || body.to?.x !== seed.x || body.to?.y !== seed.y) return route.fallback();
    const started = Date.now(), state = live.state('fast');
    const observed = await observer.sample(body);
    const sample = {movement: observed?.body.movement, navigation: observed?.body.convoyNavigation};
    const owner = sample.navigation;
    if (sample.movement?.id !== body.id || sample.movement.done || !owner || owner.communication || owner.phase === 'communication-hold' ||
      !String(body.id).startsWith(W + ':' + owner.runtimeId + ':') || Date.now() - started >= 1500) {
      await state; unmatched.push({at: Date.now(), body, owner, elapsedMs: Date.now() - started}); return route.fallback();
    }
    const rejected = refusals === 0;
    if (rejected) {
      refusals++;
      await route.fulfill({status: 409, contentType: 'application/json', body: JSON.stringify({error: 'Town warp currently unavailable'})});
    } else await route.fallback();
    const s = await state;
    const c = s.activeConvoy;
    const expected = c?.expected?.[W];
    if (c?.walkingActivity !== 'event' || c.walkingEvent !== 'mrpumpkin' || owner.id !== c.id || owner.epoch !== c.epoch ||
      owner.commandId !== expected?.commandId || owner.navigationRevision !== expected?.revision || owner.runtimeId !== expected?.runtimeId ||
      body.to?.map !== c.location?.map || body.to.x !== c.location.x || body.to.y !== c.location.y)
      validationErrors.push({at: Date.now(), body, owner, expected, convoy: c?.id, epoch: c?.epoch});
    requests.push({at: Date.now(), body, convoy: c.id, revision: c.walkingParents?.[W]?.revision,
      recoveryAttempts: c.recoveryAttempts, disableTown: c.disableTown, rejected, owner, elapsedMs: Date.now() - started});
  };
  await context.route('**/party-api/movement-plan', rejectEntry);
  try {
    await live.post('/formation', {character: W, eventSelections: ['mrpumpkin']});
    // The walking fallback plans first; the boss then moves beside the warrior while that walk is
    // still on Halloween and more than 400 from the advertised spawn (the old E41 start).
    await expect.poll(async () => {
      const state = await live.state(), native = await live.admin(`output=(()=>{const p=get_player('${W}');return {map:p.map,x:p.x,y:p.y,moving:!!p.moving};})()`), c = state.activeConvoy;
      samples.push({at: Date.now(), stage: 'before-native-displacement', native, convoy: c && {id: c.id, phase: c.phase, event: c.walkingEvent}, attendance: state.eventAttendance?.[W]?.mrpumpkin}); if (samples.length > 96) samples.shift();
      if (requests.some(r => !r.rejected && r.disableTown && r.body.town === false) && c?.walkingEvent === 'mrpumpkin' && c.phase === 'travel' && native.map === 'halloween' && native.moving && Math.hypot(native.x - advertised.x, native.y - advertised.y) > 400) { baseline = {at: Date.now(), native, convoy: c}; return true; }
      return false;
    }, {timeout: 90_000, message: 'The real event route must be walking toward the advertised spawn before introducing the boss'}).toBe(true);
    moved = await live.admin(`output=(()=>{const p=get_player('${W}'),m=instances.halloween.monsters[${JSON.stringify(seed.id)}];
     if(!m)throw Error('Owned live boss missing before displacement');
     const before={x:m.x,y:m.y};m.x=p.x;m.y=p.y;m.going_x=m.x;m.going_y=m.y;m.moving=false;m.abs=true;m.u=true;m.cid++;m.last_jump=new Date();
     E.mrpumpkin={live:true,...${JSON.stringify(advertised)},hp:m.hp,max_hp:m.max_hp};broadcast_e();return {id:String(m.id),map:m.map,x:m.x,y:m.y,before,at:Date.now()};})()`);
    await expect.poll(async () => {
      const state = await live.state(), events = await live.clients[W].events(), native = await live.admin(`output=Object.fromEntries(${JSON.stringify(fighters)}.map(name=>{const p=get_player(name);return [name,{map:p.map,x:p.x,y:p.y,moving:!!p.moving}]}))`);
      const hits = events.filter((packet: any) => packet.event === 'hit' && String(packet.data?.id) === seed.id && packet.data?.damage > 0);
      samples.push({at: Date.now(), convoy: state.activeConvoy && {id: state.activeConvoy.id, phase: state.activeConvoy.phase}, native, hits});
      if (hits.length && !firstHit) firstHit = {at: Date.now(), native, hits};
      return fighters.every(name => hits.some((packet: any) => packet.data.hid === name));
    }, {timeout: 30_000, message: 'Both native fighters must attack the encountered boss before finishing the obsolete advertised route'}).toBe(true);
    expect(firstHit).toBeTruthy(); expect(firstHit.native[W].map).toBe('halloween');
    expect(Math.hypot(firstHit.native[W].x - advertised.x, firstHit.native[W].y - advertised.y)).toBeGreaterThan(250);
    expect(refusals).toBe(1);
    expect(requests.some(r => !r.rejected && r.disableTown && r.body.town === false)).toBe(true);
    expect(validationErrors, 'Every refusal must retain exact fresh coordinator ownership').toEqual([]);
    const rejectedIds = new Set(requests.filter(request => request.rejected).map(request => request.body.id));
    expect(observer.failures.filter(failure => rejectedIds.has(failure.id)),
      'Every declared refusal must arrive without aborting its exact native operation').toEqual([]);
  } finally {
    await context.unroute('**/party-api/movement-plan', rejectEntry);
    observer.dispose();
    await restoreObservation();
    await info.attach('native-event-entry-recovery', {body: JSON.stringify({fault: 'Town unavailable once', seed, requests, unmatched, validationErrors, requestFailures: observer.failures, deliveryFailures: observer.deliveryFailures, final: await live.state()}), contentType: 'application/json'});
    await info.attach('native-event-en-route-sighting', {body: JSON.stringify({event: 'mrpumpkin', advertised, baseline, moved, firstHit, samples, events: await live.clients[W].events()}), contentType: 'application/json'});
    await live.post('/formation', {character: W, eventSelections: []});
    await live.admin(`output=(()=>{const m=get_monster('mrpumpkin');if(String(m?.id)===${JSON.stringify(seed.id)})remove_monster(m,{silent:true});G.monsters.mrpumpkin=globalThis.__entryRecoveryOriginalPumpkin;delete globalThis.__entryRecoveryOriginalPumpkin;delete E.mrpumpkin;broadcast_e();return true;})()`);
  }
}

// W25: one Mr. Green session from the Spooky Town start (E4, E1, E29, E31, E30, E40).
export async function greenSessionPlay(live: LiveGame, info: TestInfo) {
  await halloweenCleanup({live}, info);
  try {
    const {encounter, savedCheckpoint} = await stagingRound(live, info, 'mrgreen');
    await returnRound(live, info, encounter, savedCheckpoint, false);
    await settle(live);
    await clearPlanted(live, ['mrgreen']);
    await live.post('/formation', {character: W, eventSelections: ['mrgreen']});
    await thresholdRound(live, info, {id: 'mrgreen', add: 'greenjr', drop: 'ashleaf', map: encounter.map, x: encounter.x, y: encounter.y});
    await settle(live);
    await emptyHintRound(live, info);
    await settle(live);
    // The three walks from the Halloween checkpoint: the warrior dies before the priest's walk is
    // admitted (E31), then after both depart on the next (E30), then the third walk meets the
    // boss beside it (E40).
    await travelTo(live, halloweenCheckpoint);
    await admissionDeathPlay({live}, info);
    await settle(live);
    await travelTo(live, halloweenCheckpoint);
    await respawnCatchupPlay({live}, info);
    await settle(live);
    await travelTo(live, halloweenCheckpoint);
    await newlyVisibleBossPlay({live}, info, 'mrgreen');
  } finally { try { await halloweenRestore({live}, info); } finally { await eventScrub(live, info); } }
}

// W26: one Mr. Pumpkin session from the Halloween start (E5, E6, E2, E38, E26, E41, E27).
export async function pumpkinSessionPlay(live: LiveGame, info: TestInfo) {
  await halloweenCleanup({live}, info);
  try {
    const {encounter, savedCheckpoint} = await stagingRound(live, info, 'mrpumpkin');
    await returnRound(live, info, encounter, savedCheckpoint, true);
    await settle(live);
    await clearPlanted(live, ['mrpumpkin']);
    await live.post('/formation', {character: W, eventSelections: ['mrpumpkin']});
    await thresholdRound(live, info, {id: 'mrpumpkin', add: 'jr', drop: 'pstem', map: encounter.map, x: encounter.x, y: encounter.y});
    await settle(live);
    await acrossWallRound(live, info);
    await settle(live);
    await travelTo(live, halloweenCheckpoint);
    await refusedEntrySightingRound(live, info);
    await settle(live);
    // E27 refuses every plan to the boss, so its walk reaches the boss only by the ladder, which a
    // boss moved beside the walk (E41, the round before) would cut short.
    await travelTo(live, halloweenCheckpoint);
    await entryFailurePlay({live}, info, 'entry unavailable until exhausted');
  } finally { try { await halloweenRestore({live}, info); } finally { await eventScrub(live, info); } }
}

// The player sends one character to a point, and the round waits until it stands there.
async function sendTo(live: LiveGame, character: string, to: Point) {
  await live.post('/command', {character, type: 'character-travel', location: to, label: 'Player move to the next round'});
  await expect.poll(async () => live.admin(`output=(()=>{const p=get_player(${JSON.stringify(character)});return p&&!p.rip&&!p.moving&&p.map===${JSON.stringify(to.map)}&&Math.hypot(p.x-(${to.x}),p.y-(${to.y}))<65;})()`),
    {timeout: WALK_MS, message: `The player's move must bring ${character} to ${to.map} (${to.x}, ${to.y})`}).toBe(true);
}

// W28: one event walk session (E33 in Upper Hills, then E32, E36, E37, E39 from the Halloween
// checkpoint). E36's restart lands on the Pumpkin walk it keeps, and E37's restart on the walk the
// higher-priority Green replaces, so each has its own walk.
export async function reloadRestartSessionPlay(live: LiveGame, info: TestInfo) {
  try {
    await retiredExitPlay({live}, info);
    await settle(live);
    await travelTo(live, halloweenCheckpoint);
    await fixedEndTimerPlay({live}, info);
    await settle(live);
    await travelTo(live, halloweenCheckpoint);
    await codeTurnoverPlay({live}, info);
    await settle(live);
    await travelTo(live, halloweenCheckpoint);
    await failedEntryPlay({live}, info);
    await settle(live);
    await eventLimitsPlay({live}, info);
  } finally { await eventScrub(live, info); }
}

// W29: one session of player commands that end event attendance. Each explicit leave (H30 command,
// H31 travel, H32 monster) skips the occurrence it leaves for good, so each leaves its own
// occurrence. Then a follower fights a boss a map away from its leader (C22), a farm focus change
// waits through a natural Halloween completion (E42), and an escape and Resume end the last
// attendance (T6).
export async function commandLeaveSessionPlay(live: LiveGame, info: TestInfo) {
  try {
    await eventOverridePlay({live}, info, 'command');
    await settle(live);
    await eventOverridePlay({live}, info, 'travel');
    await settle(live);
    await eventOverridePlay({live}, info, 'monster');
    await settle(live);
    await sendTo(live, W, {map: 'main', x: 0, y: 0});
    await sendTo(live, P, {map: 'halloween', x: -495, y: 600});
    await followerBossPlay({live}, info);
    await settle(live);
    await travelTo(live, {map: 'main', x: 0, y: 0});
    await focusChangePlay({live}, info);
    await settle(live);
    await e1Row(live, info);
  } finally { await eventScrub(live, info); }
}

// W30: one Horseman session on Halloween: the pretravel round (E24), the walk to the forest
// graveyard (E11), the Jack-o-Walker waves (E12), the goo farm beside an unjoined Horseman (E21),
// and the priest's death at the Horseman with the coordinator keeping the failed walk (T2).
export async function horsemanSessionPlay(live: LiveGame, info: TestInfo) {
  try {
    await pretravelPlay({live}, info, 'horseman', {map: 'halloween', x: -405, y: -1640});
    await settle(live);
    await clearPlanted(live, ['horseman']);
    await travelTo(live, {map: 'halloween', x: 0, y: 0});
    await horsemanWalkPlay({live}, info);
    await settle(live);
    await clearPlanted(live, ['horseman']);
    await travelTo(live, {map: 'halloween', x: -245, y: -1640});
    await horsemanWavesPlay({live}, info);
    await settle(live);
    await clearPlanted(live, ['horseman']);
    await travelTo(live, {map: 'halloween', x: -405, y: -1460});
    await unjoinedHorsemanPlay({live}, info);
    await settle(live);
    await clearPlanted(live, ['horseman']);
    await up1Row('horseman')(live, info);
  } finally { await eventScrub(live, info); }
}

// W31: one Graveyard session in the cemetery: the pretravel round (E25), then the zombie fight with
// the Gargoyle unchecked and checked (E13).
export async function graveyardSessionPlay(live: LiveGame, info: TestInfo) {
  try {
    await pretravelPlay({live}, info, 'graveyard', {map: 'spookytown', x: 255, y: -1425});
    await settle(live);
    await travelTo(live, {map: 'spookytown', x: 255, y: -1350});
    await gargoylePlay({live}, info);
  } finally { await eventScrub(live, info); }
}

// W32: one session of event admissions that end without a fight: the A/B arena ends with the
// warrior inside and it reconnects once to Main (E28), an announced Mr. Pumpkin never appears
// (E8), and a fake-live Ice Golem refuses the join (T1). The arena round comes first: a player
// travel saves its point as the party's location, and the arena's exit then walks there in place
// of the Main recovery E28 reads.
export async function admissionSessionPlay(live: LiveGame, info: TestInfo) {
  try {
    await arenaReconnectPlay({live}, info);
    await settle(live);
    await travelTo(live, {map: 'halloween', x: -335, y: 685});
    await halloweenCleanup({live}, info);
    try { await absentSpawnPlay({live}, info); }
    finally { await halloweenRestore({live}, info); }
    await settle(live);
    // The announcement's broadcast_e wrapper goes back before the next round.
    await eventScrub(live, info);
    await cantJoinRow(live, info);
  } finally { await eventScrub(live, info); }
}

// W37: Anniversary with its host offline and Hunt off: the warrior stages for an announced round
// through an old-round slice (H45), the host logs out while the merchant banks and the visit
// resumes when it logs back in (M38), and the player turns Hunt off during a visit (H11).
export async function anniversaryHostSessionPlay(live: LiveGame, info: TestInfo) {
  await stagingSlicePlay({live}, info);
  await settle(live);
  await hostOfflineHuntOffRound(live, info);
}

// One Anniversary visit serves M38 and H11: a kiss gives its 20-minute anniversary_kiss condition
// (game data 17175 conditions.anniversary_kiss), and a member that holds it gets no second gift,
// so the merchant's two gifts cannot come from two visits in one play (W37 merged run 2: no gift on
// the second). The goo Hunt runs when the round starts, the host logs out while the merchant
// banks, the visit resumes on the host's login, and the player turns the Hunt off once the gift is
// in (H11, as anniversary-rows.ts `anniversaryVisitPlay` 'hunt-off').
async function hostOfflineHuntOffRound(live: LiveGame, info: TestInfo) {
  const ambient = await isolateNativeMapAmbient(live, 'main');
  await info.attach('anniversary-native-ambient-input', {body: JSON.stringify(ambient), contentType: 'application/json'});
  try {
    const hunt = await prepareHunt(live, {count: 500}); await start(live, W, hunt.monster, hunt.location); await cycle(live);
    const before = await huntEventsWorld(live), M = 'E2EMerchant';
    await live.post('/formation', {character: W, eventSelections: ['anniversary']});
    await hostOfflinePlay({live}, info, async () => {
      // H11's visit reads as anniversary-rows.ts `anniversaryVisitPlay` reads it.
      const world = huntEventsWorld;
      await expect.poll(async()=>(await world(live)).anniversary?.live,{timeout:30_000}).toBe(true);
      await expect.poll(async()=>(await live.state()).anniversary?.eventCycle?.id,{timeout:45_000}).toBeTruthy();
      await live.post('/farming-mode', {character: W, mode: 'default'});
      await live.post('/formation', {character: W, eventSelections: []});
      await live.post('/formation', {character: 'E2EMerchant', eventSelections: []});
    });
    await expect.poll(async()=>(await live.state()).monsterHunt,{timeout:45_000}).toBeFalsy();
    await expect.poll(async()=>(await live.state()).anniversary?.eventCycle?.returnCompletedAt||!(await live.state()).anniversary?.eventCycle,{timeout:90_000}).toBeTruthy();
    expect((await live.state()).monsterHunt).toBeFalsy();
    const world = huntEventsWorld;
    expect(quantity((await world(live)).players[M].items,'anniversarygift')).toBe(quantity(before.players[M].items,'anniversarygift')+1);
  } finally { await info.attach('anniversary-native-ambient-restored', {body: JSON.stringify(await restoreNativeMapAmbient(live, true)), contentType: 'application/json'}); }
}

// W39: the Witch's Cipher rounds: a Hunt runs when the Cipher starts and a member dies on the way
// (E18), the merchant brews early on the mix it affords (E19), the Cipher gathering interrupts a
// lower-priority Green (E20), and the merchant solves a constrained recipe across a restart (E10).
// E19's plan reads the seeded stock, where the merchant lacks only verdantspore. The first round's
// Cipher is still live on the walk to the goo field, and the goo the party kills there drop
// verdantspore (merged run 5: the warrior's plan read 'brewing' in place of 'gathering'), so the
// round starts with no Cipher ingredient in any bag.
async function clearCipherStock(live: LiveGame) {
  await live.admin(`output=(()=>{const ids=${JSON.stringify(cipherIngredients)},removed={};
    for(const name of ['E2EWarrior','E2EPriest','E2EMerchant']){const p=get_player(name);
      p.items=p.items.map(item=>{if(item&&ids.includes(item.name)){removed[name]=(removed[name]||0)+(item.q||1);return null;}return item;});
      cache_player_items(p);resend(p,'reopen+cid');}
    return removed;})()`);
}

export async function cipherSessionPlay(live: LiveGame, page: Page, info: TestInfo) {
  try {
    await cipherHuntPlay({live}, info);
    await settle(live);
    // The old E19 test booted at nativeMonsterInitialPosition('goo'), which picks dungeon0 (maps in
    // name order), away from any goo. The round starts on Main's square, the seeded start, a walk
    // from the goo pack (game data 17175 main boundary -282, 702, 218, 872): at the pack's centre
    // the fighters' first kills (loot 100) finished the gathering before the plan's first read
    // (merged run 6: the plan read 'brewing' 35 s in, with 90 verdantspore gathered).
    await travelTo(live, {map: 'main', x: 0, y: 0});
    await clearCipherStock(live);
    await cipherEarlyBrewPlay({live}, info);
    await settle(live);
    // The early brew round's cipher is still live when its play ends, and the priority round ranks
    // witchcipher over Mr. Green, so the fighters joined that round's wolfie gathering in Winterland
    // and never hit the Green (merged run 7). The game's own end of a round (logic/witch_cipher.js
    // witch_cipher_finish) closes it, so the priority round starts its own. The early brew left
    // verdantspore in the bags, so the priority round's plan skipped to the next missing ingredient,
    // the wolfie's, and the fighters gathered in Winterland in place of the spiders it reads (merged
    // run 8); the stock goes as it does before the early brew. The early brew's loot rate of 100
    // goes back with its round. The stock is cleared at the checkpoint, after the walk: a clear
    // before it left one verdantspore picked up on the way, and the priority round's plan then
    // read embercoal and sent the fighters to the desert scorpions (liveb-step10-run3.log).
    await live.admin("witch_cipher_finish();if('e2eCipherLoot' in global)G.events.witchcipher.loot=global.e2eCipherLoot;output=true");
    // The finish ends the event, whose exit hands the party back to round 1's Hunt. A travel sent
    // in the same report stalled on Main after two steps (liveb-step10-run1.log: "Event exit
    // complete after witchcipher; the Hunt resumes" and "Convoy started" at one instant, then no
    // movement for 130 s), so the travel waits for the exit to settle, as the rounds above do.
    await settle(live);
    await travelTo(live, halloweenCheckpoint);
    await clearCipherStock(live);
    await cipherPriorityPlay({live}, info);
    await settle(live);
    await travelTo(live, {map: 'halloween', x: 0, y: 0});
    // The early brew round's mix is the account's claim for the day (logic/witch_cipher.js
    // witch_cipher_claim, kept in memory and in the WitchCipher collection), and the next round
    // reads it back, so the merchant round started at one mix (liveb-step10-run4.log: mixes 1, not
    // 0). The claim goes with its round, as the stock does.
    await live.admin(`output=(async()=>{const owner=get_player('E2EMerchant').owner;delete witch_cipher_claims[owner];
      await db.collection('WitchCipher').deleteMany({_id:{$regex:'^claim:'+owner+':'}});return true;})()`);
    await cipherMerchantPlay({live, page}, info);
  } finally { await eventScrub(live, info); }
}

// W34: the Goobrawl rounds during a goo Hunt. Four behaviours need states one round cannot hold
// (DEVIATIONS.md "Live B"): T35 and T36 read the Hunt resuming after the event with both fighters
// in the arena; C11 turns the Hunt off as the leader joins; C28's add-on refuses the priest's
// admission, so the priest never stands in the arena; and M63's add-on task is the group's live
// task when the event takes it, in place of the Hunt. Each seeded round ends before the next one is
// seeded; the two hooks rounds play the native Goobrawl with no seed.
export async function goobrawlHuntSessionPlay(live: LiveGame, info: TestInfo) {
  try { await goobrawlRounds(live, info); }
  // C28's Mr. Green announcement leaves its broadcast wrapper (run 4: W38 and W39 dirty-started on it).
  finally { await eventScrub(live, info); }
}
async function goobrawlRounds(live: LiveGame, info: TestInfo) {
  await goobrawlPlay(live, info, 'restart', false);
  await settle(live);
  await info.attach('goobrawl-restart-round-end', {body: JSON.stringify(await endSmallGoobrawl(live)), contentType: 'application/json'});
  await huntOffEventPlay({live}, info, true);
  await settle(live);
  await info.attach('goobrawl-hunt-off-round-end', {body: JSON.stringify(await endSmallGoobrawl(live)), contentType: 'application/json'});
  await eventsHooksPlay({live}, info);
  await settle(live);
  await info.attach('goobrawl-events-hooks-round-end', {body: JSON.stringify(await endSmallGoobrawl(live)), contentType: 'application/json'});
  await tasksHooksPlay({live}, info);
}

// W35: Goobrawl after a finished Hunt (T37), then a new Goobrawl during the next Hunt with Hunt
// turned off once both stand in the arena (C12).
export async function goobrawlFinishedSessionPlay(live: LiveGame, page: Page, info: TestInfo) {
  const finished = goobrawlRows.find(([title]) => title.endsWith('with a finished Hunt at the event start'))!;
  await finished[1](live, info, page);
  await settle(live);
  // T37's hand-in needs its Hunt on and C12 turns the Hunt off, so each has its own Goobrawl
  // (DEVIATIONS.md "Live B"); the first one ends before the second is seeded.
  await info.attach('goobrawl-first-round-end', {body: JSON.stringify(await endSmallGoobrawl(live)), contentType: 'application/json'});
  await huntOffEventPlay({live}, info, false);
}
