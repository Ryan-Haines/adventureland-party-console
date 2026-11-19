import {measureBrowserRendering} from './browser-rendering';
import {waitForBrowserClockStartup} from './chronal-browser-startup';
import {waitForLiveRestartState, type RestartStateProbe} from './live-restart-readiness';
import { test as base, unusedPort, child, environment, stop } from './fixtures';
import {expect,installObservationClock} from './network-clock';
import {cleanupWorkspace} from './workspace';
import {startMovementClimbs} from './movement-climbs';
import {observeNativeStatus} from './native-status-observer';
import { launchGameClient, type LiveClient } from './live-game-client';
import { type ChildProcess } from 'node:child_process';
import {createServer as createHttpServer} from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page,Frame,BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gateway } from '../tools/hosting/gateway';
import { Access } from '../tools/hosting/access';
import { stateKeys } from '../runtime/settings/coordinator/persistence/snapshots';
import { CALL_WINDOW_MS } from '../runtime/characters/call-budget-limits';
import { LEASE_FILE } from '../runtime/lifecycle/rules';
import { coordinatorSettings } from '../runtime/settings/coordinator/table';
import { loadouts, seedLoadout, type NativeLoadout } from './game/loadouts';
import { nativeEventSpawn, nativeMonsterInitialPosition } from './game/event-spawn';
import {nativeNetworkIsolation} from './native-network-isolation';
import { settleNavigation } from './movement-owner-helpers';
import { fighters, partyNames } from './game/hunt-lifecycle';
import { deathReset } from './event-death-rejoin-rows';
import { cleanupEvents } from './game/hunt-events';
import type {GameManifest} from '../tools/game/manifest';
import {callMeasures,type CallSample,type BudgetRead} from './call-budget-cb1';
export {callMeasures,type CallSample,type BudgetRead};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const bootstrap = require('./game/bootstrap.cjs');
export type LiveGame = {
  url: string;
  coordinatorBinding:{port:number;occupiedPort:number|null};
  clients: Record<string, LiveClient>;
  // The fighters' native status observer, set when the spec opts in with nativeStatusObserver.
  status: Awaited<ReturnType<typeof observeNativeStatus>> | null;
  state(catalogs?: boolean | 'fast'): Promise<any>;
  post(route: string, body: unknown): Promise<any>;
  admin(code: string): Promise<any>;
  adminRealm(realm:'USI'|'USII', code:string):Promise<any>;
  /** `completionOnly` holds only the merchant's job completions (POST /party-api/merchant/complete),
   *  so its job stays current. */
  holdMerchantStatus(hold:boolean,options?:{inventoryOnly?:boolean;completionOnly?:boolean}):void;
  consoleDrainLease(id: string | null, expires?: number, options?:{loadMode?:'now'|'safe'|'main';phase?:string}): void;
  /** whileDown runs after the coordinator exits and before it starts again. `faults` names
   *  fixture fault switches (e2e/live-coordinator.cjs) for this start and every later one. */
  restartCoordinator(whileDown?: () => Promise<void> | void, faults?: NodeJS.ProcessEnv): Promise<void>;
  restartCoordinatorIdentity(artifactId:string,hash:string):Promise<void>;
  deploymentPaths:{directory:string;apiUrl:string;codeRoots:string[]};
  restoreHistoricalSettings(restore: (settings: any) => any): Promise<void>;
  // `realmChoice` answers the Steam restore's realm question when the primary's realm is not the
  // account home, as the user does in the bridge's dialog.
  reconnectClient(name: string, options?: { realmChoice?: 'stay' | 'switch' }): Promise<void>;
  /** The group owners' diagnostics read. */
  tasks(): Promise<any>;
  /** Calls on the group owners in the coordinator's process (e2e/live-coordinator.cjs): in the tasks owner
   *  step 2 no provider asks, so a row drives the owner directly. */
  taskOps(ops: {op: string; args: unknown[]}[]): Promise<any[]>;
  /** An invariant break a row plants on purpose, so the per-tick check passes it. */
  expectTaskBreak(detail: string): void;
  /** The call budget's sampler: every 250 ms one
   *  admin read of each named character's server call sum, and the budget's own `used` on each
   *  native client that runs it. `stop` ends it and returns the samples. */
  sampleCalls(names: string[]): {stop(): Promise<CallSample[]>};
  /** The plant: `add` more in the `cc` of the character's player
   *  packets only; the server's limit check keeps the real sum. 0 removes it. */
  plantCallCost(name: string, add: number): Promise<void>;
  /** A row that forces a call limit disconnect declares it, so the teardown check passes it once. */
  declareLimitdc(name: string): void;
  /** Registers the undo of a plant as the row plants it (a socket.emit or calls.band wrapper, a
   *  probe interval or listener, a page route, a server function wrap, a setting, an add-on
   *  switch). The fixture's teardown runs every undo in reverse, success or failure, and a failed
   *  undo fails the test with its label and error attached. */
  undo(label: string, fn: () => unknown): void;
  /** Runs the registered undos now, newest first; a scenario table runs them after each row, so a
   *  row's plants never reach the next row. Throws naming each undo that failed. */
  undoRow(): Promise<void>;
};

export const test = base.extend<{ live: LiveGame; occupyCoordinatorPort:boolean; loadout: NativeLoadout; primaryClass: 'warrior' | 'ranger' | 'mage'; extraFighter: 'mage' | null; merchantDefault: string | null; liveHeadless: boolean; recordNativeVideo: boolean; nativeStatusObserver: boolean; movementMode: 'alclient' | 'shadow'; staleWorkerRealm: string | null; initialPosition: {map: string; x: number; y: number} | null; initialPositions: Record<string,{map:string;x:number;y:number}> | null; initialEventSpawn: string | null; initialMonsterSpawn: string | null; initialConsoleHold: boolean; initialGatheringReady: boolean; initialPeacefulAmbientMaps: string[] }, { workerBrowser: { blocked: string[]; network: Awaited<ReturnType<typeof nativeNetworkIsolation>>; reuse(clock: boolean): Promise<BrowserContext>; preparePage(prepare: ((page: Page) => Promise<void>) | null): void; reuses(): { test: number; origins: string[] } } }>({
  occupyCoordinatorPort:[false,{option:true}],
  loadout: ['god', {option:true}],
  primaryClass: ['warrior', {option:true}],
  extraFighter: [null, {option:true}],
  merchantDefault: ['E2EMerchant', {option:true}],
  initialPosition: [null, {option:true}],
  initialPositions: [null, {option:true}],
  initialMonsterSpawn: [null, {option:true}],
  initialConsoleHold: [false, {option:true}],
  initialGatheringReady: [false, {option:true}],
  initialPeacefulAmbientMaps: [[], {option:true}],
  initialEventSpawn: [null, {option:true}],
  liveHeadless: [false, {option:true}],
  recordNativeVideo: [process.env.E2E_NATIVE_VIDEO==='1', {option:true}],
  // A spec opts in with test.use to record both fighters' native status metadata
  // (native-status-observer.ts) across the test.
  nativeStatusObserver: [false, {option:true}],
  movementMode: ['alclient', {option:true}],
  staleWorkerRealm: [null, {option:true}],
  workerBrowser: [async ({ browser }, use) => {
    const blocked: string[] = [];
    const network = await nativeNetworkIsolation(blocked);
    const origins = new Set<string>();
    let context: BrowserContext | undefined, shared: BrowserContext | undefined, count = 0, clockRoute = false;
    let prepare: ((page: Page) => Promise<void>) | null = null;
    const reuse = async (clock: boolean) => {
      if (!context) {
        const real = context = await browser.newContext({ proxy: network.proxy, viewport: { width: 1280, height: 900 } });
        context.on('request', request => { try { const origin = new URL(request.url()).origin; if (origin.startsWith('http')) origins.add(origin); } catch {} });
        // launchGameClient opens its page with newPage, so the test's page setup runs before the
        // client navigates.
        const newPage = async () => { const page = await real.newPage(); if (prepare) await prepare(page); return page; };
        shared = new Proxy(real, { get: (target, key) => key === 'newPage' ? newPage
          : typeof (target as any)[key] === 'function' ? (target as any)[key].bind(target) : (target as any)[key] });
      }
      if (clock && !clockRoute) { await waitForBrowserClockStartup(context); clockRoute = true; }
      count++;
      // A fresh context starts with no cookies, web storage or service workers; the reused one
      // drops them for every origin it has loaded and keeps only its HTTP cache.
      await context.clearCookies();
      if (origins.size) {
        const page = await context.newPage();
        try {
          const session = await context.newCDPSession(page);
          for (const origin of origins) await session.send('Storage.clearDataForOrigin', { origin,
            storageTypes: 'cookies,local_storage,indexeddb,websql,service_workers,cache_storage,file_systems,shader_cache' });
          await session.detach();
        } finally { await page.close(); }
      }
      const kept = await context.storageState();
      if (kept.cookies.length || kept.origins.length) throw Error('Reused native context kept storage: ' + JSON.stringify(kept).slice(0, 1000));
      return shared!;
    };
    try { await use({ blocked, network, reuse, preparePage: next => { prepare = next; }, reuses: () => ({ test: count, origins: [...origins] }) }); }
    finally { await context?.close().catch(() => {}); await network.close().catch(() => {}); }
  }, { scope: 'worker' }],
  live: [async ({ browser, workerBrowser, context:dashboardContext, dashboard, occupyCoordinatorPort, loadout, primaryClass, extraFighter, merchantDefault, initialPosition, initialPositions, initialEventSpawn, initialMonsterSpawn, initialConsoleHold, initialGatheringReady, initialPeacefulAmbientMaps, liveHeadless, recordNativeVideo, nativeStatusObserver, movementMode, staleWorkerRealm }, use, testInfo) => {
    const pools=JSON.parse(process.env.E2E_GAME_POOLS||'[]');
    const pool=pools[testInfo.parallelIndex];
    if(!pool)throw Error('Missing isolated game pool for parallel worker '+testInfo.parallelIndex);
    Object.assign(process.env,pool.environment);
    const game=bootstrap.createGame({host:pool.host});
    await testInfo.attach('isolated-game-pool',{body:JSON.stringify({host:pool.host,project:pool.project,parallelIndex:testInfo.parallelIndex}),contentType:'application/json'});
    const observationClock=await installObservationClock();
    const directory = path.join(root, '.build/e2e', `live-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    const manifest = await game.reset();
    const names=[...partyNames,...(extraFighter?['E2EBankBoi']:[])];
    const equipment = await seedLoadout(game.admin, loadout, primaryClass, extraFighter);
    // The call budget's row A seeds 16 trade slots (e2e/call-budget-rows.ts); a run that stopped
    // inside the row leaves them saved, and the next login's stand reconcile would take all 16
    // down at once. They go before any client logs in.
    await game.admin(`output=(async()=>{const owned=await db.collection('character').find({owner:data.owner}).toArray(),cleared=[];
      for(const c of owned){const slots=c.info&&c.info.slots||{},set={};for(const [slot,item] of Object.entries(slots))if(/^trade\\d+$/.test(slot)&&item&&String(item.rid).startsWith('e2ecbt'))set['info.slots.'+slot]=null;
        if(Object.keys(set).length){await db.collection('character').updateOne({_id:c._id},{$set:set});cleared.push([c.info.name,Object.keys(set).length]);}}
      return cleared;})()`,{owner:manifest.auth.split('-')[0]});
    if(initialGatheringReady){
      const availability=await game.admin(`output=(async()=>{
        if(Object.keys(players).length||Object.keys(dc_players).length)throw Error('Gathering availability requires disconnected native clients');
        const query={owner:data.owner,name:'e2emerchant'},before=await db.collection('character').findOne(query);
        if(!before)throw Error('Owned gathering merchant missing');
        const ready=new Date(0),update=await db.collection('character').updateOne(query,{$set:{'info.p.dt.fishing':ready,'info.p.dt.mining':ready}});
        if(update.matchedCount!==1)throw Error('Gathering availability seed did not match exactly one character');
        const after=await db.collection('character').findOne(query);
        return {name:after.info.name,before:before.info.p.dt||{},after:after.info.p.dt};})()`,{owner:manifest.auth.split('-')[0]});
      await testInfo.attach('declared-native-gathering-ready-before-login',{body:JSON.stringify(availability),contentType:'application/json'});
    }
    if(initialEventSpawn){const spawn=await nativeEventSpawn(game.admin,initialEventSpawn);initialPosition={...spawn,x:spawn.x+160};
      await testInfo.attach('native-event-catalog-initial-position',{body:JSON.stringify({event:initialEventSpawn,spawn,initialPosition}),contentType:'application/json'});}
    if(initialMonsterSpawn){const spawn=await nativeMonsterInitialPosition(game.admin,initialMonsterSpawn);initialPosition={map:spawn.map,x:spawn.x,y:spawn.y};
      await testInfo.attach('native-monster-collision-safe-initial-position',{body:JSON.stringify(spawn),contentType:'application/json'});}
    if (initialPosition) {
      await game.admin("output=db.collection('character').updateMany({owner:data.owner},{$set:{'info.map':data.map,'info.x':data.x,'info.y':data.y}})", { owner: manifest.auth.split('-')[0], ...initialPosition });
      await testInfo.attach('native-initial-position-seed', { body: JSON.stringify(initialPosition), contentType: 'application/json' });
    }
    if(initialPositions){
      if(Object.keys(initialPositions).some(name=>!names.includes(name)))throw Error('Initial positions contain an unowned native fixture character');
      const staging=await game.admin(`output=(async()=>{
        if(Object.keys(players).length||Object.keys(dc_players).length)throw Error('Initial positions require disconnected native clients');
        const result=[];
        for(const [name,point] of Object.entries(data.positions)){
          if(!G.maps[point.map]||!Number.isFinite(point.x)||!Number.isFinite(point.y))throw Error('Invalid declared native position: '+name);
          const body={type:'character',map:point.map,x:point.x,y:point.y};set_base(body);
          const cell=smap_data[point.map]===-1?0:smap_data[point.map]?.[rphash(point.x,point.y)];
          if(!can_move({...body,going_x:point.x,going_y:point.y})||!(cell<2))throw Error('Native geometry rejects declared position: '+name);
          const updated=await db.collection('character').updateOne({name:name.toLowerCase()},{$set:{'info.map':point.map,'info.in':point.map,'info.x':point.x,'info.y':point.y}});
          if(updated.matchedCount!==1)throw Error('Native staging character missing: '+name);
          result.push({name,...point,base:body.base,cell,selfClear:true});
        }return result;})()`,{positions:initialPositions});
      await testInfo.attach('native-separated-initial-positions',{body:JSON.stringify(staging),contentType:'application/json'});
    }
    await testInfo.attach('native-loadout-seed', {body:JSON.stringify(equipment,null,2),contentType:'application/json'});
    await testInfo.attach('live-seed', { body: JSON.stringify({ ...manifest, auth: '[disposable credential omitted]' }, null, 2), contentType: 'application/json' });
    // The child binds port zero atomically; retain its reported port on restart.
    let port=0;
    const occupiedPort=occupyCoordinatorPort?await unusedPort():null, log = path.join(directory, 'coordinator.log');
    let coordinator: ChildProcess | undefined;
    let identityEnvironment:NodeJS.ProcessEnv={},faultEnvironment:NodeJS.ProcessEnv={};
    // A video records per context, so a recording test opens its own. Every other test reuses the
    // worker's context: its pages close per test and its storage clears, while its HTTP cache
    // keeps the game's static files warm, which a cold context loaded again in about 7 s per test.
    const ownContext=recordNativeVideo;
    const blocked: string[] = ownContext?[]:workerBrowser.blocked;
    blocked.splice(0);
    const network=ownContext?await nativeNetworkIsolation(blocked):workerBrowser.network;
    const context = ownContext ? await browser.newContext({proxy:network.proxy, viewport: { width: 1280, height: 900 },
      ...(recordNativeVideo ? {recordVideo: { dir: testInfo.outputPath('native-video'), size: { width: 960, height: 675 } }} : {}) }).catch(async error=>{await network.close();throw error;})
      : await workerBrowser.reuse(observationClock.backend==='chronal-network');
    if(!ownContext)await testInfo.attach('native-context-reuse',{body:JSON.stringify(workerBrowser.reuses()),contentType:'application/json'});
    if(observationClock.backend==='chronal-network'){
      const clockScript=`globalThis.__e2eClockConfiguration=${JSON.stringify({rate:observationClock.rate,wall:observationClock.wall,epoch:observationClock.epoch,broker:process.env.E2E_CLOCK_BROKER,token:process.env.E2E_CLOCK_TOKEN,scope:directory})};\n`+readFileSync(path.join(root,'.build/sim/browser-clock.js'),'utf8');
      // The clock's init script names this test's scope. A context-wide script can't be removed,
      // so the reused context installs it on each page it opens for this test.
      const clockTarget=async(target:BrowserContext|Page)=>{
      const frames=new Map<Frame,string>();
      const retire=async(id:string)=>{const url=new URL('/leave',process.env.E2E_CLOCK_BROKER);url.searchParams.set('token',process.env.E2E_CLOCK_TOKEN||'');url.searchParams.set('id',id);await fetch(url);};
      await target.exposeBinding('__e2eChronalFrame',async({frame},id:string)=>{
        const previous=frames.get(frame);if(previous&&previous!==id)await retire(previous);frames.set(frame,id);
      });
      const detached=(page:Page)=>page.on('framedetached',frame=>{const id=frames.get(frame);frames.delete(frame);if(id)void retire(id).catch(error=>exchanges.push({clockRetirementError:String(error)}));});
      if('newPage' in target)target.on('page',detached);else detached(target);
      await target.addInitScript({content:clockScript});
      };
      const clockContext=async(context:BrowserContext)=>{await clockTarget(context);await waitForBrowserClockStartup(context);};
      await clockContext(dashboardContext);
      if(ownContext)await clockContext(context);else workerBrowser.preparePage(clockTarget);
    }
    await testInfo.attach('native-video-recording-policy',{body:JSON.stringify({enabled:recordNativeVideo}),contentType:'application/json'});
    const nativePages = new Set<Page>();
    const pageOpened=(page:Page)=>nativePages.add(page);
    context.on('page', pageOpened);
    await context.addCookies([{ name: 'auth', value: manifest.auth, url: manifest.webUrl }]);
    const access = new Access(path.join(directory, 'access.json'));
    await access.load();
    const occupied=createHttpServer((_request,response)=>response.end('owned E2E port occupant'));
    const server = gateway({ access, configured: () => true, dashboardPort: dashboard.port, get apiPort(){return port;} });
    let live: LiveGame | undefined;
    const undos: { label: string; fn: () => unknown }[] = [];
    const runUndos = async () => {
      const failed: { label: string; error: string }[] = [];
      for (const { label, fn } of undos.splice(0).reverse()) {
        try { await fn(); } catch (error) { failed.push({ label, error: String((error as Error)?.stack ?? error) }); }
      }
      if (failed.length) await testInfo.attach('fixture-undo-failures', { body: JSON.stringify(failed, null, 2), contentType: 'application/json' });
      return failed;
    };
    const undoFailure = (failed: { label: string }[]) => Error('A row plant could not be undone: ' + failed.map(f => f.label).join('; '));
    const clients: Record<string, LiveClient> = {};
    const exchanges: unknown[] = [];
    // The ledger keeps a result of up to 4 KB whole and only the head of a larger one. A hook row's
    // heard poll answers every notice since the row began, once or twice a second for minutes, and
    // whole copies of those answers ran the worker out of memory (live-items-hooks.spec.ts, step items.listed).
    const ledgered = (result: unknown) => {
      const text = JSON.stringify(result) ?? 'undefined';
      return text.length <= 4096 ? result : { bytes: text.length, head: text.slice(0, 512) };
    };
    const primaryName = 'E2EWarrior';
    const optionsFor = (name: string) => ({ webUrl: manifest.webUrl, coordinatorUrl: `http://127.0.0.1:${port}`,
      name, region: manifest.region, server: manifest.server,
      ...(name === primaryName ? {} : { primary: clients[primaryName] }) });
    async function start() {
      coordinator = child(path.join(root, 'e2e/live-coordinator.cjs'), [], root,
        environment({ E2E_COORDINATOR_PORT: String(port), E2E_DATA_DIR: directory,
          E2E_GAME_WEB_URL: manifest.webUrl, E2E_GAME_AUTH: manifest.auth, E2E_NATIVE_ARTIFACT: JSON.parse(process.env.E2E_DASHBOARD_CANDIDATE || 'null')?.directory || '', E2E_MERCHANT_DEFAULT: JSON.stringify(merchantDefault), E2E_ALLOW_HEADLESS: String(liveHeadless), PARTY_MOVEMENT_MODE: movementMode, E2E_STALE_WORKER_REALM: staleWorkerRealm || '',
          E2E_CLOCK_RATE:process.env.E2E_CLOCK_RATE||'1',E2E_CLOCK_WALL_EPOCH:process.env.E2E_CLOCK_WALL_EPOCH||'',E2E_CLOCK_VIRTUAL_EPOCH:process.env.E2E_CLOCK_VIRTUAL_EPOCH||'',
          E2E_CLOCK_BROKER:process.env.E2E_CLOCK_BROKER||'',E2E_CLOCK_TOKEN:process.env.E2E_CLOCK_TOKEN||'',E2E_CLOCK_SCOPE:directory,
          E2E_CLOCK_PRELOAD:'1',NODE_OPTIONS:[process.env.NODE_OPTIONS,`--import=${JSON.stringify(pathToFileURL(path.join(root,'tools/sim/network-clock-preload.mjs')).href)}`].filter(Boolean).join(' '),...identityEnvironment,...faultEnvironment }), log);
      const current = coordinator;
      await new Promise<void>((resolve, reject) => {
        const details = () => existsSync(log) ? readFileSync(log, 'utf8').slice(-16000) : 'No coordinator output';
        const timeout = setTimeout(() => failed(new Error(`Live coordinator startup timed out\n${details()}`)), 90_000);
        const cleanup = () => { clearTimeout(timeout); current.removeListener('message', message); current.removeListener('error', failed); current.removeListener('exit', exited); };
        const failed = (error: Error) => { cleanup(); reject(error); };
        const exited = (code: number | null) => failed(new Error(`Live coordinator exited (${code})\n${details()}`));
        const message = (value: any) => { if (value?.type === 'ready') {
          if(!Number.isInteger(value.port)||value.port<=0||(port!==0&&value.port!==port)){failed(new Error('Coordinator readiness reported an invalid or changed port'));return;}
          port=value.port;
          try{if(observationClock.backend==='chronal-network'){
            expect(value.clock?.backend).toBe('chronal-network');expect(value.clock.rate).toBe(observationClock.rate);expect(value.clock.epoch).toBe(observationClock.epoch);expect(value.clock.errors).toEqual([]);
          }}catch(error){failed(error as Error);return;}
          cleanup(); resolve(); } };
        current.on('message', message); current.once('error', failed); current.once('exit', exited);
      });
    }
    async function publicRestartReady(reason:string):Promise<void> {
      const observations:RestartStateProbe[]=[];
      try{await waitForLiveRestartState(live!.url,row=>{
        observations.push(row);if(observations.length>32)observations.splice(8,1);
      });}
      finally{exchanges.push({at:Date.now(),coordinatorRestartReadiness:reason,observations});}
    }
    let peacefulAmbientSeeded=false;
    try {
      if(initialPeacefulAmbientMaps.length){
        const seed=await game.admin(`output=(()=>{
          if(Object.keys(players).length||Object.keys(dc_players).length)throw Error('Peaceful ambient input requires disconnected native clients');
          const maps=data.maps;
          for(const map of maps)if(!instances[map])throw Error('Unknown peaceful ambient map: '+map);
          const saved=globalThis.__e2eInitialPeacefulAmbient={definitions:structuredClone(G.monsters),ambient:[],construct:new_monster};
          const declare=m=>{
            if(!m||!maps.includes(m.map))return m;
            saved.ambient.push({map:m.in,id:m.id,aggro:m.aggro,peaceful:m.peaceful});
            m.aggro=0;m.peaceful=true;
            if(m.target)stop_pursuit(m,{stop:true,cause:'declared peaceful initial population'});
            return m;
          };
          // Keep native respawns and unrelated maps intact; apply the same
          // declared input to later actors in these two journey maps only.
          new_monster=function(){return declare(saved.construct.apply(this,arguments));};
          for(const map of maps)for(const m of Object.values(instances[map].monsters))declare(m);
          return {at:Date.now(),maps,actors:saved.ambient.length,players:Object.keys(players).length};
        })()`,{maps:initialPeacefulAmbientMaps});
        peacefulAmbientSeeded=true;
        await testInfo.attach('peaceful-ambient-before-native-login',{body:JSON.stringify(seed),contentType:'application/json'});
      }
      if(occupiedPort!==null){
        await new Promise<void>((resolve,reject)=>{occupied.once('error',reject);occupied.listen(occupiedPort,'127.0.0.1',resolve);});
        await testInfo.attach('declared-coordinator-port-occupant',{body:JSON.stringify({port:occupiedPort}),contentType:'application/json'});
      }
      await start();
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      // The owner checks its four invariants on every task tick
      // and keeps each break; any test that loads it fails on a break no row planted. The check runs
      // before each coordinator stop, whose restart starts the record again, and at the end.
      const plantedBreaks: string[] = [];
      // A call limit disconnect fails the test with the server's
      // report, unless a row declared it.
      const declaredLimitdcs: Record<string, number> = {};
      const limitdcCheck = () => {
        const undeclared = Object.entries(clients).flatMap(([name, client]) => {
          const reports = client.limitdcs().filter(entry => entry.event === 'limitdcreport');
          return reports.slice(declaredLimitdcs[name] || 0).map(entry => ({ name, at: entry.at, report: entry.data }));
        });
        if (undeclared.length) throw Error('Call limit disconnect (limitdc) no row declared: ' + JSON.stringify(undeclared));
      };
      const taskInvariants = async () => {
        const response = await fetch(url + '/party-api/tasks', { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw Error('Task diagnostics failed: ' + response.status);
        const read = await response.json();
        const broken = read.breaks.filter((b: { detail: string; invariant: number; group: string }) => b && !plantedBreaks.some(detail => b.detail.includes(detail)));
        if (broken.length) {
          await testInfo.attach('task-owner-at-break', { body: JSON.stringify(read, null, 1), contentType: 'application/json' });
          throw Error(`Task invariant ${broken[0].invariant} broke in ${broken[0].group}: ${broken[0].detail}`);
        }
        // The assignment each member's CODE holds from the
        // heartbeat reply is its group's live task. A reply lands once per report, so the check
        // polls for one read in which every member with a running CODE agrees with the owner. A
        // member whose CODE read fails disagrees with its error. The check reads only a member a
        // native slot holds: a headless member's CODE runs in its worker process, out of the
        // harness's reach, and an offline member runs no CODE. Its last report still names the
        // native runtime after logoutNative, so the slots decide.
        // The merchant gets no reply while
        // the row holds its reports (holdMerchantStatus), and a CODE the Steam recovery restarted
        // meanwhile holds no task yet, so the check leaves it out until the row releases them.
        const merchantHeld = () => ['hold-merchant-status', 'hold-merchant-inventory'].some(marker => existsSync(path.join(directory, marker)));
        const disagreements = async () => {
          const groups = (await (await fetch(url + '/party-api/tasks', { signal: AbortSignal.timeout(15_000) })).json()).groups as any[];
          const slots = (await (await fetch(url + '/party-api/state?catalog=0', { signal: AbortSignal.timeout(15_000) })).json()).activeSlots || [];
          const wrong: unknown[] = [];
          for (const g of groups) for (const name of g.members as string[]) {
            if (!nativeSlot(slots, name)) continue;
            if (name === 'E2EMerchant' && merchantHeld()) continue;
            const held = clients[name] && await clients[name].run('(()=>{const t=globalThis.partyTasks.assignment.memberTask();return t&&t.task?{kind:t.task.kind,owner:t.task.owner}:null;})()').catch((error: unknown) => ({ error: String(error) }));
            if (held === undefined) continue;
            if (held?.kind !== g.live.kind || held?.owner !== g.live.owner) wrong.push({ name, group: g.id, live: { kind: g.live.kind, owner: g.live.owner }, held });
          }
          return wrong;
        };
        await expect.poll(disagreements, { timeout: 15_000, message: "Each member's assignment is its group's live task" }).toEqual([]);
      };
      live = {
        url, clients, coordinatorBinding:{port,occupiedPort}, status:null,
        async tasks() {
          const response = await fetch(url + '/party-api/tasks', { signal: AbortSignal.timeout(15_000) });
          if (!response.ok) throw Error('Task diagnostics failed: ' + response.status);
          return response.json();
        },
        async taskOps(ops) { return (await live!.post('/e2e-tasks', { ops })).results; },
        undo(label, fn) { undos.push({ label, fn }); },
        async undoRow() { const failed = await runUndos(); if (failed.length) throw undoFailure(failed); },
        sampleCalls(sampled) {
          const samples: CallSample[] = [];
          let running = true;
          // The server's sum as get_call_cost counts it (server_functions.js:5473-5490), read from
          // the socket's entries so a plant on get_call_cost never reaches the sampler.
          const read = 'output=(()=>{const now=Date.now(),server={},calls={};for(const n of data.names){const p=get_player(n);'
            + 'server[n]=p&&p.socket&&Array.isArray(p.socket.calls)?p.socket.calls.reduce((sum,c)=>now-c[0]<='+CALL_WINDOW_MS+'?sum+c[2]:sum,0):null;'
            // Each entry of the window, so a server sample above the budget's used names its calls.
            + 'calls[n]=p&&p.socket&&Array.isArray(p.socket.calls)?p.socket.calls.filter(c=>now-c[0]<='+CALL_WINDOW_MS+').map(c=>[+c[0],c[1],c[2]]):null;}return {at:now,server,calls};})()';
          const usedOf = async (name: string) => {
            const client = clients[name];
            if (!client || client.page.isClosed()) return null;
            return client.run('(()=>{const v=globalThis.__partyCalls?.view?.(),now=Date.now();return v?{at:now,used:v.used,margin:v.margin,latest:v.latest,ledger:v.ledger,cc:v.cc,ccAt:v.ccAge==null?null:now-v.ccAge,ccSeq:v.ccSeq??null,ccFrom:v.ccFrom??null}:null;})()').catch(() => null);
          };
          // The server read and each character's read run on their own 250 ms loops, so a slow
          // page evaluation never stretches the server's sampling.
          const latest: Record<string, CallSample['used'][string]> = {};
          const tick = async (work: () => Promise<void>) => {
            while (running) {
              const started = Date.now();
              await work();
              await new Promise(resolve => setTimeout(resolve, Math.max(0, 250 - (Date.now() - started))));
            }
          };
          const loops = [tick(async () => {
            try {
              const server = await game.admin(read, { names: sampled });
              samples.push({ at: server.at, server: server.server, calls: server.calls, used: { ...latest } });
            } catch (error) { samples.push({ at: Date.now(), server: {}, used: {}, error: String(error) } as CallSample); }
          }), ...sampled.map(name => tick(async () => {
            const used = await usedOf(name);
            latest[name] = used;
          }))];
          const stop = async () => { running = false; await Promise.all(loops); return samples; };
          undos.push({ label: 'call sampler of ' + sampled.join(', '), fn: stop });
          return { stop };
        },
        async plantCallCost(name, add) {
          await game.admin(`output=(()=>{const real=globalThis.__e2eRealCallCost||(globalThis.__e2eRealCallCost=get_call_cost);
            const plants=globalThis.__e2eCallPlants||(globalThis.__e2eCallPlants={});if(data.add)plants[data.name]=data.add;else delete plants[data.name];
            get_call_cost=Object.keys(plants).length?function(socket){const cost=real.apply(this,arguments);const add=socket&&socket.name&&plants[socket.name];return add?cost+add:cost;}:real;return true;})()`, { name, add });
          exchanges.push({ at: Date.now(), callCostPlant: { name, add } });
        },
        declareLimitdc(name) { declaredLimitdcs[name] = (declaredLimitdcs[name] || 0) + 1; exchanges.push({ at: Date.now(), declaredLimitdc: name }); },
        expectTaskBreak(detail) { plantedBreaks.push(detail); },
        async state(catalogs = false) {
          // Match the dashboard's existing catalog-free polling API. Catalog checks
          // explicitly request the full projection; never cache or synthesize state.
          const response = await fetch(url + '/party-api/state' + (catalogs === 'fast' ? '?section=fast' : catalogs ? '' : '?catalog=0'), { signal: AbortSignal.timeout(15_000) });
          if (!response.ok) throw Error('Live state failed: ' + response.status + ': ' + (await response.text()).slice(0,512));
          return response.json();
        },
        async post(route, body) {
          const endpoint = route.startsWith('/party-api/') ? route : '/party-api' + route;
          const response = await fetch(url + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url },
            body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
          const result = await response.json();
          exchanges.push({ at: Date.now(), route: endpoint, body, status: response.status, result: ledgered(result) });
          if (!response.ok) throw Error(`${endpoint}: ${response.status} ${JSON.stringify(result)}`);
          return result;
        },
        async admin(code) {
          const result = await game.admin(code);
          exchanges.push({ at: Date.now(), administrative: true, code, result: ledgered(result) });
          return result;
        },
        async adminRealm(realm,code) {
          const result = await game.admin(code,{},realm);
          exchanges.push({at:Date.now(),administrative:true,realm,code,result:ledgered(result)});
          return result;
        },
        holdMerchantStatus(hold, options={}) {
          const marker=path.join(directory,options.completionOnly?'hold-merchant-completion':options.inventoryOnly?'hold-merchant-inventory':'hold-merchant-status');
          if(hold) writeFileSync(marker,'Declared missing merchant arrival reports');
          else rmSync(marker,{force:true});
          exchanges.push({at:Date.now(),transportFault:'merchant-status',hold});
        },
        consoleDrainLease(id, expires = Date.now()+180000, options={}) {
          const file = path.join(directory,LEASE_FILE);
          mkdirSync(path.dirname(file),{recursive:true});
          if (id) writeFileSync(file,JSON.stringify({id,mode:'draining',expires,...options}));
          else rmSync(file,{force:true});
          exchanges.push({at:Date.now(),hostMaintenanceLease:id,expires});
        },
        async restartCoordinator(whileDown,faults) { await taskInvariants(); await stop(coordinator!, true);
          // A whileDown step that throws still gets the coordinator back before the error surfaces, so the rows after it find a live coordinator.
          let failure: unknown; try { await whileDown?.(); } catch (error) { failure = error ?? Error('whileDown failed'); }
          if(faults)faultEnvironment={...faults}; await start(); await publicRestartReady('explicit restart');
          if (failure) throw failure; },
        deploymentPaths:{directory,apiUrl:`http://127.0.0.1:${port}`,codeRoots:[path.join(directory,'CODE/adventure_land')]},
        async restartCoordinatorIdentity(artifactId,hash){identityEnvironment={AL_CONSOLE_ARTIFACT_ID:artifactId,AL_CONSOLE_COORDINATOR_HASH:hash};await taskInvariants();await stop(coordinator!,true);await start();await publicRestartReady('identity restart');},
        async restoreHistoricalSettings(restore) {
          await stop(coordinator!, true);
          const journal = path.join(directory, 'state.jsonl');
          const entries = readFileSync(journal, 'utf8').trim().split('\n').map(line => JSON.parse(line));
          const key = stateKeys.settings;
          const stored = Object.assign({}, ...entries);
          const decoded = (stateKey: string) => typeof stored[stateKey] === 'string'
            ? JSON.parse(stored[stateKey]) : structuredClone(stored[stateKey] || {});
          const settings = decoded(key);
          const historical = await restore(structuredClone(settings));
          // The seed writes the settings, selections and bank documents, so it takes the fields the
          // declaration table places in those three.
          const lists = coordinatorSettings().lists;
          const allowed = new Set<string>([...lists.settingsFields, ...lists.selectionFields, ...lists.bankFields]);
          if (Object.keys(historical).some(key => !allowed.has(key))) throw Error('Historical seed may only patch fields of the settings, selections and bank documents');
          await testInfo.attach('declared-historical-settings-seed', { body: JSON.stringify(historical), contentType: 'application/json' });
          const bankKeys = new Set<string>(lists.bankFields);
          const bankPatch = Object.fromEntries(Object.entries(historical).filter(([field]) => bankKeys.has(field)));
          const selectionKeys = new Set<string>(lists.selectionFields);
          const selectionsPatch = Object.fromEntries(Object.entries(historical).filter(([field]) => selectionKeys.has(field)));
          const settingsPatch = Object.fromEntries(Object.entries(historical).filter(([field]) => !bankKeys.has(field) && !selectionKeys.has(field)));
          const restored: Record<string, unknown> = { [key]: { ...settings, ...settingsPatch } };
          // Settings layout 2 loads production from its own key (docs/efficiency.md, Persistence).
          if (Object.hasOwn(settingsPatch, 'production')) restored[stateKeys.production] = { production: settingsPatch.production };
          if (Object.keys(selectionsPatch).length)
            restored[stateKeys.selections] = { ...decoded(stateKeys.selections), ...selectionsPatch };
          if (Object.keys(bankPatch).length) {
            restored[stateKeys.bank] = { ...decoded(stateKeys.bank), ...bankPatch };
          }
          for (const [stateKey, value] of Object.entries(restored))
            appendFileSync(journal, JSON.stringify({ [stateKey]: value }) + '\n');
          await start();
          await publicRestartReady('historical settings restart');
        },
        async reconnectClient(name, options = {}) {
          if (!clients[name]) throw Error('Unknown owned native client: ' + name);
          const ownership = await live!.state();
          const steamNames = Object.keys(clients).filter(member =>
            ownership.characters[member]?.runtime === 'native');
          if (!steamNames.includes(name)) throw Error('Native browser reconnect requires current Steam ownership: ' + name);
          const companions = steamNames.filter(member=>member!==primaryName);
          const previous = companions.map(member=>clients[member].frame);
          if (name === primaryName) {
            await clients[name].page.close();
            await expect.poll(async () => game.admin(`output=Object.values(players).concat(Object.values(dc_players)).filter(p=>${JSON.stringify(steamNames)}.includes(p.name)).length`), { timeout: 45_000 }).toBe(0);
            clients[primaryName] = await launchGameClient(context, optionsFor(primaryName));
            // Production bridge restores its missing companions after observing the new primary session.
          } else {
            await clients[primaryName].frame.evaluate(name => (window as any).stop_character_runner(name), name);
            await live!.post('/steam/restore', {});
            await expect.poll(() => previous.every(frame => frame.isDetached()), { timeout: 30_000 }).toBe(true);
          }
          // The restore holds the companions until the question is answered, so the answer runs
          // beside their launches.
          let launched = false;
          const answer = (async () => {
            while (options.realmChoice && !launched) {
              const operation = (await live!.state()).steamSwitch;
              if (operation?.phase === 'awaiting-realm-choice')
                await live!.post('/steam/realm-choice', { operationId: operation.id, choice: options.realmChoice })
                  .catch(error => { if (!/no longer pending/.test(String(error))) throw error; });
              await new Promise(resolve => setTimeout(resolve, 250));
            }
          })();
          try {
            for (const companion of companions)
              clients[companion] = await launchGameClient(context, optionsFor(companion));
          } finally { launched = true; await answer; }
          await expect.poll(async () => (await live!.state()).steamSwitch?.phase, { timeout: 90_000 }).toBe('complete');
        },
      };
      await live.post('/formation', { leader: null });
      for (const name of names)
        await live.post('/formation', { character: name, follow: false, eventSelections: [] });
      const initial = await live.state();
      await testInfo.attach('merchant-before-native-login', {body: JSON.stringify({merchantDefault, merchantCharacter: initial.merchantCharacter}), contentType: 'application/json'});
      expect(initial.merchantCharacter).toBe(merchantDefault);
      await live.post('/merchant/routine-priorities', { priorities: {},
        enabled: Object.fromEntries(Object.keys(initial.merchantAutomations || {}).map(key => [key, false])) });
      // Keep this serial: failures retain the already connected clients for teardown and evidence.
      let nativeReadyDeadline=0;
      for (const name of names) {
        if (name !== primaryName) {
          await expect.poll(async () => {
            const response = await fetch(`http://127.0.0.1:${port}/party-api/steam/connection`);
            return (await response.json()).ready;
          }, { timeout: 30_000 }).toBe(true);
          const login = await live.post('/steam/action', { character: name, action: 'login' });
          if (login.operation?.phase === 'awaiting-realm-choice')
            await live.post('/steam/realm-choice', { operationId: login.operation.id, choice: 'stay' });
        }
        clients[name] = await launchGameClient(context, optionsFor(name));
        if (name !== primaryName) {
          if(name===names.at(-1))nativeReadyDeadline=Date.now()+90_000;
          await expect.poll(async () => (await live!.state()).steamSwitch?.phase,
            {timeout:name===names.at(-1)?Math.max(1,nativeReadyDeadline-Date.now()):90_000}).toBe('complete');
        }
      }
      await testInfo.attach('live-server-initial', { body: JSON.stringify(await live.admin(`output=Object.fromEntries(Object.values(players).filter(p=>${JSON.stringify(names)}.includes(p.name)).map(p=>[p.name,{name:p.name,map:p.map,x:p.x,y:p.y,hp:p.hp,max_hp:p.max_hp,mp:p.mp,max_mp:p.max_mp,attack:p.attack,frequency:p.frequency,speed:p.speed,armor:p.armor,resistance:p.resistance,gold:p.gold,xp:p.xp,items:p.items,slots:p.slots,s:p.s}]))`), null, 2), contentType: 'application/json' });
      // Guard the fixture contract: native recalculation must clamp initial pools.
      // Reading these values never repairs or changes a character's live stats.
      const nativeStats = await live.admin(`output=${JSON.stringify(names)}.map(name=>{const p=get_player(name);return {name,type:p.type,hp:p.hp,max_hp:p.max_hp,mp:p.mp,max_mp:p.max_mp,attack:p.attack,frequency:p.frequency,speed:p.speed,slots:p.slots}})`);
      for (const stats of nativeStats) {
        for (const key of ['hp','max_hp','mp','max_mp','attack','frequency','speed'])
          expect(Number.isFinite(stats[key]), `${loadout} ${stats.name} native ${key}`).toBe(true);
        expect(stats.hp).toBeLessThanOrEqual(stats.max_hp);
        expect(stats.mp).toBeLessThanOrEqual(stats.max_mp);
        expect(stats.max_hp).toBeGreaterThan(0);
        expect(stats.speed).toBeGreaterThan(0);
        const followStaff=loadout==='combat-follow-range'&&(stats.type==='priest'||stats.type==='mage');
        const mageLevel=(loadouts[loadout] as {mageWeaponLevel?:number}).mageWeaponLevel;
        const weaponLevel=followStaff?(stats.type==='priest'?12:15):stats.type==='mage'&&mageLevel!==undefined?mageLevel:loadouts[loadout].weaponLevel;
        expect(stats.slots.mainhand.level, `${loadout} ${stats.name} native weapon`).toBe(weaponLevel);
        if(followStaff)expect(stats.slots.mainhand.name, `${loadout} ${stats.name} native staff`).toBe('staff');
        for (const [slot, equipped] of Object.entries(loadouts[loadout].armor))
          expect(stats.slots[slot], `${loadout} ${stats.name} native ${slot}`).toMatchObject(equipped);
      }
      if(extraFighter){
        const extra=await clients.E2EBankBoi.run('({name:character.name,ctype:character.ctype,connected:parent.socket?.connected,hp:character.hp,rip:character.rip})');
        expect(extra.name).toBe('E2EBankBoi');expect(extra.ctype).toBe(extraFighter);
        expect(extra.connected).toBe(true);expect(extra.hp).toBeGreaterThan(0);expect(extra.rip).toBe(false);
        await testInfo.attach('native-fourth-fighter-admission',{body:JSON.stringify(extra),contentType:'application/json'});
      }
      await testInfo.attach('live-build-manifest', { path: path.join(root, '.build/game/manifest.json'), contentType: 'application/json' });
      const compiled=JSON.parse(readFileSync(path.join(root,'.build/game/manifest.json'),'utf8')) as GameManifest;
      const expectedCode=nativeStats.map((stats:{name:string;type:string})=>{
        const entry=Object.entries(compiled.classes).find(([ctype])=>ctype===stats.type)?.[1];
        if(!entry)throw Error('No compiled CODE for native class '+stats.type);
        return {name:stats.name,ctype:stats.type,sha256:entry.sha256};
      });
      const codeObservations:unknown[]=[];
      try{await expect.poll(async()=>{
        const state=await live!.state();
        const observed=expectedCode.map((entry:{name:string})=>({name:entry.name,ctype:state.characters[entry.name]?.ctype,sha256:state.characters[entry.name]?.codeHash}));
        if(codeObservations.length>=32)codeObservations.shift();
        codeObservations.push({at:Date.now(),observed});
        return observed;
      },{timeout:30000,message:'Every native client must acknowledge this fixture’s exact staged CODE before gameplay starts'}).toEqual(expectedCode);}
      finally{await testInfo.attach('native-initial-code-identities',{body:JSON.stringify({generation:compiled.generation,names,expected:expectedCode,observations:codeObservations}),contentType:'application/json'});}
      const nativeVersion=await clients[primaryName].run('parent.G.version');
      expect(Number.isSafeInteger(Number(nativeVersion))&&Number(nativeVersion)>0,'The primary native client must supply its actual game version').toBe(true);
      const catalogReadiness:Array<{at:number;version:unknown;choices:number}>=[];
      try{await expect.poll(async()=>{
        const state=await live!.state(true);
        if(catalogReadiness.length>=64)catalogReadiness.shift();
        catalogReadiness.push({at:Date.now(),version:state.gameVersion,choices:state.monsterChoices?.length||0});
        return String(state.gameVersion)===String(nativeVersion)&&Array.isArray(state.monsterChoices)&&state.monsterChoices.length>0;
      },{timeout:Math.max(1,nativeReadyDeadline-Date.now()),intervals:[1000],
        message:'Native bootstrap must publish the current game version and real monster catalog before starting the scenario'}).toBe(true);}
      finally{await testInfo.attach('native-bootstrap-catalog-readiness',{body:JSON.stringify({nativeVersion,deadline:nativeReadyDeadline,observations:catalogReadiness}),contentType:'application/json'});}
      if(initialConsoleHold)live.consoleDrainLease('native-initial-setup',Date.now()+600000,{loadMode:'now',phase:'holding'});
      const clockReceipts={host:observationClock,realms:await Promise.all(['USI','USII'].map(realm=>game.admin('output=globalThis.__e2eChronalClock?{backend:__e2eChronalClock.backend,rate:__e2eChronalClock.rate,wall:__e2eChronalClock.wall,epoch:__e2eChronalClock.epoch,errors:__e2eChronalClock.errors}:null',{},realm))),
        clients:await Promise.all(Object.values(clients).map(client=>client.frame.evaluate(()=>{
          const w=window as any,c=w.__e2eChronalClock,r=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
          return {game:c&&{backend:c.backend,rate:c.rate,wall:c.wall,epoch:c.epoch,errors:c.errors},code:r?.__e2eChronalClock&&{backend:r.__e2eChronalClock.backend,rate:r.__e2eChronalClock.rate,wall:r.__e2eChronalClock.wall,epoch:r.__e2eChronalClock.epoch,errors:r.__e2eChronalClock.errors}};
        })))};
      await testInfo.attach('gameplay-clock-participants',{body:JSON.stringify(clockReceipts),contentType:'application/json'});
      if(observationClock.backend==='chronal-network')for(const receipt of [...clockReceipts.realms,...clockReceipts.clients.flatMap(c=>[c.game,c.code])]){
        expect(receipt?.backend).toBe('chronal-network');expect(receipt.rate).toBe(observationClock.rate);expect(receipt.wall).toBe(observationClock.wall);expect(receipt.epoch).toBe(observationClock.epoch);expect(receipt.errors).toEqual([]);
      }
      const bodyClockSnapshot=async()=>{
        const url=new URL('/diagnostics',process.env.E2E_CLOCK_BROKER);url.searchParams.set('token',process.env.E2E_CLOCK_TOKEN||'');
        let ownership:any;
        const ownershipReads:Array<{at:number;error?:string}>=[];
        await expect.poll(async()=>{
          try{ownership=await live!.state('fast');ownershipReads.push({at:Date.now()});return !!ownership.characters;}
          catch(error){ownershipReads.push({at:Date.now(),error:String(error)});throw error;}
        },{timeout:15000,message:'Clock diagnostics require a fresh runtime ownership snapshot'}).toBe(true);
        return {host:{now:observationClock.now(),errors:observationClock.errors,observations:observationClock.observations},ownershipReads,broker:await (await fetch(url)).json(),frames:await Promise.all(Object.entries(clients).map(async([name,client])=>{
          const runtime=ownership.characters[name]?.runtime;
          // Managed headless migration/logout legitimately retires the browser frame.
          // Its clock remains represented by the broker's actual participants.
          if(runtime!=='native')return {name,runtime:runtime||'offline',clocks:[],source:'broker-participants'};
          return {name,runtime,clocks:await client.frame.evaluate(()=>{
            const w=window as any,r=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
            return [w.__e2eChronalClock,r?.__e2eChronalClock].map(c=>c&&({timing:c.timing,taskStats:c.taskStats}));
          })};
        }))};
      };
      const bodyClockBefore=observationClock.backend==='chronal-network'&&process.env.E2E_MEASURE_BROWSER_CPU==='1'?await bodyClockSnapshot():undefined;
      const rendering=process.env.E2E_MEASURE_BROWSER_CPU==='1'?await measureBrowserRendering(browser,()=>observationClock.now()):undefined;
      const cpuProfile=process.env.E2E_PROFILE_BROWSER_CPU==='1'?await context.newCDPSession(clients[primaryName].page):undefined;
      if(cpuProfile){await cpuProfile.send('Profiler.enable');await cpuProfile.send('Profiler.start');}
      // The step gate's climbs, stalls and re-sends across the test (e2e/movement-climbs.ts).
      const climbs=startMovementClimbs(clients,testInfo.titlePath.join(' > '));
      if(nativeStatusObserver)try{live.status=await observeNativeStatus(clients,fighters);}
        catch(error){await testInfo.attach('native-status-observer-install-error',{body:String(error),contentType:'text/plain'});throw error;}
      try {await use(live);await taskInvariants();limitdcCheck();} finally {
        // The status read lands before the undos change the world; a failed read fails the test
        // once the undos have run.
        const statusFailure=live.status?await live.status.finish().then(metadata=>testInfo.attach('native-event-status-metadata',{body:JSON.stringify(metadata),contentType:'application/json'})).then(()=>null,(error:unknown)=>error):null;
        // The rows' undos, newest first, before the evidence below reads the world they restore.
        const failed = await runUndos();
        await climbs().catch(error=>testInfo.attach('movement-climbs-error',{body:String(error),contentType:'text/plain'}));
        if(cpuProfile)try{const {profile}=await cpuProfile.send('Profiler.stop');await testInfo.attach('native-browser-cpu-profile',{body:JSON.stringify(profile),contentType:'application/json'});}finally{await cpuProfile.detach();}
        if(rendering)await testInfo.attach('browser-rendering-cpu',{body:JSON.stringify(await rendering(),null,2),contentType:'application/json'});
        if(bodyClockBefore)await testInfo.attach('gameplay-clock-body-timing',{body:JSON.stringify({before:bodyClockBefore,after:await bodyClockSnapshot()}),contentType:'application/json'});
        if (failed.length) throw undoFailure(failed);
        if (statusFailure) throw statusFailure;
      }
    } finally {
      rmSync(path.join(directory,'hold-merchant-status'),{force:true});
      rmSync(path.join(directory,'hold-merchant-inventory'),{force:true});
      rmSync(path.join(directory,'hold-merchant-completion'),{force:true});
      const attach = async (name: string, body: unknown) => testInfo.attach(name, { body: JSON.stringify(body, null, 2), contentType: 'application/json' });
      const diagnostic = async (work: Promise<unknown>) => {
        let timer: ReturnType<typeof setTimeout>;
        try { return await Promise.race([work, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Diagnostic timed out after 10 seconds')), 10_000);
        })]); }
        catch (error) { return { error: String(error) }; }
        finally { clearTimeout(timer!); }
      };
      const screenshots = new Set<Page>();
      const screenshot = async (page: Page, name: string) => {
        if (screenshots.has(page)) return;
        screenshots.add(page);
        try { await testInfo.attach(name, { body: await page.screenshot({ timeout: 10_000 }), contentType: 'image/png' }); }
        catch (error) { await attach(name + '-error', { error: String(error) }); }
      };
      try {
        if (live) {
          // A scenario that stopped the server's event lineup (event-death-helpers.ts
          // peacefulWorld) gets it back, so the next scenario on this server sees its own lineup.
          await diagnostic(live.admin('output=(()=>{if(globalThis.__e2eLineup){event_schedule_tick=globalThis.__e2eLineup;delete globalThis.__e2eLineup;}return true;})()'));
          // A plant a row left on get_call_cost goes, so the next test on this server reads the real sum.
          await diagnostic(live.admin('output=(()=>{if(globalThis.__e2eRealCallCost){get_call_cost=globalThis.__e2eRealCallCost;delete globalThis.__e2eRealCallCost;delete globalThis.__e2eCallPlants;}return true;})()'));
          await attach('live-final-state', await live.state(true).catch(error => ({ error: String(error) })));
          await attach('live-server-final', await live.admin(`output=Object.fromEntries(Object.values(players).filter(p=>${JSON.stringify(names)}.includes(p.name)).map(p=>[p.name,{name:p.name,map:p.map,x:p.x,y:p.y,hp:p.hp,mp:p.mp,gold:p.gold,xp:p.xp,items:p.items,slots:p.slots,s:p.s}]))`).catch(error => ({ error: String(error) })));
        }
        // Movement step 11: each character's calls that named no request, by call site
        // (runtime/movement/character/owner.ts `typed`). A console site among them is a console
        // caller that lost its requester; the whole-suite run gathers them in one file.
        // A character with no native slot at teardown (a headless worker, a logged out window) has
        // no game frame, and each frame read on it retries until the 10 s diagnostic cap. The
        // BankBoi rows spent about 40 s of teardown that way, so those reads record the runtime.
        const finalOwnership = live ? await diagnostic(live.state()) as any : null;
        const windowless = (name: string) => Array.isArray(finalOwnership?.activeSlots) && !nativeSlot(finalOwnership.activeSlots, name);
        const windowlessRead = (name: string) => ({ runtime: finalOwnership?.characters?.[name]?.runtime || 'offline', source: 'no native slot at teardown' });
        for (const [name, client] of Object.entries(clients)) {
          if (client.page.isClosed() || windowless(name)) continue;
          const typed = await diagnostic(client.run('globalThis.__partyMovement?.ownerReport?.().typed ?? null'));
          if (typed && typeof typed === 'object' && !('error' in typed) && Object.keys(typed).length) {
            const file = path.resolve('.build/e2e-results/typed-calls.jsonl');
            mkdirSync(path.dirname(file), { recursive: true });
            appendFileSync(file, JSON.stringify({ test: testInfo.titlePath.join(' > '), name, typed }) + '\n');
          }
        }
        for (const [name, client] of Object.entries(clients)) {
          if(observationClock.backend==='chronal-network'&&!client.page.isClosed()){
            const ownership=live&&await live.state();
            if(ownership&&nativeSlot(ownership.activeSlots||[],name)){
              let latest:unknown,observations:Array<{at:number;ready:boolean}>=[];
              const clocks=await diagnostic((async()=>{
                await expect.poll(async()=>{
                  latest=await client.frame.evaluate(()=>{
                    const w=window as any,r=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
                    return [w.__e2eChronalClock,r?.__e2eChronalClock].map(c=>c&&({backend:c.backend,now:c.now(),errors:c.errors,epoch:c.epoch,rate:c.rate,state:c.state,timing:c.timing,taskStats:c.taskStats,join:c.join}));
                  });
                  const ready=Array.isArray(latest)&&latest.length===2&&latest.every(c=>c?.backend==='chronal-network'&&c.state?.ticks>0);
                  if(observations.length>=32)observations.shift();observations.push({at:Date.now(),ready});return ready;
                },{timeout:15_000,message:'Current native game and CODE clocks must finish joining after realm/client replacement'}).toBe(true);
                return latest;
              })());
              await attach(name+'-final-clock',clocks);
              await attach(name+'-final-clock-readiness',{observations,latest});
              expect(Array.isArray(clocks),'Browser-owned characters must retain both final clock observations').toBe(true);
              if(Array.isArray(clocks))for(const clock of clocks){expect(clock?.backend).toBe('chronal-network');expect(clock?.errors).toEqual([]);}
            }else await attach(name+'-final-clock',{runtime:ownership?.characters[name]?.runtime||'offline',source:'broker-participants'});
          }
          await attach(name + '-native-disconnects', client.disconnects());
          if (client.limitdcs().length) await attach(name + '-limitdc', client.limitdcs());
          await attach(name + '-native-events', windowless(name) ? windowlessRead(name) : await diagnostic(client.events()));
          await attach(name + '-character', windowless(name) ? windowlessRead(name) : await diagnostic(client.snapshot()));
          await attach(name + '-errors', client.errors);
          await screenshot(client.page, 'native-game-group');
        }
        for (const [index, page] of context.pages().entries()) {
          if (Object.values(clients).some(client => client.page === page)) continue;
          await screenshot(page, `startup-page-${index}`);
          await attach(`startup-page-${index}-location`, { url: page.url() });
        }
        await attach('live-action-ledger', exchanges);
        const visitorStatus = path.join(directory,'home-visitor-status.jsonl');
        if(existsSync(visitorStatus)) await testInfo.attach('home-visitor-status',{path:visitorStatus,contentType:'application/x-ndjson'});
        await attach('live-blocked-external-requests', blocked);
        if(observationClock.backend==='chronal-network'){
          const url=new URL('/diagnostics',process.env.E2E_CLOCK_BROKER);url.searchParams.set('token',process.env.E2E_CLOCK_TOKEN||'');await attach('gameplay-clock-final',await (await fetch(url)).json());
        }
      } finally {
        try {
          context.off('page', pageOpened);
          if (!ownContext) workerBrowser.preparePage(null);
          // Closing the pages logs the characters out, as closing the whole context did.
          const closed = await diagnostic(ownContext ? context.close() : Promise.all(context.pages().map(page => page.close())));
          if (closed && !Array.isArray(closed)) await attach('native-context-close-diagnostic', closed);
          for (const [index, page] of [...nativePages].entries()) {
            const video = page.video();
            if (!video) continue;
            const result = await diagnostic((async () => {
              await testInfo.attach(`native-game-video-${index}`, { path: await video.path(), contentType: 'video/webm' });
            })());
            if (result) await attach(`native-game-video-${index}-diagnostic`, result);
          }
        } finally {
          if (ownContext) await diagnostic(network.close());
          occupied.closeAllConnections();
          if(occupied.listening)await diagnostic(new Promise<void>(resolve=>occupied.close(()=>resolve())));
          server.closeAllConnections();
          await diagnostic(new Promise<void>(resolve => {
            if (server.listening) server.close(() => resolve());
            else resolve();
          }));
          try { if (coordinator) await stop(coordinator, true); }
          finally {
            if(peacefulAmbientSeeded)await game.admin(`output=(()=>{
              const saved=globalThis.__e2eInitialPeacefulAmbient;
              for(const [type,definition] of Object.entries(saved.definitions))G.monsters[type]=definition;
              for(const previous of saved.ambient){const m=instances[previous.map].monsters[previous.id];if(m)for(const key of ['aggro','peaceful']){
                if(previous[key]===undefined)delete m[key];else m[key]=previous[key];
              }}
              new_monster=saved.construct;delete globalThis.__e2eInitialPeacefulAmbient;return true;
            })()`);
            if(observationClock.backend==='chronal-network'){
              const endpoint=new URL('/scope',process.env.E2E_CLOCK_BROKER);endpoint.searchParams.set('scope',directory);endpoint.searchParams.set('token',process.env.E2E_CLOCK_TOKEN||'');await fetch(endpoint);
            }
            let logsCopied=true;
            for (const file of [log, dashboard.log, path.join(directory, 'state.jsonl'),path.join(directory,'native-assets-receipts.jsonl')])
              if (existsSync(file)) {
                const copy=await diagnostic(testInfo.attach(path.basename(file), { path: file, contentType: 'text/plain' }));
                if(copy!==undefined)logsCopied=false;
              }
            await attach('workspace-cleanup',logsCopied?cleanupWorkspace(root,directory):{
              workspace:path.relative(root,directory),removed:false,retained:true,reason:'Log attachment copy failed'});
          }
        }
      }
    }
  }, { timeout: 300_000 }],
  // A baseURL -> live dependency delays Playwright's automatic artifact recorder until
  // after native contexts exist. Keep context options independent so its single
  // recorder captures native setup, game actions, and dashboard pages together.
  // Live specs navigate using live.url explicitly.
  baseURL: async ({}, use) => { await use(undefined); },
});
export { expect };
export {waitForGameplay} from './network-clock';

// The server's event lineup off, as peacefulWorld keeps it (event-death-helpers.ts), and every
// event it started since the first reset ended the way endEvent ends one: its status entry goes
// and its next round is held an hour out. What was live at the first reset stays (the second
// merged run ended the Halloween season itself, and no fighter reached Mr. Green or the
// Horseman), and so does an event a row seeds, which the row ends itself.
export async function peacefulLineup(live:LiveGame){
  await live.admin(`output=(()=>{if(!globalThis.__e2eLineup){globalThis.__e2eLineup=event_schedule_tick;event_schedule_tick=function(){};}
    // The death rows' peacefulWorld can hold the lineup first, so the kept list is its own.
    if(!globalThis.__e2eLineupKept)globalThis.__e2eLineupKept=Object.keys(E).filter(type=>E[type]&&E[type].live);
    const kept=new Set([...globalThis.__e2eLineupKept,'mrgreen','horseman','icegolem']),ended=[];
    for(const type of Object.keys(E))if(E[type]&&E[type].live&&!kept.has(type)){if(typeof timers!=='undefined')timers[type]=future_s(3600);delete E[type];ended.push(type);}
    if(ended.length)broadcast_e();return ended;})()`);
}


// What the Hunt rows of the default fixture's table leave, put back by defaultFixtureReset:
// their seeded rares and definitions (cleanupEvents), the formation with the priest following
// and nobody on Manual, both fighters' mode and the merchant's stand, the passive rare rules the
// table started with, the quests, the cargo slot and the Goobrawl seed.
let huntStartRules: {rules: Record<string, any>; useFieldGenerators: boolean} | null = null;
async function huntRowsReset(live:LiveGame){
  const W='E2EWarrior',P='E2EPriest';
  // A Goobrawl row that fails while its event is live leaves the event running, and the next
  // Goobrawl row's seed refuses a live event ("Seed Goobrawl before activating it"). The reset
  // ends it the way the rows do, and the party's own event return takes it home.
  await live.admin(`output=(()=>{if(events.goobrawl)timers.goobrawl=new Date(0);return true;})()`);
  await expect.poll(()=>live.admin(`output=!events.goobrawl&&!E.goobrawl&&!Object.values(players).some(p=>p.map==='goobrawl')`),
    {timeout:180_000,message:'A Goobrawl a row left must end before the next row'}).toBe(true);
  // A Goobrawl row ends once the party is back on Main, before its event return ends; the gate
  // run's next Goobrawl row then started under that return.
  await expect.poll(async()=>{const s=await live.state();return !s.eventReturn&&!Object.keys(s.deferredEventReturns??{}).length;},
    {timeout:180_000,message:'The event return must end before the next row'}).toBe(true);
  await cleanupEvents(live);
  await live.post('/formation',{leader:W});
  // A follower's events are the leader's, so only the warrior's selection clears.
  await live.post('/formation',{character:W,handControl:{on:false},eventSelections:[]});
  await live.post('/formation',{character:P,handControl:{on:false}});
  await live.post('/formation',{character:P,follow:true});
  // Each scope goes back to the table's start: target Farming, which ends a Hunt, and combat Auto.
  // Since 11 step 6 a monster picked by hand keeps the combat mode, so a row that picks its
  // monster farms in the mode this reset leaves; before, the pick reset it to Auto.
  for(const name of [W,P])await live.post('/farming-mode',{character:name,combatMode:'auto',targetMode:'farming'});
  await expect.poll(async()=>(await live.state()).farmingPolicy,{timeout:30_000,message:'Hunt mode must end before the next row'}).not.toBe('hunt');
  await live.post('/merchant/force-stand',{enabled:false});
  // No row before the rare rows sets a rare rule, so the first reset's rules are the table's
  // start; later resets put back each rule a rare row changed and turn off each one it added.
  // The route accepts only monsters in the coordinator's catalog, which a coordinator restart
  // (the merchant's restart row) empties until the clients publish it again.
  const passive=(await live.state()).passiveHunting??{},rules=passive.rules??{};
  huntStartRules??={rules:structuredClone(rules),useFieldGenerators:!!passive.useFieldGenerators};
  const start=huntStartRules;
  const patch=Object.fromEntries(Object.keys(rules).flatMap(type=>type in start.rules
    ? JSON.stringify(rules[type])===JSON.stringify(start.rules[type])?[]:[[type,start.rules[type]]]
    : rules[type]?.enabled?[[type,{...rules[type],enabled:false}]]:[]));
  if(Object.keys(patch).length||!!passive.useFieldGenerators!==start.useFieldGenerators){
    await expect.poll(async()=>{const choices=(await live.state(true)).monsterChoices??[];return Object.keys(patch).every(type=>choices.some((m:any)=>m.id===type));},
      {timeout:120_000,message:'The coordinator catalog must list every rule the reset puts back'}).toBe(true);
    await live.post('/rare-hunting',{rules:patch,useFieldGenerators:start.useFieldGenerators});
  }
  await live.admin(`output=${JSON.stringify([W,P])}.map(name=>{const p=get_player(name);delete p.s.monsterhunt;resend(p,'u+cid+reopen');return true})`);
  // The merchant rows seed their cargo in the warrior's slot 10 (seedCargo), which the fixture
  // leaves empty and loot from earlier rows fills.
  await live.admin(`output=(()=>{const p=get_player('${W}');if(p.items[10]){p.items[10]=null;cache_player_items(p);resend(p,'u+cid+reopen');}return true;})()`);
  // The Goobrawl rows' seed (game/event-scenario.ts seedSmallGoobrawl) once per world: its
  // survivors go and the goo definitions come back, as bootstrap.cjs does between scenarios.
  await live.admin(`output=(()=>{for(const m of Object.values(instances.goobrawl?.monsters||{}))remove_monster(m,{silent:true});
    if(globalThis.__e2eGoobrawlDefinitions){for(const type of ['bgoo','rgoo'])G.monsters[type].hp=globalThis.__e2eGoobrawlDefinitions[type];delete globalThis.__e2eGoobrawlDefinitions;}return true;})()`);
}

// The default fixture's scenario table (e2e/live-movement-owner.spec.ts) resets with this between
// rows. Every row there starts from the default fixture, so all of them share one game run
// (a separate check of 2026-10-29 found the four tables that held them kept apart with no state
// named). The reset puts back what any row
// leaves: the death rows' events end, both fighters stand alive with no party recovery, and
// the party is back on Main (deathReset); Hunt mode ends; the farm focus is cleared; a party
// travel to the square replaces any travel or farm a row left; a hold a row leaves on the
// warrior is released; and both fighters settle. The server's own event lineup stays off from
// the first reset, and an event it started meanwhile ends: in the first merged run it started a
// Graveyard during the farming windows, and neither fighter then joined a seeded event. The
// event death rows run first, in their earlier order: in the second merged run, after the
// farming windows, neither fighter reached Mr. Green or the Horseman before the death, and the
// row attaches its evidence only after that wait, so the run named no cause.
export async function defaultFixtureReset(live:LiveGame){
  const W='E2EWarrior';
  await peacefulLineup(live);
  // The death rows' recovery ends first, as before the Hunt rows joined: with the Hunt cleanup
  // first, the merged run's reset after cant_join still found a party recovery live.
  await deathReset(live);
  await huntRowsReset(live);
  // The UP-3 Hunt row leaves the party in Hunt mode, which would walk it to the Hunt's monster.
  const policy=(await live.state()).farmingPolicy;
  if(policy==='hunt'){await live.post('/farming-mode',{character:W,combatMode:'auto',targetMode:'farming'});
    await expect.poll(async()=>(await live.state()).farmingPolicy,{timeout:30_000}).not.toBe('hunt');}
  await live.post('/focus',{monsterFocus:[]});
  // A party travel to the town square replaces both the walk ladder row's travel that never
  // arrives and the farm location a row picked, as the dashboard's Travel does (the tank table
  // found the party walking back to a farm a row left behind).
  await live.post('/formation',{leader:W});
  await live.post('/travel',{map:'main',x:0,y:0});
  // The convoy still live names what travels, for the failure's reading.
  await expect.poll(async()=>!(await live.state()).activeConvoy,{timeout:180_000,message:'The party travel must end before the next row'}).toBe(true)
    .catch(async error=>{console.log('RESET-CONVOY '+JSON.stringify((await live.state()).activeConvoy).slice(0,1500));throw error;});
  // 01 step 4: the travel is the party's manual task, which ends one task tick after its walk
  // arrives; a row that counts the party's task changes starts after it.
  await expect.poll(async()=>(await live.tasks()).groups.find((g:any)=>g.id===`party:${W}`)?.live?.kind,{timeout:30_000,message:'The trip task must end before the next row'}).not.toBe('manual');
  await live.clients[W].run(`(()=>{const m=__partyMovement,l=m.live();if(l&&!l.journey)m.release(l.owner);return true;})()`);
  for(const name of fighters)await settleNavigation(live.clients[name],name);
}

// The Arena table (e2e/live-farm-death-escape.spec.ts, cases B and C) logs the fighters in on its
// farm and resets with arenaReset between rows: the Arena's held skeletor respawns return
// (restoreArena), both members stand alive with no escape or death recovery live, and both stand
// on the farm again.
export const arenaFarm={map:'arena',x:384,y:-420};
export const arenaPositions=(names:string[])=>({...Object.fromEntries(names.map((name,i)=>[name,{...arenaFarm,x:arenaFarm.x+20*i}])),E2EMerchant:{map:'main',x:-63,y:100}});
export async function restoreArena(live:LiveGame){
  await live.admin(`output=(()=>{for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(m.e2eHunt)remove_monster(m,{method:'disappear',nospawn:true});
    monster_respawns.push(...(globalThis.__e2eArenaRespawns||[]));delete globalThis.__e2eArenaRespawns;return true;})()`);
}
export async function arenaReset(live:LiveGame){
  const W='E2EWarrior',P='E2EPriest';
  await restoreArena(live);
  // At rest includes the death recovery's farm return, which ends on its convoy's own end code
  //, so the next case's walk to the farm never meets it.
  await expect.poll(async()=>{const state=await live.state(),escape=await (await (await fetch(live.url+'/party-api/escape')).json()).escape;
    return [W,P].every(n=>state.characters[n]&&!state.characters[n].rip)&&(!escape||['complete','home','released','failed-hold'].includes(escape.stage))&&
      (!state.combatRecovery||['complete','cancelled'].includes(state.combatRecovery.phase));},
    {timeout:240_000,message:'The party must be at rest before the next case'}).toBe(true);
  // Back to the table's start, the fixture's farm positions. Case C leaves the priest in Main,
  // and without this case B began as the party walked in: the warrior died with the priest on
  // the Arena's spawn (151, 41), 36 units from it, so the survival ladder's relocation took
  // the door (owner-ladder.ts relocate: Town only beyond 55 units) and the walk home took 162 s
  // against the 143 s it takes from the farm.
  const start=arenaPositions([W,P]) as Record<string,{map:string;x:number;y:number}>;
  await live.admin(`output=(()=>{for(const [n,at] of Object.entries(${JSON.stringify({[W]:start[W],[P]:start[P]})})){const p=get_player(n);transport_player_to(p,at.map,[at.x,at.y]);}return true;})()`);
  for(const name of [W,P])await expect.poll(async()=>live.clients[name].run(`character.map==='arena'&&Math.hypot(character.real_x-(${start[name].x}),character.real_y-(${start[name].y}))<=20`),
    {timeout:60_000,message:'Both fighters must stand on the farm for the next case'}).toBe(true);
}

// The largest age of a character's tracker reply between `from` and `to` on its own clock: the
// longest stretch with no `tracker` reply, from the native driver's incoming events.
// A setting written for one character, then awaited until that character's page reads the written
// value: a write reaches the character with its next report reply, so a row
// that acts on the value starts once `read` answers it. Answers true, or the refused write's
// message.
export async function writeDelivered(live:LiveGame,field:string,character:string,value:unknown,read:string,label:string){
  const written=await live.post('/settings',{changes:[{field,value,character}]}).then(()=>true,(error:Error)=>String(error.message).slice(0,200));
  if(written===true)await expect.poll(()=>live.clients[character]!.run(read),{timeout:15_000,message:`${label}: ${character} reads ${JSON.stringify(value)}`}).toEqual(value);
  return written;
}
export async function trackerReplyAge(live: LiveGame, name: string, from: number, to: number) {
  const arrivals = (await live.clients[name]!.events()).filter((e: any) => e.event === 'tracker-arrived').map((e: any) => Number(e.at));
  const inside = arrivals.filter(at => at >= from && at <= to), before = arrivals.filter(at => at < from).at(-1);
  const points = [before ?? from, ...inside, to];
  let largest = 0;
  for (let i = 1; i < points.length; i++) largest = Math.max(largest, points[i]! - points[i - 1]!);
  return { largest, replies: inside.length, lastBefore: before ?? null };
}

// The server's side of one client's view of a member, for a failed plant's reading: the member's
// HP and position on the server, the observer's vision, and whether the observer's socket sheds
// entity updates. send_xy_updates skips a socket whose queue holds more than B.xy_backlog_limit
// bytes and sets `xy_resync` until it drains (server.js), and `perfc.xy_skipped` counts those
// ticks. `seen` is the revision the server last sent the observer of the member. With the
// observer as the member, it reads the member's own socket.
export async function serverView(live:Pick<LiveGame,'admin'>,observer:string,member:string){
  return live.admin(`output=(()=>{try{const o=get_player(${JSON.stringify(observer)}),m=get_player(${JSON.stringify(member)});if(!o||!m)return {observer:!!o,member:!!m};
    return {at:Date.now(),hp:m.hp,max:m.max_hp,rip:!!m.rip,map:m.map,in:m.in,sameIn:o.in===m.in,dx:Math.round(Math.abs(o.x-m.x)),dy:Math.round(Math.abs(o.y-m.y)),vision:o.vision,
      backlog:typeof socket_backlog==='function'?socket_backlog(o.socket):null,limit:typeof B!=='undefined'?B.xy_backlog_limit:null,resync:!!o.xy_resync,
      seen:o===m?null:o.seen?o.seen[m.id]??null:null,skipped:typeof perfc!=='undefined'?perfc.xy_skipped??0:null,delta:!!(o.socket&&o.socket.entity_delta),u:!!m.u};}catch(e){return String(e);}})()`);
}

// The turns rows' plant: a member's `hp` or `mp` written
// on the server, which the next player packet carries to every client. `hp` and `mp` are shares of
// the maximum; `mpAt` is an absolute MP, for a plant below a cost. It returns what the server holds.
// With `transport`, the plant and the move to that map and point go in one server step.
// A native slot (a Steam or browser window) holds the character, so the harness can read its CODE.
function nativeSlot(slots:Array<{kind?:string;character?:string|null}>,name:string){
  return slots.some(slot=>slot.kind==='native'&&slot.character===name);
}
// A character leaves its native window: the Steam logout ends, no slot holds it, and the game server
// has dropped the player, so a headless spawn of it starts clean.
export async function logoutNative(live:Pick<LiveGame,'post'|'state'|'admin'>,name:string){
  await live.post('/steam/action',{character:name,action:'logout'});
  await expect.poll(async()=>(await live.state()).activeSlots.some((slot:any)=>slot.character===name),{timeout:90_000}).toBe(false);
  await expect.poll(async()=>{const operation=(await live.state()).steamSwitch;return !operation||operation.phase==='complete';},{timeout:90_000}).toBe(true);
  await expect.poll(()=>live.admin(`output=!!get_player(${JSON.stringify(name)})`),{timeout:30_000}).toBe(false);
}
// The merchant moves from its native window to headless slot 1.
export async function headlessMerchant(live:Pick<LiveGame,'post'|'state'|'admin'>,name='E2EMerchant'){
  await logoutNative(live,name);
  await live.post('/slots/1/spawn',{character:name});
}
// A CODE reload as the game's own CODE button runs one: the native window restarts its maincode
// runner on the coordinator's loader, which the runner names as __partyServer.
// The game's `stop_runner` removes the maincode frame, so a reload after a stop reads the same
// address from the page the harness seeded.
export async function reloadCode(live:Pick<LiveGame,'clients'>,name:string){
  await live.clients[name]!.frame.evaluate(()=>{const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
    game.start_runner('maincode',`$.getScript(${JSON.stringify((runner?.__partyServer??game.__partyServer)+'/CODE/adventure_land/universal-loader.js')});`);});
}
export async function plantVitals(live:Pick<LiveGame,'admin'>,name:string,vitals:{hp?:number;mp?:number;mpAt?:number;transport?:[string,number,number]}){
  return live.admin(`output=(()=>{const p=get_player(${JSON.stringify(name)}),v=${JSON.stringify(vitals)};
    if(v.hp!==undefined)p.hp=Math.max(1,Math.round(p.max_hp*v.hp));
    if(v.mp!==undefined)p.mp=Math.max(0,Math.round(p.max_mp*v.mp));
    if(v.mpAt!==undefined)p.mp=Math.max(0,Math.round(v.mpAt));
    resend(p,'u+cid');if(v.transport)transport_player_to(p,v.transport[0],[v.transport[1],v.transport[2]]);return {at:Date.now(),hp:p.hp,max_hp:p.max_hp,mp:p.mp,max_mp:p.max_mp,mp_cost:p.mp_cost};})()`) as Promise<{at:number;hp:number;max_hp:number;mp:number;max_mp:number;mp_cost:number}>;
}
