import { expect, type LiveGame, type CallSample } from '../live-fixtures';
import type { TestInfo, Route } from '@playwright/test';
import { liveWindow, type LiveWorld } from '../windows';
import { location, party } from '../game/hunt-lifecycle';
import { observeStatus } from '../catalog-rows';
import { spawnGoo, seedCargo, totalLeather } from '../hunt-interruption-helpers';
import {
  bandsHold, bandsRead, boundHolds, burstsHold, cb6Hold, cb6Play, costsHold, forcedLimitdcHold, forcedLimitdcPlay, holdTracktrix,
  merchantReporting, perCallCosts, pontyBurst, sampled, standBurst, STEP_MS, trackerAgeHold, trackerAgePlay, TRACKER_REFRESH_MS, type BandsRead,
} from '../call-budget-rows';
import { CALL_NOTICES, callsHooksSwitches, heardSince, registerCallsHooksAddon, type HeardNotice } from '../fixtures/calls-hooks-addon';
import { CALL_WINDOW_MS as WINDOW_MS, CALL_LIMIT, bandLimits } from '../../runtime/characters/call-budget-limits.ts';

// W05 Goo farm under call-budget pressure, ending in a forced limitdc (test-windows DESIGN.md 2.2).
// One play: the merchant's per-call charges are read on Manual while the party stands at its start
// (CB4); then the warrior and priest farm goo on Main while the merchant buys 13 planted listings at
// Ponty and opens its stand on 16 unlisted slots; the warrior reads job reads beside its fight (CB6)
// and two home-drop tables the server pushes (M02); the warrior's call figure is planted for the calls hooks (C23), then held while the
// merchant collects its leather (M04); the warrior's Tracktrix reply age is read after that last
// plant (CB24); and the window ends when the merchant is forced past the server's call limit,
// disconnected and logged in again (T47, and C23's calls.limitdc on the merchant).
// Failure modes: T40, a merchant burst passes the server's limit, a call is booked at another
// charge than the server's, or a band admits past its limit; T41, survival waits while job reads
// fill a fight's window, or the Tracktrix reply ages past its bound in a fight; T47, a limitdc
// saves no snapshot or keeps a local copy; C23, a calls hook or event of the hooks table is not
// heard; M02, a home-drop table does not reach the catalogs, or the next tracker request comes off
// the refresh; M04, a collection send goes, or fails to go, against the held call reading.
// T40 keeps CB1, CB3, CB4, CB7, CB8, CB10 and CB22 live, and T41 CB1, CB6, CB24's age and the band
// checks (DESIGN.md 4.3 T40, T41); the planted checks map to step 12 in the coverage ledger.
const W = 'E2EWarrior', P = 'E2EPriest', M = 'E2EMerchant';
const t40: any = {}, t41: any = {}, t47: any = {}, m02: any = {}, m04: any = {};
const c23 = { rows: {} as Record<string, unknown>, failed: {} as Record<string, string>, from: undefined as number | undefined };
const bands: Record<string, BandsRead> = {};
let measures: Awaited<ReturnType<typeof sampled>> | undefined;

// A play step whose failure stays on its own check, so the play goes on to the steps after it.
const step = async (record: Record<string, string>, title: string, run: () => Promise<unknown>) => {
  try { await run(); } catch (error) { record[title] = String((error as Error)?.message ?? error).slice(0, 2000); }
};

// M02: the server pushes two home-drop tables to the warrior's Tracktrix, and the catalogs follow
// each; the next tracker request after the last reply waits the 30 s refresh (CB16's reply half).
async function m02Play(live: LiveGame) {
  await expect.poll(async()=>!!(await live.state(true)).bestiaryCatalog?.find((m:any)=>m.id==='goo'),{timeout:90_000}).toBe(true);
  const observations: any[] = [];
  const status = observeStatus(live.clients[W]!.page.context(), (_request, body, reply) => {
    const monster = body.bestiaryCatalog?.find((m: any) => m.id === 'goo'), item = body.merchantCatalog?.allItems?.find((i: any) => i.id === 'helmet');
    return { at: Date.now(), name: body.name, hasCatalog: !!body.merchantCatalog, home: monster?.homeRewards, source: item?.meta?.world?.drops?.filter((d: any) => d.monsterId === 'goo'), needsCatalog: reply.needsCatalog };
  });
  m02.errors = status.errors;
  // The page logs each tracker emit at the top of the socket's emit chain.
  await live.clients[W]!.run(`(()=>{const s=parent.socket,emit=s.emit,log=globalThis.__e2eTrackerAsks={asks:[],emit};
    s.emit=log.mine=function(method,...rest){if(method==='tracker')log.asks.push(Date.now());return emit.apply(this,[method,...rest]);};return true;})()`);
  // The warrior's next real Tracktrix reply carries the server's own home tables and rebuilds its
  // catalogs without the plant (status/character/report.ts `observeTracker`), so each plant goes in
  // right after a real reply and has the 30 s refresh to reach the coordinator's catalogs. A plant
  // that landed late in the refresh never showed in w05-w09-run1 (every observation undefined).
  const replies = async () => (await live.clients[W]!.events()).filter((e: any) => e.event === 'tracker-arrived').map((e: any) => Number(e.at));
  m02.plants = [];
  try {
    for (const rate of [0.004, 0.008]) {
      const after = Date.now();
      await expect.poll(async () => (await replies()).some(at => at > after), {timeout: 60_000, intervals: [100], message: 'M02: a real Tracktrix reply before the plant'}).toBe(true);
      m02.plants.push({rate, reply: Math.max(...await replies()), at: Date.now()});
      await live.admin(`output=(()=>{const p=get_player('${W}'),home=Object.assign({},D.drops.monsters_home_server||{},{goo:[[${rate},'helmet',2]]});
        p.socket.emit('tracker',{monsters:p.p.stats.monsters,monsters_diff:p.p.stats.monsters_diff,exchanges:p.p.stats.exchanges,max:p.max_stats,
          drops:D.drops.monsters,maps:D.drops.maps,monsters_home_server:home,drops_home:home,tables:{}});return true;})()`);
      await expect.poll(async()=>{const s=await live.state(true),monster=s.bestiaryCatalog?.find((m:any)=>m.id==='goo'),item=s.merchantCatalog?.allItems?.find((i:any)=>i.id==='helmet');
        const read={home:monster?.homeRewards?.find((d:any)=>d.id==='helmet')?.rate,source:item?.meta?.world?.drops?.find((d:any)=>d.monsterId==='goo'&&d.sourceType==='home')?.rate};
        observations.push({at:Date.now(),rate,...read});return read;},{timeout:90_000}).toEqual({home:rate,source:rate});
    }
    // The next request after the last reply comes at the 30 s refresh, not before.
    const asks = () => live.clients[W]!.run('globalThis.__e2eTrackerAsks.asks') as Promise<number[]>;
    const from = Math.max(...await replies());
    await expect.poll(async()=>{const next=(await asks()).filter(at=>at>from);const reply=Math.max(...(await replies()).filter(at=>next.length&&at<next[0]!));
      m02.refresh={from,reply,next};return next.length;},{timeout:60_000,intervals:[250],message:'CB16: the next request after a reply'}).toBeGreaterThan(0).catch(()=>{});
  } finally {
    await status.stop();
    await live.clients[W]!.run(`(()=>{const log=globalThis.__e2eTrackerAsks;if(log&&parent.socket.emit===log.mine)parent.socket.emit=log.emit;delete globalThis.__e2eTrackerAsks;return true;})()`).catch(() => null);
    m02.observations = observations;
  }
}

// C23's planted rows on the warrior, each one hook or event, with the step titles its HOOKS rows
// name (runtime/hooks/rows, `calls.*`). The fixture add-on registered on the warrior at the play's
// start; the warrior fights goo through the plants, as the old test's idle warrior did not.
async function c23Play(live: LiveGame) {
  const page = live.clients[W]!, rows = c23.rows;
  const clock = () => page.run('Date.now()') as Promise<number>;
  // Packets come only when something changes, so each poll resends the warrior one.
  const packet = () => live.admin(`output=(()=>{resend(get_player('${W}'),'u');return true;})()`);
  const heard = async (from: number) => ((await page.run(heardSince(from))) as HeardNotice[]).filter(n => n.payload.character === W);
  const of = (list: HeardNotice[], event: string) => list.filter(n => n.event === event);
  const planted = async (figure: number) => {
    await live.plantCallCost(W, figure);
    await packet();
    await expect.poll(async () => { await packet(); return page.run(`(__partyCalls.view().cc??0)>=${figure}`); },
      { timeout: 10_000, intervals: [100], message: 'the planted figure arrives' }).toBe(true);
  };
  const unplanted = async () => { await live.plantCallCost(W, 0); await packet(); };
  // Asks a question in the page with no owner's call behind it, as the rows need.
  const ask = (band: string, method: string, emit: boolean) => page.run(`(()=>{const a=__partyHooks.calls.band({band:${JSON.stringify(band)},method:${JSON.stringify(method)},data:{}});
    if(a==='send'&&${emit})parent.socket.emit(${JSON.stringify(method)},{});return a;})()`) as Promise<string>;
  const from = await clock();
  c23.from = from;
  try {
    await planted(199);
    await step(c23.failed, 'calls.waited: a job question waits on the planted figure, then goes', async () => {
      expect(await ask('job', 'players', true), 'the figure holds the job question').toBe('not-now');
      // The untagged emit of the next row is made while the figure holds.
      await step(c23.failed, 'calls.held: an untagged players emit under the planted figure is held', async () => {
        await page.run(`(parent.socket.emit('players',{}),true)`);
        const held = of(await heard(from), 'calls.held');
        rows.held = held;
        expect(held.map(n => [n.payload.character, n.payload.method, n.payload.source, n.payload.by])).toEqual([[W, 'players', 'untagged', 'core:calls']]);
      });
      await step(c23.failed, 'calls.margin: the add-on reads the margin while the figure holds', async () => {
        const margin = of(await heard(from), 'calls.held')[0]?.margin;
        expect(Number.isFinite(margin) && margin! > 0, `the margin the add-on read: ${margin}`).toBe(true);
      });
      await unplanted();
      await step(c23.failed, 'calls.released: the held players emit goes once the figure leaves', async () => {
        await expect.poll(async () => { await packet(); return of(await heard(from), 'calls.released').length; },
          { timeout: WINDOW_MS * 3, intervals: [250] }).toBe(1);
        expect(of(await heard(from), 'calls.released')[0]!.payload.method).toBe('players');
      });
      await expect.poll(async () => { await packet(); return ask('job', 'players', true); }, { timeout: WINDOW_MS * 3, intervals: [250] }).toBe('send');
      // The warrior fights goo through the plants, and the planted figure holds its own survival
      // asks too (W05's run of 2026-11-24 heard a regeneration `use` wait), so the row reads the
      // job band its question asked in.
      // The fighting warrior's own job steps wait on the plant too (run w05-w09-run1 heard a `move`),
      // so the row reads its own question's method.
      const all = of(await heard(from), 'calls.waited'), waited = all.filter(n => n.payload.band === 'job' && n.payload.method === 'players');
      rows.waited = all;
      expect(waited.map(n => [n.payload.band, n.payload.method])).toEqual([['job', 'players']]);
    });
    await step(c23.failed, 'calls.raised: a background read waits one window and goes in the job band', async () => {
      // A figure of 130 fits a 16-cost background read under the shared limit of 188 and refuses a
      // job `cm` of 64 (20 x 4 x 0.8, server.js:4996-5016). The job question asks on every pass, so
      // its wait holds the read until the read has waited one window and goes in the job band.
      await planted(130);
      const jobWait = () => page.run(`__partyHooks.calls.band({band:'job',method:'cm',data:{to:['A','B','C','D'],message:'x'.repeat(50001)}})`);
      expect(await jobWait(), 'the job question waits').toBe('not-now');
      expect(await ask('background', 'secondhands', true)).toBe('not-now');
      await expect.poll(async () => { await packet(); await jobWait(); return ask('background', 'secondhands', true); },
        { timeout: WINDOW_MS * 4, intervals: [250] }).toBe('send');
      // The console's own player list read rises the same way when the plant holds it past a
      // window (call-budget-reads.ts READS.players), as W05's run5 heard, so the row reads its own method.
      const all = of(await heard(from), 'calls.raised'), raised = all.filter(n => n.payload.method !== 'players');
      rows.raised = all;
      expect(raised.map(n => n.payload.method)).toEqual(['secondhands']);
      await unplanted();
    });
    await step(c23.failed, 'calls.unmatched: a question with no call after it is unmatched', async () => {
      // The fighting warrior's own calls can fill the job band after the plant leaves (run5 answered
      // not-now one window on), so the question asks until it is let through; only that answer has no call.
      let at = 0;
      await expect.poll(async () => {
        await packet(); at = await clock();
        try { expect(await ask('job', 'secondhands', false)).toBe('send'); return true; } catch { return false; }
      }, { timeout: WINDOW_MS * 4, intervals: [250] }).toBe(true);
      await expect.poll(async () => of(await heard(at), 'calls.unmatched').map(n => [n.payload.method, n.payload.band]), { timeout: 5_000 })
        .toEqual([['secondhands', 'job']]);
    });
  } finally { await live.plantCallCost(W, 0).catch(() => {}); }
}

// M04: the merchant collects the warrior's marked leather while the warrior fights a planted goo
// with its call-cost reading held. The job band's limit is the call limit less the potion floor
// (call-budget-limits.ts `bandLimits`); a reading held at that limit leaves no room for a send and
// room for an attack under the survival limit, the call limit itself, so sends wait and attacks go.
async function m04Play(live: LiveGame) {
  const HELD = bandLimits(0).job;
  m04.held = HELD;
  await live.post('/merchant/force-stand', { enabled: true });
  await live.post('/formation', { leader: W });
  // The cargo's cell: seedCargo seeds bag cell 10, which the warrior's loot may hold by now.
  await live.admin(`output=(()=>{const p=get_player('${W}'),i=p.items.findIndex((x,k)=>!x&&k!==10&&k<p.isize);if(p.items[10]&&i>=0){p.items[i]=p.items[10];p.items[10]=null;cache_player_items(p);resend(p,'reopen+cid');}return true;})()`);
  await seedCargo(live);
  const total = await totalLeather(live), monster = await spawnGoo(live, W, 300, 0, (await live.state()).farmingProfiles?.[W]?.location?.boundary);
  m04.total = total; m04.monster = monster;
  // In scatter a fighter fights only its own attacker and leaves another member's target
  // (targeting/selection.ts `getScatterTarget`). In final-gate-closing12 the priest hit the plant
  // first, it chased the priest, and the warrior farmed field goos for 45 s. The plant targets the
  // warrior, so it is the warrior's own attacker whichever member reaches it first.
  await live.admin(`output=(()=>{const m=instances[${JSON.stringify(monster.map)}].monsters[${JSON.stringify(String(monster.id))}];target_player(m,get_player(${JSON.stringify(W)}));return m.target;})()`);
  const hits = async () => (await live.clients[W]!.events()).filter((event: any) => event.event === 'hit' && String(event.data?.id) === String(monster.id) && event.data?.hid === W && event.data?.damage > 0);
  const receipts: any[] = [];
  const receiptRoute = async (route: Route) => { receipts.push(route.request().postDataJSON()); await route.continue(); };
  m04.receipts = receipts;
  try {
    // Inside the try, so the finally sets `releasedAt` and CB24 reads from M04's end when the plant
    // is never hit (final-gate-closing6: CB24 read NaN as its start).
    try { await expect.poll(async()=>(await hits()).length,{timeout:45000}).toBeGreaterThan(0); }
    catch (error) {
      // The warrior's queue and report when no hit reaches the plant (final-gate-closing6 rerun1 named the cause from it).
      m04.unhit = { client: await live.clients[W]!.run('JSON.parse(JSON.stringify(globalThis.__partyGroupedCombat||null))'),
        reported: (await live.state()).characters?.[W]?.groupedCombat ?? null };
      throw error;
    }
    // Declared observation fault: hold only the fighter's call-cost reading, the `cc` of each
    // player packet, which the call budget reads (call-budget.ts `onPlayer`).
    await live.clients[W]!.run(`(()=>{const socket=parent.socket,onevent=socket.onevent;globalThis.__e2eHoldHandoffCost=true;
      socket.onevent=function(packet){const [event,data]=packet.data||[];if(globalThis.__e2eHoldHandoffCost&&event==='player'&&data&&Number.isFinite(data.cc))data.cc=${HELD};return onevent.call(socket,packet);};
      globalThis.__e2eRestoreHandoffCost=()=>{globalThis.__e2eHoldHandoffCost=false;socket.onevent=onevent;delete globalThis.__e2eRestoreHandoffCost;};return true;})()`);
    await expect.poll(()=>live.clients[W].run('character.cc')).toBe(HELD);
    await live.clients[W]!.page.route('**/party-api/merchant/handoff-complete', receiptRoute);
    await live.post('/bank-party', { group: W });
    await live.post('/merchant/force-stand', { enabled: false });
    // The merchant reaches the fighter's send range (the send handler's `B.dist`), so only the held
    // budget keeps the sends back.
    await expect.poll(()=>live.admin(`output=(()=>{const w=get_player(${JSON.stringify(W)}),m=get_player(${JSON.stringify(M)});
      return !!w&&!!m&&w.in===m.in&&Math.hypot(w.x-m.x,w.y-m.y)<=B.dist;})()`),{timeout:90000}).toBe(true);
    // The fighter's own next hits are the clock: game calls go on while every send waits.
    const heldHits = (await hits()).length;
    await expect.poll(async()=>(await hits()).length,{timeout:30000}).toBeGreaterThan(heldHits+1);
    m04.held = { leather: await live.admin(`output=get_player(${JSON.stringify(W)}).items.some(i=>i?.name==='leather')`), receipts: receipts.length,
      marked: (await live.state()).merchantMarked?.[W]?.length ?? 0, total: await totalLeather(live) };
    await live.clients[W]!.run('globalThis.__e2eRestoreHandoffCost?.()');
    m04.releasedAt = await live.clients[W]!.run('Date.now()');
    await expect.poll(async()=>live.admin(`output=get_player(${JSON.stringify(W)}).items.some(i=>i?.name==='leather')`),{timeout:90000}).toBe(false);
    await expect.poll(()=>receipts.length,{timeout:30000}).toBeGreaterThan(0);
    await expect.poll(async()=>(await live.state()).merchantMarked?.[W]?.length??0,{timeout:30000}).toBe(0);
    m04.after = { total: await totalLeather(live) };
  } finally {
    try { await live.clients[W]!.page.unroute('**/party-api/merchant/handoff-complete', receiptRoute); }
    finally { await live.clients[W]!.run('globalThis.__e2eRestoreHandoffCost?.()'); }
    m04.releasedAt ??= await live.clients[W]!.run('Date.now()');
    await live.post('/merchant/force-stand', { enabled: false }).catch(() => {});
    // The planted goo holds 300 s of the fighters' damage (spawnGoo `observableCombatSeconds`), so
    // it leaves with the collection and the warrior farms the field's goo while CB24 reads its age.
    await live.admin(`output=(()=>{for(const i of Object.values(instances)){const m=i.monsters?.[${JSON.stringify(String(monster.id))}];if(m)remove_monster(m,{method:'disappear',nospawn:true});}return true;})()`);
  }
}

async function callPressurePlay(live: LiveGame, info: TestInfo) {
  const names = [M, W, P];
  const clock = (name: string) => live.clients[name]!.run('Date.now()') as Promise<number>;
  // The calls hooks fixture add-on on the warrior for C23's rows, and on the merchant for its limitdc.
  for (const name of [W, M]) expect(await live.clients[name]!.run(registerCallsHooksAddon), 'the fixture add-on registers').toEqual({ ok: true });
  await live.post('/settings', { changes: [{ field: 'addons', value: await live.clients[W]!.run(callsHooksSwitches(true)) }] });
  for (const page of [live.clients[W]!, live.clients[M]!]) await expect.poll(() => page.run(`__partyHooks.enabled(${JSON.stringify('calls-hooks-fixture')})`), { timeout: 30_000 }).toBe(true);
  await merchantReporting(live);
  // The Tracktrix read's condition on the merchant (T40's bursts beside it) and the warrior (M02,
  // CB24's age).
  await holdTracktrix(live, M);
  await holdTracktrix(live, W);
  await party(live);
  // T40's plants leave the game server's `csold` and the merchant's trade slots as the play found them.
  live.undo('the planted Ponty listings', () => live.admin(`output=(()=>{for(let i=csold.length-1;i>=0;i--)if(String(csold[i].rid).startsWith('e2ecb'))csold.splice(i,1);return true;})()`));
  live.undo('the seeded trade slots', () => live.admin(`output=(()=>{const p=get_player('${M}');if(!p)return false;for(let i=1;i<=16;i++)if(p.slots['trade'+i]&&String(p.slots['trade'+i].rid).startsWith('e2ecbt'))p.slots['trade'+i]=null;resend(p,'reopen+cid');return true;})()`));
  const sampler = live.sampleCalls(names);
  const limitdcsBefore = live.clients[M]!.limitdcs().length;
  const from = { [M]: await clock(M), [W]: await clock(W) };
  let samples: CallSample[] = [];
  try {
    // CB4's per-call charges first: each call's reading needs a quiet window on its socket, and
    // the party leave's reads both fighters' sockets, which a goo fight charges every second.
    t40.costs = await perCallCosts(live, info);
    const farm = await location(live, 'goo');
    await live.post('/navigate-to-monster', { monsterId: 'goo', location: farm });
    await live.post('/focus', { monsterFocus: ['goo'], monsterPriorities: {}, monsterSearchRadius: 400 });
    await expect.poll(async () => { const c = (await live.state()).characters[W]; return c?.map === farm.map && Math.hypot(c.x - farm.x, c.y - farm.y) < 400; },
      { timeout: 120_000, message: 'The warrior reaches the goo field' }).toBe(true);
    // The merchant's bursts run beside the warrior's fight: they charge only the merchant's socket.
    const halves = await Promise.allSettled([
      (async () => { await pontyBurst(live, t40); await standBurst(live, t40); })(),
      (async () => { await cb6Play(live, info, t41); await step(m02, 'error', () => m02Play(live)); })(),
    ]);
    for (const half of halves) if (half.status === 'rejected') throw half.reason;
    // CB24's read of the tracker request from here on: each `tracker` emit at the top of the
    // socket's emit chain and each band answer the request got, so a missing reply names whether
    // the console asked (W05's runs of 2026-11-24 heard no reply for 150 s after M04).
    // Each `tracker` the page's socket receives, with its listener count, sits beside them:
    // w03-w05-w09-run3's server sent a reply at each of the three requests and the page logged no
    // `tracker-arrived`, so the reading names whether the packet or the harness listener is gone.
    await live.clients[W]!.run(`(()=>{const s=parent.socket,calls=globalThis.__partyHooks.calls,emit=s.emit,band=calls.band,log=globalThis.__e2eTrackerProbe={emits:[],answers:[],count:{}};
      s.emit=log.emit=function(method,...rest){if(method==='tracker')log.emits.push(Date.now());return emit.apply(this,[method,...rest]);};
      calls.band=log.band=function(q){const a=band.apply(this,arguments);if(q&&q.method==='tracker'){log.count[a]=(log.count[a]||0)+1;log.answers.push([Date.now(),q.band,a]);if(log.answers.length>40)log.answers.shift();}return a;};
      log.received=[];log.inc=(e)=>{if(e==='tracker')log.received.push([Date.now(),s.listeners('tracker').length]);};s.prependAny(log.inc);
      log.off=()=>{if(s.emit===log.emit)s.emit=emit;if(calls.band===log.band)calls.band=band;s.offAny(log.inc);delete globalThis.__e2eTrackerProbe;};return true;})()`);
    live.undo('the tracker probe on the warrior', () => live.clients[W]!.run('(globalThis.__e2eTrackerProbe?.off?.(),true)'));
    // The same read on the game server's side of the warrior's socket: each `tracker` the server
    // receives, with the holder flag and handler count its listener reads, and each `tracker` it sends.
    await live.admin(`output=(()=>{const p=get_player('${W}'),s=p.socket,log=globalThis.__e2eTrackerServer={sid:s.id,received:[],sent:[]};
      log.inc=(e)=>{if(e==='tracker')log.received.push([Date.now(),!!p.tracker,s.listeners('tracker').length,!!players[s.id]]);};
      log.outg=(e)=>{if(e==='tracker')log.sent.push(Date.now());};s.prependAny(log.inc);s.prependAnyOutgoing(log.outg);
      log.off=()=>{s.offAny(log.inc);s.offAnyOutgoing(log.outg);delete globalThis.__e2eTrackerServer;};return s.id;})()`);
    live.undo('the server tracker probe on the warrior', () => live.admin('output=(globalThis.__e2eTrackerServer?.off?.(),true)'));
    await c23Play(live);
    await step(m04, 'error', () => m04Play(live));
    // The warrior's last planted figure is M04's held reading.
    await trackerAgePlay(live, from[W]!, m04.releasedAt, t41);
  } finally {
    samples = await sampler.stop();
  }
  measures = await sampled(info, 'W05', samples, names);
  t40.limitdcs = live.clients[M]!.limitdcs().slice(limitdcsBefore);
  for (const name of [M, W]) bands[name] = await bandsRead(live, name);
  t41.from = from[W]; t40.from = from[M];
  // The window's end: the forced limitdc on the merchant, which T47 reads at the coordinator and
  // C23's add-on hears on the merchant.
  const at = await clock(M);
  t47.reading = await forcedLimitdcPlay(live, info);
  await step(c23.failed, 'calls.limitdc: the planted overflow writes the limitdc snapshot', async () => {
    const heard = async (from: number) => ((await live.clients[M]!.run(heardSince(from))) as HeardNotice[]).filter(n => n.payload.character === M);
    const of = (list: HeardNotice[], event: string) => list.filter(n => n.event === event);
    await expect.poll(async () => of(await heard(at), 'calls.limitdc').length, { timeout: 60_000, intervals: [500] }).toBe(1);
    const notice = of(await heard(at), 'calls.limitdc')[0]!;
    c23.rows.limitdc = notice;
    expect(notice.payload.total, 'the server report total').toBeGreaterThan(CALL_LIMIT);
  });
  // Each event of the table came once, from its own change.
  const all = [...(await live.clients[W]!.run(heardSince(c23.from ?? from[W]!))) as HeardNotice[], ...(await live.clients[M]!.run(heardSince(at))) as HeardNotice[]];
  c23.rows.events = [...new Set(all.map(n => n.event))];
  await step(c23.failed, 'every notice', async () => {
    expect(CALL_NOTICES.filter(event => !all.some(n => n.event === event)), 'every notice was heard').toEqual([]);
  });
}

liveWindow({
  id: 'W05', name: 'Goo farm under call-budget pressure, ending in a forced limitdc',
  // The old rows and tests took 3 min of play together (DESIGN.md 2.2 W05); the Ponty job and the
  // reconcile each wait up to 180 s, the tracker age up to two refreshes.
  timeoutMs: 1_200_000,
  async play({live, info}: LiveWorld) { await callPressurePlay(live, info); },
  observers: [
    {id: 'T40', owner: 'calls', behaviours: [], start() {}, reads: () => ({...t40, bands: undefined, measures: measures?.[M]}), verdict() {
      boundHolds(measures!, [M]);
      costsHold(t40.costs);
      burstsHold(t40, measures!, t40.limitdcs);
      bandsHold(M, bands[M]!, t40.from);
    }},
    {id: 'T41', owner: 'calls', behaviours: [], start() {}, reads: () => ({asked: t41.asked, survivalNotNow: t41.survivalNotNow, trackerAge: t41.trackerAge}), verdict() {
      boundHolds(measures!, [W, P]);
      cb6Hold(t41);
      trackerAgeHold(t41);
      // C23's unmatched row asks one `secondhands` with no emit after it.
      bandsHold(W, bands[W]!, t41.from, m04.releasedAt, {secondhands: 1});
    }},
    {id: 'T47', owner: 'calls', behaviours: [], start() {}, reads: () => t47, verdict() { forcedLimitdcHold(t47.reading); }},
    {id: 'C23', owner: 'calls', behaviours: [], start() {}, reads: () => c23, verdict() { expect(c23.failed, 'every calls hook row of the window passes').toEqual({}); }},
    {id: 'M02', owner: 'items', behaviours: [], start() {}, reads: () => m02, verdict() {
      expect(m02.error, 'M02: the home-drop tables reach the catalogs').toBeUndefined();
      expect(m02.errors).toEqual([]);
      const refresh = m02.refresh;
      expect(refresh?.next?.length,`CB16: a request follows the last reply: ${JSON.stringify(refresh)}`).toBeGreaterThan(0);
      expect(refresh.next[0]-refresh.reply,'CB16: a reply sets the next request at the 30 s refresh').toBeGreaterThanOrEqual(TRACKER_REFRESH_MS);
      expect(refresh.next[0]-refresh.reply,'CB16: a reply sets the next request at the 30 s refresh').toBeLessThanOrEqual(TRACKER_REFRESH_MS+2*STEP_MS);
    }},
    {id: 'M04', owner: 'merchant', behaviours: [], start() {}, reads: () => m04, verdict() {
      expect(m04.error, 'M04: the held collection plays to its end').toBeUndefined();
      expect(m04.held.leather, 'no send while the call cost is held').toBe(true);
      expect(m04.held.receipts, 'no receipt while the sends wait').toBe(0);
      expect(m04.held.marked, 'the marks stay while the sends wait').toBeGreaterThan(0);
      expect(m04.held.total, 'leather conserved while held').toBe(m04.total);
      expect(m04.receipts.filter((receipt: any) => receipt.partial), 'the waiting sends all transfer').toEqual([]);
      expect(m04.after.total, 'leather conserved after the transfer').toBe(m04.total);
    }},
  ],
});
