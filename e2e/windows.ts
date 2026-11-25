import {test, type LiveGame} from './live-fixtures';
import type {Page, TestInfo} from '@playwright/test';
import {readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {recordData, recordGlobals, restoreData, restoreGlobals, runWindow, type GlobalUndo, type Observer, type ProofLine} from './window-runner.ts';

// Live play windows (test-windows DESIGN.md sections 2 and 3). `liveWindow` declares one window:
// one fixture, one play script, and its checks as observers of that play. Each window boots its
// own fixture (game.reset and the login), proves the start is clean, runs the play once, and at
// its end writes the state dump before the undo, pass or fail. A window tagged `@alone` runs in
// the `live-alone` project, after the two-stack phase (playwright.config.ts).

export type LiveWorld = {live: LiveGame; page: Page; info: TestInfo};
export type LiveObserver = Observer<LiveWorld>;
type Point = {map: string; x: number; y: number};
export type WindowStart = {
  // Each character's start point. One left out starts where the fixture's initialPosition or
  // initialPositions option puts it, else at the account's seeded point (e2e/game/bootstrap.cjs:73).
  positions?: Record<string, Point>;
  // The events the fixture itself makes live, such as an initialEventSpawn.
  events?: string[];
};
export type LiveWindow = {
  id: string; name: string;
  // W01 and W02 measure rates that a second stack lowers (DESIGN.md 2.3), so they run alone.
  alone?: boolean;
  // The window's measured length bounds its test (each window names its source).
  timeoutMs: number;
  use?: Parameters<typeof test.use>[0];
  start?: WindowStart;
  play(world: LiveWorld): Promise<void>;
  observers: LiveObserver[];
  pollMs?: number;
};

const seeded: Point = {map: 'main', x: 0, y: 0};
// The harness's own globals, as a clean boot shows them (W02's first run, 2026-11-23): the ChronAL
// clock every page and realm carries; the reset's baselines, calendar isolation and ambient
// journal on the game server (e2e/game/bootstrap.cjs:69-189); and the native client's socket and
// event observers on each page (e2e/live-game-client.ts, tools/sim/browser-clock.cjs). Any other
// __e2e global is a plant some earlier test left on a reused page or on the pool's game server.
const harnessGlobals = new Set(['__e2eChronalClock', '__e2eHorsemanBaseline', '__e2eBaseline', '__e2eScheduleIsolation',
  '__e2eAllowScheduledEvents', '__e2eAmbientRemovalJournal', '__e2eChronalFrame', '__e2eClockConfiguration', '__e2eEvents',
  '__e2eObserverGeneration', '__e2eEventSequence', '__e2eObservedSockets', '__e2eSocketObservationGeneration', '__e2eOutgoingObservation',
  // A Playwright binding on the worker's reused browser context, exposed once per context
  // (e2e/native-planner-observation.ts:4-11), so it stays on every later page of that worker.
  '__e2eNativePlannerOwnership']);
// The globals a fixture option installs at boot and removes at teardown: the native status
// observer's ledger on each page (e2e/native-status-observer.ts:6), and the peaceful ambient maps'
// saved catalog on the game server (live-fixtures.ts initialPeacefulAmbientMaps).
export const fixtureGlobals = (use: LiveWindow['use']) => {
  const options = (use ?? {}) as {nativeStatusObserver?: boolean; initialPeacefulAmbientMaps?: string[]};
  return {page: options.nativeStatusObserver ? ['__e2eEventStatus'] : [],
    server: options.initialPeacefulAmbientMaps?.length ? ['__e2eInitialPeacefulAmbient'] : []};
};
// A clean boot gives the merchant its idle task and each fighter its solo farm (the same run).
const bootTasks = ['idle', 'farming'];
const e2eGlobals = `Object.keys(globalThis).filter(k=>k.startsWith('__e2e'))`;

// The reset proof (DESIGN.md 3.2): the window's world as the fixture declares it, read before any
// play. Each returned line is one disagreement.
export async function resetProof(world: LiveWorld, start: Required<WindowStart>, fixture = fixtureGlobals(undefined)): Promise<ProofLine[]> {
  const {live} = world, lines: ProofLine[] = [];
  const names = [...new Set([...Object.keys(live.clients), ...Object.keys(start.positions)])];
  // A character walks at most its speed (game data) for the server time since the reset, so a
  // point further out than that was not reached from the declared start.
  const server = await live.admin(`output=(()=>{const now=Date.now(),at={};for(const n of ${JSON.stringify(names)}){const p=get_player(n);
    at[n]=p?{map:p.map,x:Math.round(p.x),y:Math.round(p.y),speed:p.speed}:null;}
    const monsters=Object.values(instances).flatMap(i=>Object.values(i.monsters||{})),packs=new Set(Object.values(G.maps).flatMap(m=>m.monsters||[]));
    const planted=monsters.filter(m=>m.temp&&!packs.has(m.map_def)).map(m=>({id:String(m.id),type:m.type,in:m.in,x:Math.round(m.x),y:Math.round(m.y)}));
    const seasons=get_event_flags(gameplay),alive=new Set(monsters.map(m=>m.type));
    const live=[...Object.keys(E).filter(t=>E[t]&&E[t].live&&!alive.has(t)),...Object.keys(events).filter(t=>events[t]===true&&!seasons[t])];
    return {now,at,planted,events:[...new Set(live)].sort(),globals:${e2eGlobals}};})()`) as
    {now: number; at: Record<string, {map: string; x: number; y: number; speed: number} | null>; planted: unknown[]; events: string[]; globals: string[]};
  for (const name of names) {
    const want = start.positions[name] ?? seeded, got = server.at[name];
    const reach = got ? got.speed * Math.max(0, server.now - live.bootAt) / 1000 : 0;
    if (!got || got.map !== want.map || Math.hypot(got.x - want.x, got.y - want.y) > reach)
      lines.push({line: `position ${name}`, expected: {...want, within: Math.round(reach)}, actual: got ?? 'offline'});
  }
  // A monster the harness or a window planted carries new_monster's temp mark (server.js:13602,
  // every plant in e2e/ passes {temp:1}) on a spawn record of its own. The world's own spawns
  // never do: spawn_special_monster's rares (server_functions.js:1998) pass no args, and a grow
  // pack's temp copies (server.js:13668) keep the map's pack as their record. So the proof judges
  // the planted ones only, and a rare the world spawned at this boot passes.
  const planted = (server.planted as {type: string}[]).filter(m => !start.events.includes(m.type));
  if (planted.length) lines.push({line: 'planted monsters', expected: start.events, actual: planted});
  // `events` holds switches (true) beside the kill-count rates of the random rares (server.js:308,
  // goldenbat: 160000 and the like). A season the server's calendar opens (design/event_flags.js
  // get_event_flags) is the world's own; a live E status with no monster behind it is an event.
  const extra = server.events.filter(e => !start.events.includes(e));
  if (extra.length) lines.push({line: 'events', expected: start.events, actual: server.events});
  const serverPlants = server.globals.filter(g => !harnessGlobals.has(g) && !fixture.server.includes(g));
  if (serverPlants.length) lines.push({line: 'game server plants', expected: [], actual: serverPlants});
  // An earlier window's edit of the game data that its undo missed, such as a catalog monster's
  // peaceful flag, which every later spawn of that type copies (W44, W48, 2026-11-24).
  const drift = await live.admin(serverData('proof')) as string[];
  if (drift.length) lines.push({line: 'game data', expected: 'the baseline', actual: drift});
  for (const [name, client] of Object.entries(live.clients)) {
    const plants = (await client.run(`(()=>[...${e2eGlobals},...(()=>{try{return Object.keys(parent).filter(k=>k.startsWith('__e2e'));}catch(e){return [];}})()])()`) as string[])
      .filter(g => !harnessGlobals.has(g) && !fixture.page.includes(g));
    if (plants.length) lines.push({line: `page plants ${name}`, expected: [], actual: [...new Set(plants)]});
  }
  const state = await live.state();
  const hunt = {farmingPolicy: state.farmingPolicy ?? null, monsterHunt: state.monsterHunt?.active ? state.monsterHunt : null};
  if (hunt.farmingPolicy === 'hunt' || hunt.monsterHunt) lines.push({line: 'hunt', expected: 'no Hunt', actual: hunt});
  const returns = {eventReturn: state.eventReturn ?? null, deferred: Object.keys(state.deferredEventReturns ?? {})};
  if (returns.eventReturn || returns.deferred.length) lines.push({line: 'event returns', expected: 'none', actual: returns});
  const merchant = {current: state.merchantCurrent ?? null, queue: state.merchantQueue ?? []};
  if (merchant.current || merchant.queue.length) lines.push({line: 'merchant job', expected: 'none', actual: merchant});
  const groups = ((await live.tasks()).groups ?? []).filter((g: any) => g.live && !bootTasks.includes(g.live.kind)).map((g: any) => ({id: g.id, live: g.live}));
  if (groups.length) lines.push({line: 'group tasks', expected: [], actual: groups});
  const settings = (await (await fetch(`${live.url}/party-api/settings`, {signal: AbortSignal.timeout(15_000)})).json()).settings as
    {field: string; character?: string; value?: unknown; default?: unknown; secret?: boolean}[];
  const changed = settings.filter(s => !s.secret && 'default' in s && JSON.stringify(s.value) !== JSON.stringify(s.default));
  if (changed.length) lines.push({line: 'settings', expected: 'defaults', actual: changed.map(s => ({field: s.field, character: s.character, value: s.value, default: s.default}))});
  return lines;
}

// Each fighter's own reads: its nomination (blocked reason, rejections, eligible), its pending Hunt
// loot, its farming and potion holds, and its targeting answers, with whether it may fight `monster`
// when the row names one.
export const fighterRead = (monster?: string) => `(()=>{if(character.ctype==='merchant')return undefined;
  const id=f=>{try{const t=f();return t?String(t.id):null;}catch(e){return 'threw '+String(e).slice(0,80);}},t=globalThis.sharedRoutine?.targeting,n=globalThis.__partyNomination;
  const m=${JSON.stringify(monster ?? null)},e=m!=null?parent.entities[m]:null;
  return {at:[character.map,Math.round(character.real_x),Math.round(character.real_y)],target:character.target??null,
    // The client's own motion: the walk's held test reads the report's \`moving\` from it.
    motion:{moving:!!character.moving,going:[Math.round(character.going_x),Math.round(character.going_y)]},
    nomination:n?{blocked:n.blocked??null,rejected:n.rejected??null,eligible:n.eligible??null,focus:n.focus??null}:null,
    event:(()=>{const f=globalThis.__partyEventFacts,read=g=>{try{return g();}catch(e){return 'threw '+String(e).slice(0,80);}};
      return f?{eventTypes:read(()=>f.eventTargets().types),eventJoined:read(()=>f.joinedEventName()),eventTravelling:read(()=>f.travellingEventName()),
        onEventMap:read(()=>!!(G.maps[character.map]&&G.maps[character.map].event))}:null;})(),
    lootPending:(()=>{try{return globalThis.partyHunting.facts.focus.lootPending;}catch(e){return 'threw '+String(e).slice(0,80);}})(),
    // The farming mode and the walk facts that block the nomination: the coordinator's travel hold
    // and the farm reunion's phase with its command.
    farming:(()=>{try{const f=globalThis.partyHunting.farm,r=globalThis.__partyReunion;return {mode:f.mode(),grouped:!!f.grouped(),travelCombat:globalThis.__partyTravelCombat??null,
      reunion:r?{phase:r.phase??null,command:r.command?{id:r.command.id,type:r.command.type,handoff:r.command.convoyHandoff??null}:null}:null};}catch(e){return 'threw '+String(e).slice(0,80);}})(),
    // What holds the potion family: each potion skill's game edge (ms from now), the turns owner's
    // answer for the family and its last potion records.
    potions:(()=>{try{const k=['use_hp','use_mp','regen_hp','regen_mp'],tu=globalThis.__partyTurns,ns=parent.next_skill||{},fam=tu?tu.family('use_hp'):null;
      return {edges:Object.fromEntries(k.map(s=>[s,ns[s]?Math.round(+ns[s]-Date.now()):null])),family:fam,
        ready:tu?Object.fromEntries(k.map(s=>{const r=tu.ready(s);return [s,{ready:r.ready,flying:r.flying}];})):null,
        records:tu?tu.records().filter(r=>r.family===fam).slice(-6).map(r=>[r.at,r.kind,r.skill,r.reason??null]):null};}catch(e){return 'threw '+String(e).slice(0,80);}})(),
    // The Town send's gate (executor.ts readyTown): targeting's departure answer, the lootPending read above,
    // the game's own use_town answers, and the call budget's town answers per band, its waits and held count.
    // The turns ring keeps refusals, waits, lost replies, cooldown and stale replies; it records no sends, so the
    // last 10 per family are those, with the turns meter's send count beside them.
    town:(()=>{const r=g=>{try{return g();}catch(e){return 'threw '+String(e).slice(0,80);}},h=globalThis.__partyHooks,c=globalThis.__partyCalls,v=r(()=>c.view());
      return {departurePending:r(()=>h.ask('targeting.departurePending')),canUseTown:r(()=>!!can_use('use_town')),townCooldown:r(()=>!!is_on_cooldown('use_town')),
        townAnswers:typeof v==='object'?Object.fromEntries(Object.entries(v.answers).filter(([,a])=>a.town).map(([b,a])=>[b,a.town])):v,
        callsHeld:typeof v==='object'?{held:v.held,heldHead:v.heldHead,waiting:v.waiting,used:v.used,limit:v.limit}:v,
        callRecords:r(()=>c.records().filter(x=>x.method==='town').slice(-5))};})(),
    turnsRing:(()=>{try{const tu=globalThis.__partyTurns,by={};for(const x of tu.records()){(by[x.family]??=[]).push([x.at,x.kind,x.skill,x.rank??null,x.by??null,x.reason??null,x.ms??x.waitedMs??null]);}
      return {meter:tu.meter(),hold:(h=>({stop:h.stop,asks:h.asks,pulse:h.pulse,roleLoop:h.roleLoop,combat:h.combat,potions:h.potions,refusal:h.refusal}))(tu.hold()),
        families:Object.fromEntries(Object.entries(by).map(([f,l])=>[f,l.slice(-10)]))};}catch(e){return 'threw '+String(e).slice(0,80);}})(),
    targeting:t?{grouped:id(()=>t.getGroupedTarget()),preferred:id(()=>t.getPreferredTarget()),focused:id(()=>t.getNearestFocusedMonster()),
      monster:m==null?undefined:e?(()=>{const d={};const ok=t.isAllowedTarget?.(e,undefined,d);return {ok,reason:d.reason??null};})():'not in sight'}:null};})()`;
// A fighter's event facts (types, joined, travelling, event map) are the conditions that stop it grouping.

// The state dump (DESIGN.md 3.3), written at every window end before the undo: the coordinator's
// rare, Hunt, walk, event and merchant state, each group's task ring, each character's own reads
// and its movement, call and turns rings, and the coordinator log since the window started. The
// turns ring goes whole (records.ts MOVEMENT_RING_SIZE, 128), so a wait set early in the play still
// shows its cause. A read that fails prints its error, so the dump never hides the window's own
// error.
export async function windowState(world: LiveWorld, logFrom: number) {
  const {live, info} = world;
  const read = async (get: () => Promise<any>) => { try { return await get(); } catch (error) { return {error: String((error as Error)?.message ?? error)}; } };
  const characters: Record<string, unknown> = {};
  for (const [member, client] of Object.entries(live.clients)) characters[member] = await read(async () => ({
    reads: await client.run(fighterRead()),
    rings: await client.run(`(()=>{const r=g=>{try{return g();}catch(e){return 'threw '+String(e).slice(0,80);}};
      return {at:[character.map,Math.round(character.real_x),Math.round(character.real_y)],rip:!!character.rip,
        movement:r(()=>globalThis.__partyMovement.records().slice(-30)),calls:r(()=>globalThis.__partyCalls.records().slice(-30)),
        turns:r(()=>globalThis.__partyTurns.records())};})()`),
  }));
  const state = await read(() => live.state()), tasks = await read(() => live.tasks());
  const pick = (keys: string[]) => state.error ? state : Object.fromEntries(keys.map(k => [k, state[k] ?? null]));
  const log = await read(async () => {
    const file = path.join(live.deploymentPaths.directory, 'coordinator.log');
    const text = readFileSync(file).subarray(logFrom).toString('utf8');
    await info.attach('coordinator-log-window', {body: text, contentType: 'text/plain'});
    return {file, from: logFrom, bytes: text.length};
  });
  return {
    rare: pick(['rareHuntState', 'passiveHunting', 'passiveRareHunts', 'rareRetryEvidence', 'rarePursuitProgress']),
    hunt: pick(['farmingPolicy', 'targetMode', 'followers', 'monsterHunt', 'groupedCombat', 'huntFailures', 'huntBlacklist']),
    walk: pick(['activeConvoy', 'townCycle', 'combatRecovery', 'realmControl']),
    // Each member's last reported walk phase and motion, the facts the walk's hold and its resume
    // read (movement/coordinator/walk.ts `resume`).
    reported: state.error ? state : Object.fromEntries(Object.entries(state.characters ?? {}).map(([n, c]: [string, any]) =>
      [n, {phase: c?.convoyNavigation?.phase ?? null, commandId: c?.convoyNavigation?.commandId ?? null, moving: c?.moving ?? null,
        detail: c?.navigationDetail ?? null, seenAt: c?.seenAt ?? null}])),
    events: pick(['eventAttendance', 'eventReturn', 'deferredEventReturns', 'anniversary']),
    merchant: pick(['merchantCurrent', 'merchantQueue', 'merchantActivity', 'merchantDeliveries', 'bankboiQueue']),
    groups: tasks.error ? tasks : (tasks.groups ?? []).map((g: any) => ({id: g.id, members: g.members, live: g.live ?? null, status: g.status ?? null, ring: g.ring ?? []})),
    characters, log,
  };
}

// The global undo's realm code (window-runner.ts recordGlobals, restoreGlobals). The record sits
// under a symbol, which no __e2e scan lists. Every name in the realm code starts with `$`, since
// the server's scope reads and writes a game function by an eval of its name, and the /eval
// handler's own locals (node/server.js:828-829, output and data, with req and res) are left out.
const guardFunctions = `const $record=${recordGlobals.toString()},$restore=${restoreGlobals.toString()},$key=Symbol.for('e2e.windowGlobals');`;
const guardStep = (action: 'record' | 'restore', keep: string[]) => action === 'record'
  ? '$scope.realm[$key]=$record($scope);return null;'
  : `if(!$scope.realm[$key])throw Error('no global record');return $restore($scope,$scope.realm[$key],${JSON.stringify(keep)});`;
// The game server's functions are module bindings of node/server.js and the files it evals at
// load (node/server.js:112-130), so the server's list is their top-level function declarations,
// read once from that source and kept beside the record.
const serverGlobals = (action: 'record' | 'restore', keep: string[]) => `output=(()=>{${guardFunctions}
  const $g=globalThis,$fkey=Symbol.for('e2e.gameFunctions');
  if(!$g[$fkey]){const $files=[__filename],$main=fs.readFileSync(__filename,'utf8'),$names=new Set();
    for(const $m of $main.matchAll(/eval[(]"" [+] fs[.]readFileSync[(]path[.]resolve[(]__dirname, "([^"]+)"/g))$files.push(path.resolve(__dirname,$m[1]));
    for(const $f of $files)for(const $m of fs.readFileSync($f,'utf8').matchAll(/^(?:async +)?function +([A-Za-z_][A-Za-z0-9_]*)/gm))$names.add($m[1]);
    for(const $n of ['output','data','req','res'])$names.delete($n);$g[$fkey]=[...$names];}
  const $scope={realm:$g,names:()=>Object.getOwnPropertyNames($g),functionNames:()=>$g[$fkey],
    get:$n=>{try{return eval($n);}catch($e){return undefined;}},set:($n,$v)=>{eval($n+'=$v');},remove:$n=>delete $g[$n],
    stop:$v=>{if($v&&typeof $v==='object'&&typeof $v.hasRef==='function'&&typeof $v.refresh==='function')clearInterval($v);}};
  ${guardStep(action, keep)}})()`;
// A page's CODE frame and the game window behind it (parent), each its own realm. A page timer is
// a number, so a page scope stops none.
const pageGlobals = (action: 'record' | 'restore', keep: string[]) => `(()=>{${guardFunctions}
  const $realms=[globalThis];try{if(parent&&parent!==globalThis)$realms.push(parent);}catch($e){}
  return $realms.map($r=>{const $scope={realm:$r,names:()=>Object.getOwnPropertyNames($r),
    functionNames:()=>Object.getOwnPropertyNames($r).filter($n=>{const $d=Object.getOwnPropertyDescriptor($r,$n);return !!$d&&'value' in $d&&typeof $d.value==='function';}),
    get:$n=>{try{return $r[$n];}catch($e){return undefined;}},set:($n,$v)=>{$r[$n]=$v;},remove:$n=>delete $r[$n],stop:()=>{}};
    ${guardStep(action, keep)}});})()`;
const guardKeep = (use: LiveWindow['use']) => { const f = fixtureGlobals(use); return [...harnessGlobals, ...f.page, ...f.server]; };

// The game server's half of the global undo, which a play also runs between two rounds of one
// session (event-window-helpers.ts eventScrub), back to the record of its window's start.
export const restoreServerGlobals = (live: LiveGame) => live.admin(serverGlobals('restore', [...harnessGlobals])) as Promise<GlobalUndo>;

// The game data undo's realm code (window-runner.ts recordData, restoreData), on the game server's
// G.monsters and G.events. node/server.js builds both once at boot from the design files, and the
// game writes only DATA_PLAY_KEYS into them in play, so any other difference is a window's edit.
// G.maps stays out: the server writes its packs in play (server.js new_monster `live`, the
// randomrespawn boundary). The first record on a game server is its baseline, which the reset
// proof reads against.
const DATA_TABLES = ['monsters', 'events'];
// The keys the game writes into those tables in play: new_monster counts each type's spawns in its
// definition's `c` (server.js:13664), which the closing-4 rerun's proof read as a leak.
const DATA_PLAY_KEYS = ['c'];
const serverData = (action: 'record' | 'restore' | 'proof') => `output=(()=>{const $recordData=${recordData.toString()},$restoreData=${restoreData.toString()};
  const $g=globalThis,$key=Symbol.for('e2e.windowData'),$base=Symbol.for('e2e.gameDataBaseline');
  ${action === 'record' ? `$g[$key]=$recordData(G,${JSON.stringify(DATA_TABLES)},${JSON.stringify(DATA_PLAY_KEYS)});$g[$base]||=$g[$key];return null;`
    : action === 'restore' ? `if(!$g[$key])throw Error('no game data record');const $changed=$restoreData($g[$key],'G',true);delete $g[$key];return {count:$changed.length,paths:$changed.slice(0,100)};`
    : `return $g[$base]?$restoreData($g[$base],'G',false).slice(0,100):[];`}})()`;

// The global undo for one window: the server and every page at its start, and back at its end. A
// page that closed in the play took its globals with it, so its restore records the error. A
// name the realm cannot delete fails the window.
export const windowGlobals = (use: LiveWindow['use']) => ({
  async record({live}: LiveWorld) {
    await live.admin(serverData('record'));
    await live.admin(serverGlobals('record', []));
    for (const client of Object.values(live.clients)) await client.run(pageGlobals('record', []));
  },
  async restore({live}: LiveWorld) {
    const keep = guardKeep(use), pages: Record<string, unknown> = {};
    const server = await live.admin(serverGlobals('restore', keep)) as GlobalUndo;
    const data = await live.admin(serverData('restore'));
    for (const [name, client] of Object.entries(live.clients))
      pages[name] = await client.run(pageGlobals('restore', keep)).catch((error: Error) => ({error: String(error?.message ?? error)}));
    const stuck = [...server.stuck, ...Object.values(pages).flatMap(p => Array.isArray(p) ? (p as GlobalUndo[]).flatMap(u => u.stuck) : [])];
    if (stuck.length) throw Error(`globals the realm would not delete: ${stuck.join(', ')}`);
    return {server, data, pages};
  },
});

const logSize = (live: LiveGame) => { try { return statSync(path.join(live.deploymentPaths.directory, 'coordinator.log')).size; } catch { return 0; } };

export function liveWindow(spec: LiveWindow) {
  test.describe(`${spec.id} ${spec.name}`, () => {
    if (spec.use) test.use(spec.use);
    test(`${spec.id} ${spec.name}`, {tag: spec.alone ? ['@alone'] : []}, async ({live, page, initialPosition, initialPositions}, info) => {
      test.setTimeout(spec.timeoutMs);
      const fixtureAt = (name: string) => initialPositions?.[name] ?? initialPosition ?? seeded;
      const positions = Object.fromEntries(Object.keys(live.clients).map(n => [n, spec.start?.positions?.[n] ?? fixtureAt(n)]));
      const start = {positions, events: spec.start?.events ?? []};
      const logFrom = logSize(live), world: LiveWorld = {live, page, info};
      const result = await runWindow(world, {
        id: spec.id, observers: spec.observers, pollMs: spec.pollMs, play: spec.play,
        proof: w => resetProof(w, start, fixtureGlobals(spec.use)), dump: w => windowState(w, logFrom), undo: w => w.live.undoRow(), globals: windowGlobals(spec.use),
      }, {
        // A soft expect records its failure on the test and goes on, so a step that added one
        // fails its observer too.
        step: (title, fn) => test.step(title, async () => {
          const before = info.errors.length;
          await fn();
          if (info.errors.length > before) throw Error(info.errors.slice(before).map(e => e.message ?? String(e.value)).join('; '));
        }),
        attach: (name, body) => info.attach(name, {body: JSON.stringify(body, null, 1), contentType: 'application/json'}),
      });
      if (result.error) throw result.error;
    });
  });
}
