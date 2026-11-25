import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import type {TestInfo} from '@playwright/test';
import {expect, reloadCode, type LiveGame} from './live-fixtures';
import {waitForGameplay} from './network-clock';
import {W, P, M, evidence} from './hunt-interruption-helpers';
import {arrived, point, travel} from './game/hunt-lifecycle';
import {lifecycleHooksPlay} from './lifecycle-hooks-rows';
import {reloadResumes, safeReloadRow, toReloadSpot} from './console-reload-rows';
import {mixedDeploymentPlay} from './mixed-deployment-rows';
import {walkUntil} from './event-window-helpers';

// W48's one session of reloads, deploys and restarts on a farming party (test-windows DESIGN.md
// 2.2 W48). Each round reads the party the round before it left:
//  1. the lifecycle add-on registers and holds a drain, then the safe reload round: Pause, a deploy
//     while paused, the coordinator restart beside the occupied probe port (E53), Play, the clean
//     shutdown and the CODE reload (C27, lifecycle-hooks-rows.ts);
//  2. a CODE reload during a walk and in combat, in safe and now modes (E66, E67);
//  3. a safe reload during a Hunt and event selection turnover (E65);
//  4. one published warrior build: the manifest edit alone changes nothing, the activation replaces
//     the CODE frame while its old heartbeat is held, and a rollback returns it (C1, E50);
//  5. a Main reload from the forest farm (E51);
//  6. the priest and merchant move to headless workers and one deployment barrier covers all three
//     (E52, mixed-deployment-rows.ts). Headless characters have no page, so this round is last.
export async function deploySessionPlay(live: LiveGame, info: TestInfo) {
  // Each round's wall time goes in the dump; W48's window bound is derived from them.
  const times: Record<string, number> = {};
  const round = async (name: string, play: () => Promise<void>) => {
    const start = Date.now();
    try { await play(); } finally { times[name] = Date.now() - start; }
  };
  try {
    await round('lifecycle', () => lifecycleHooksPlay(live, info, async () => {
      await toReloadSpot(live);
      const before = await reports(live);
      await safeReloadRow(live, info);
      await occupiedPortHolds(live, before);
    }));
    await round('reload-walk-combat', async () => {
      await toReloadSpot(live);
      await reloadResumes(live, info, 'safe');
      await toReloadSpot(live);
      await reloadResumes(live, info, 'now');
    });
    await round('turnover', async () => {
      await toReloadSpot(live, {map: 'main', x: 0, y: 787});
      await safeReloadRow(live, info, true);
    });
    await round('code-deploy', () => codeDeployPlay(live, info));
    await round('main-reload', () => mainReloadPlay(live, info));
    await round('mixed-deployment', () => mixedDeploymentPlay(live, info));
  } finally {
    await info.attach('w48-round-times', {body: JSON.stringify(times), contentType: 'application/json'});
  }
}

const reports = async (live: LiveGame) =>
  Object.fromEntries(await Promise.all(Object.entries(live.clients).map(async ([name, client]) => [name, await client.snapshot()]))) as Record<string, {statusAt: number}>;

// E53: the coordinator started beside the occupied probe port, kept the occupant through the
// restart, and every client reported to the restarted coordinator
// (live-console-port-binding.spec.ts at 21fe30a2b).
async function occupiedPortHolds(live: LiveGame, before: Record<string, {statusAt: number}>) {
  const binding = live.coordinatorBinding;
  expect(binding.occupiedPort).not.toBeNull();
  expect(binding.port).not.toBe(binding.occupiedPort);
  const occupant = () => fetch(`http://127.0.0.1:${binding.occupiedPort}`).then(response => response.text());
  expect(await occupant()).toBe('owned E2E port occupant');
  await expect.poll(async()=>{
    const snapshots=await Promise.all(Object.entries(live.clients).map(async([name,client])=>({name,current:await client.snapshot()})));
    return snapshots.every(({name,current})=>current.connected&&current.statusAt>before[name].statusAt);
  },{timeout:30_000}).toBe(true);
  expect((await live.state()).leader).toBe('E2EWarrior');
}

// C1 and E50 on one published warrior build. The manifest edit alone leaves the running CODE
// (E50); the activation publishes it, and the loader replaces the CODE frame while the old frame's
// first status request is held, so the old heartbeat cannot land after the replacement (C1); the
// rollback activation returns the original build (E50). The bodies are live-game.spec.ts's C1 and
// live-console-explicit-activation.spec.ts's, both at 21fe30a2b, joined on one candidate.
export async function codeDeployPlay(live: LiveGame, info: TestInfo) {
  const client = live.clients[W], game = client.frame, page = client.page;
  const manifest = JSON.parse(await readFile('.build/game/manifest.json', 'utf8')), original = manifest.classes.warrior;
  const bundle = await readFile(path.join('.build/game', original.file), 'utf8') + '\n// W48 published warrior build\n';
  const sha256 = createHash('sha256').update(bundle).digest('hex');
  const candidate = {...manifest, classes: {...manifest.classes, warrior: {...original, file: `generated/${sha256}/warrior.js`, sha256}}};
  candidate.generation = createHash('sha256').update(Object.keys(candidate.classes).map(name => name + ':' + candidate.classes[name].sha256).join('\n')).digest('hex');
  let published: unknown = null;
  const loaderObservations: unknown[] = [];
  const animationClock = await game.evaluate(() => new Promise<{timestamp: number; now: number; backend: string}>(resolve =>
    requestAnimationFrame(timestamp => resolve({timestamp, now: performance.now(), backend: (window as any).__e2eChronalClock?.backend || 'native'}))));
  expect(Number.isFinite(animationClock.timestamp)).toBe(true);
  if (animationClock.backend === 'chronal-network') expect(animationClock.timestamp).toBe(animationClock.now);
  else expect(animationClock.timestamp).toBeLessThanOrEqual(animationClock.now);
  await page.route('**/CODE/adventure_land/manifest.json*', route => route.fulfill({json: candidate}));
  await page.route('**/CODE/adventure_land/activation.json*', route => published ? route.fulfill({json: published}) : route.fulfill({status: 404, body: 'No explicit activation'}));
  await page.route(`**/CODE/adventure_land/${candidate.classes.warrior.file}*`, route => route.fulfill({contentType: 'application/javascript', body: bundle}));
  const first = (await live.state()).characters[W], runtime = first.dashboardRuntime;
  // E50: the manifest edit alone changes nothing for one full manifest poll and more.
  await waitForGameplay(6500);
  expect((await live.state()).characters[W].codeHash).toBe(original.sha256);
  expect((await live.state()).characters[W].dashboardRuntime).toBe(runtime);
  // C1's read of the frame being retired: its listeners and the native ones beside them.
  const before = await game.evaluate(() => {
    const host = window as any, runner = (document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
    host.__e2eRetiringRunner = runner; host.__e2eRetiringGame = host;
    // The lifecycle owner's run scope registers every CODE listener as a wrapper made in the
    // runner frame, so the runner realm's functions are the managed ones.
    host.__e2eManagedResponses = host.socket.listeners('game_response').filter((fn: Function) => fn instanceof runner.Function);
    host.__e2eNativeResponses = host.socket.listeners('game_response').filter((fn: Function) => !host.__e2eManagedResponses.includes(fn));
    return {generation: runner.__partyRuntimeGeneration, at: runner.__partyStatusSuccessAt, listeners: host.socket.listeners('server_info').length,
      responseListeners: host.socket.listeners('game_response').length, managedResponses: host.__e2eManagedResponses.length, name: host.character.name};
  });
  const oldFrame = game.childFrames().find(frame => new URL(frame.url()).pathname === '/runner')!;
  let release!: () => void, held = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/party-api/status*', async route => {
    if (!held && route.request().frame() === oldFrame) { held = true; await gate; }
    try { await route.continue(); } catch (error) { if (!oldFrame.isDetached()) throw error; }
  });
  try {
    await expect.poll(()=>held,{timeout:20_000}).toBe(true);
    published = {id: 'w48-published', manifest: candidate};
    await expect.poll(async () => {
      const observation = await game.evaluate(() => {
        const host = window as any, runner = (document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
        return {at: Date.now(), replaced: !!runner && runner !== host.__e2eRetiringRunner, connected: host.socket.connected,
          loaderGeneration: runner?.__partyLoaderGeneration, runtimeGeneration: runner?.__partyRuntimeGeneration,
          stopped: host.localStorage.getItem('party-code-stopped:' + host.character.name), canReload: runner?.sharedRoutine?.canReload?.()};
      });
      if (loaderObservations.length < 80) loaderObservations.push(observation);
      return observation.replaced;
    }, {timeout: 30_000, message: 'The actual loader must replace its native CODE iframe'}).toBe(true);
    release();
    await expect.poll(()=>client.snapshot().then(s=>s.statusAt||0),{timeout:30_000}).toBeGreaterThan(before.at);
    const after = await game.evaluate(() => {
      const host = window as any, old = host.__e2eRetiringRunner;
      return {sameGame: host === host.__e2eRetiringGame, connected: host.socket.connected, name: host.character.name,
        listeners: host.socket.listeners('server_info').length, responseListeners: host.socket.listeners('game_response').length,
        nativeResponsesPreserved: host.__e2eNativeResponses.every((fn: Function) => host.socket.listeners('game_response').includes(fn)),
        managedLeft: host.__e2eManagedResponses.filter((fn: Function) => host.socket.listeners('game_response').includes(fn)).length, oldGeneration: old.__partyRuntimeGeneration};
    });
    await info.attach('w48-code-replacement', {body: JSON.stringify({before, after, held, errors: client.errors, loaderObservations}), contentType: 'application/json'});
    expect(after.sameGame).toBe(true); expect(after.connected).toBe(true); expect(after.name).toBe(before.name);
    expect(after.listeners, 'Retired CODE must remove its game-window socket listeners').toBe(before.listeners);
    expect(before.managedResponses).toBeGreaterThan(0);
    expect(after.managedLeft, 'Retired CODE must remove its game_response listeners').toBe(0);
    expect(after.responseListeners, 'The new CODE registers as many game_response listeners as the old one held').toBe(before.responseListeners);
    expect(after.nativeResponsesPreserved).toBe(true);
    expect(after.oldGeneration, 'Retired callbacks must lose runtime ownership').toBeGreaterThan(before.generation);
    expect(client.errors.filter(error=>/null.*(?:character|S)|(?:character|S).*null/.test(error))).toEqual([]);
    await expect.poll(async()=>(await live.state()).characters[W]?.codeHash,{timeout:30000}).toBe(sha256);
    const deployed=(await live.state()).characters[W];
    expect(deployed.dashboardRuntime).not.toBe(runtime);
    const destination = await point(live, W, 120); await travel(live, W, destination); await arrived(live, [W], destination, 60_000);
    published = {id: 'w48-rollback', manifest};
    await expect.poll(async()=>(await live.state()).characters[W]?.codeHash,{timeout:30000}).toBe(original.sha256);
  } finally {
    release();
    await page.unroute('**/party-api/status*');
    await page.unroute('**/CODE/adventure_land/manifest.json*');
    await page.unroute('**/CODE/adventure_land/activation.json*');
    await page.unroute(`**/CODE/adventure_land/${candidate.classes.warrior.file}*`);
  }
}

// E51: a Main reload from a farm off Main parks the fighters on Main, leaves the merchant where it
// stands and walks the fighters back to the saved checkpoint (live-console-main-reload.spec.ts at 21fe30a2b).
// The old spec started on 'forest', a map game 17797 does not have (data.js maps), so this round
// walks the party to Spooky Forest's spawn (halloween 0, 0), clear of every monster boundary there.
export async function mainReloadPlay(live: LiveGame, info: TestInfo) {
  const forest = {map: 'halloween', x: 0, y: 0};
  await live.post('/merchant/force-stand', {enabled: true}); await live.post('/formation', {leader: W}); await live.post('/formation', {character: P, follow: true});
  await live.post('/focus', {monsterFocus: [], monsterPriorities: {}, monsterSearchRadius: 300});
  await live.post('/travel', forest);
  await walkUntil(live, [W, P], async () => { const s = await live.state(); return !s.activeConvoy && [W, P].every(n => s.characters[n]?.map === forest.map && Math.hypot(s.characters[n].x - forest.x, s.characters[n].y - forest.y) <= 30); },
    'Both fighters must reach the Spooky Forest farm');
  await live.post('/checkpoint', {});
  const before = await live.clients[W].snapshot(), merchant = await live.clients[M].snapshot(), samples: any[] = [];
  try {
    live.consoleDrainLease('main-reload', Date.now() + 180000, {loadMode: 'main', phase: 'moving-main'});
    await expect.poll(async()=>{const state=await live.state();samples.push({at:Date.now(),characters:Object.fromEntries([W,P,M].map(n=>[n,{map:state.characters[n]?.map,maintenance:state.characters[n]?.consoleMaintenance}]))});return [W,P].every(n=>state.characters[n]?.map==='main'&&state.characters[n]?.consoleMaintenance?.ready);},{timeout:90000}).toBe(true);
    expect((await live.clients[M].snapshot()).map).toBe(merchant.map);
    const runtime = (await live.state()).characters[W].dashboardRuntime;
    await reloadCode(live, W);
    await expect.poll(async()=>{const report=(await live.state()).characters[W];return report?.dashboardRuntime!==runtime&&report?.consoleMaintenance?.id==='main-reload';},{timeout:30000}).toBe(true);
    live.consoleDrainLease(null);
    await expect.poll(async()=>{const position=await live.clients[W].snapshot();return position.map===before.map&&Math.hypot(position.x-before.x,position.y-before.y)<30;},{timeout:120000}).toBe(true);
    expect((await live.clients[M].snapshot()).map).toBe(merchant.map);
  } finally { live.consoleDrainLease(null); await evidence(live, info, 'w48-main-reload', {before, merchant, samples}); }
}
