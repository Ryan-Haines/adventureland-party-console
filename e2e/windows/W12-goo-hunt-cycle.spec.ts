import {expect, type LiveGame} from '../live-fixtures';
import type {Page, TestInfo} from '@playwright/test';
import {liveWindow, type LiveWorld} from '../windows';
import {warrior as W, priest as P, merchant as M, fighters, world, tokens, profile, observed, party, quests, location, start, cycle, missionReached} from '../game/hunt-lifecycle';
import {world as eventsWorld, quantity, beginAnniversary, cleanupEvents} from '../game/hunt-events';
import {killedByParty} from '../hunt-interruption-helpers';
import {isolateNativeMapAmbient, restoreNativeMapAmbient} from '../native-map-ambient-isolation';

// W12 Goo Hunt cycle Daisy - Main goo - Daisy (test-windows DESIGN.md 2.2 W12). One play, two Hunt
// cycles on the Main goo field and one coordinator restart between them.
// The order: the warrior's quest is read empty (C7); the merchant has no event selection, Main's
// ambient monsters are held back, and the merchant carries 39 helmets with its NPC sales off; the
// quests are seeded (warrior 2 kills left, priest done) and the priest's convoy-complete calls are
// armed to lose the first request and the second reply; the player starts Hunt from the dashboard
// (C7, C8); an Anniversary goes live that nobody selected (H12); a current and then a deferred
// stale event return are planted on the merchant (M35, M36) and its NPC sales go on; both fighters
// reach the mission, a planted goo dies to the party and the warrior's quest drops with no visit
// reward (H12); Main's ambient comes back, the warrior's last kill finishes its quest and both
// owners hand in at Daisy (H21, C8, H37, H38); the warrior takes its next quest there (C7); the
// merchant has sold every helmet outside the Hunt (M35); Hunt off and the restart (H37, H38, M35);
// the second cycle seeds the warrior 1 and the priest 8, and the warrior's final kill leaves the
// priest's quest open until the priest claims its own reward (H22).
// Failure modes: C7, the dashboard start takes no real quest; C8 and H21, the Hunt kills nothing or
// a follower's done quest never hands in; H37 and H38, a lost convoy-complete request or reply
// stalls the walk or pays a reward twice; H12, an unselected Anniversary pulls a fighter off the
// mission or gives a visit reward; M35 and M36, a stale return holds the merchant, a sale is lost,
// the merchant joins the Hunt, or the return comes back on the restart; H22, the leader's final kill
// resets the follower's quest or holds its loot.
// Each check's assertions are its old test's, with their messages, so the coverage ledger matches
// them. A failed step records its message under its check and the play goes on.
// Every old spec this window cites is at 21fe30a2b.
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
const step = async (id: string, run: () => Promise<unknown>) => {
  try { await run(); } catch (error) { failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); }
};

// The priest's convoy-complete faults (live-hunt-recovery.spec.ts): its first request is lost
// (H37), and its second reaches the coordinator and loses the reply (H38). The real browser
// transport carries both; no status, route or acknowledgement is fabricated.
let intercepted = false, responded = false;
const faults: unknown[] = [];
async function armFaults(live: LiveGame) {
  const context = live.clients[W].page.context();
  await context.route('**/party-api/convoy-complete', async route => {
    const packet = route.request().postDataJSON();
    if (packet.character !== P || (intercepted && responded)) return route.fallback();
    if (!intercepted) { intercepted = true; faults.push({ fault: 'completion-request', packet }); }
    else {
      responded = true;
      const response = await route.fetch();
      faults.push({ fault: 'completion-response', packet, acceptedResponse: await response.json() });
    }
    await route.abort('connectionreset');
  });
  live.undo('the convoy-complete faults', () => context.unroute('**/party-api/convoy-complete'));
}

// M35 and M36 (live-merchant-anniversary-availability.spec.ts): a stale empty event return on the
// merchant, planted through a historical settings write, which restarts the coordinator.
const samples: any[] = [];
async function staleReturn(live: LiveGame, kind: 'current' | 'deferred') {
  const cycle = 'merchant-empty-' + kind;
  await live.restoreHistoricalSettings(()=>kind==='current'?{eventReturn:{cycleId:cycle,event:'witchcipher',participants:[M],pending:[],exited:[M],deferred:[],startedAt:Date.now()-60000,checkpoint:null,waypoints:{[M]:{revision:0,location:null}},phase:'evacuating'}}:
    {deferredEventReturns:{[M]:{cycleId:cycle,event:'witchcipher',checkpoint:null,navigationRevision:0,deferredAt:Date.now()-60000,phase:'awaiting-event-handoff'}}});
  await expect.poll(async()=>{
    const s=await live.state();samples.push({at:Date.now(),return:s.eventReturn,deferred:s.deferredEventReturns,merchant:s.characters[M]?.merchantEventReserved,hunt:s.monsterHunt});
    return !s.eventReturn?.participants.includes(M)&&!s.deferredEventReturns[M]&&!s.characters[M]?.merchantEventReserved;
  },{timeout:30_000}).toBe(true);
}

// C7: the dashboard's Hunt start with a goo backup (live-game.spec.ts).
async function dashboardHunt(live: LiveGame, page: Page) {
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
}

// H12: the planted goo inside the current mission, as live-hunt-events.spec.ts plants it.
async function anniversaryEncounter(live: LiveGame, info: TestInfo, cycleId: string, before: any) {
  const world = eventsWorld;
  await missionReached(live,cycleId,'Disabled Anniversary must leave both native fighters at the current Hunt mission');
  const missionState=await live.state(),mission=missionState.monsterHunt.missions[missionState.monsterHunt.currentIndex];
  const encounter=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)}),destination=${JSON.stringify(mission.destination)},bounds=destination.boundary;
    if(p.map!==destination.map)throw Error('Native Hunt actor left its declared mission map');
    const points=[[35,0],[-35,0],[0,35],[0,-35]].map(([dx,dy])=>({x:p.x+dx,y:p.y+dy}));
    for(let x=bounds[0];x<=bounds[2];x+=20)for(let y=bounds[1];y<=bounds[3];y+=20)points.push({x,y});
    points.sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
    for(const {x,y} of points){
      if(x<bounds[0]||x>bounds[2]||y<bounds[1]||y>bounds[3]||!can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))continue;
      const m=new_monster(p.in,{__e2eAmbientExempt:true,type:'goo',position:[x,y],radius:0,count:1},{temp:1});m.e2eHunt=true;
      return {id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,destination};}
    throw Error('No reachable native encounter inside disabled-Anniversary Goo mission');})()`);
  await info.attach('anniversary-disabled-native-encounter',{body:JSON.stringify(encounter),contentType:'application/json'});
  const kill=await killedByParty(live,encounter.id);
  await info.attach('anniversary-disabled-native-kill',{body:JSON.stringify(kill),contentType:'application/json'});
  await expect.poll(async()=>(await world(live)).players[W].quest?.c,{timeout:120_000}).toBeLessThan(before.players[W].quest.c);
  const state=await live.state(),after=await world(live);
  expect(state.monsterHunt.cycleId).toBe(cycleId);
  expect(quantity(after.players[W].items,'anniversarygift')).toBe(quantity(before.players[W].items,'anniversarygift'));
  expect(after.players[W].conditions.anniversary_kiss).toBeFalsy();
  reads.H12 = {encounter, kill, before: before.players[W].quest, after: after.players[W].quest};
}

// H22 (gameplay-scenarios.ts unequalQuests): the warrior's one kill left against the priest's
// eight, on the second cycle.
async function unequalCycle(live: LiveGame, info: TestInfo) {
  await quests(live, info, { [W]: { count: 1 }, [P]: { count: 8 } });
  const before = await world(live);
  await start(live);
  let intermediate: Awaited<ReturnType<typeof world>>;
  await expect.poll(
    async () => {
      const current = await world(live);
      if (
        current[W].quest?.id === "goo" &&
        current[W].quest.c === 0 &&
        current[P].quest?.id === "goo" &&
        current[P].quest.c > 0 &&
        current[P].quest.c < 8
      ) {
        intermediate = current;
        return true;
      }
      return false;
    },
    {
      timeout: 120_000,
      intervals: [50, 100, 200],
      message: "A native kill must complete only the leader quest",
    },
  ).toBe(true);
  await expect.poll(async () => tokens((await world(live))[W]), { timeout: 150_000 }).toBe(tokens(before[W]) + 1);
  const afterLeaderReward = await world(live);
  const scopeChange = tokens(afterLeaderReward[P]) === tokens(before[P]);
  if (scopeChange) {
    expect(afterLeaderReward[P].quest?.id).toBe("goo");
    expect(afterLeaderReward[P].quest.c).toBeLessThanOrEqual(intermediate![P].quest.c);
    // A leader-owned Hunt need not finish the follower's different remaining count, so the
    // follower gets its own controller to claim that quest.
    await live.post("/formation", { character: P, follow: false });
    await start(live, P);
  }
  await expect.poll(async () => tokens((await world(live))[P]), { timeout: 150_000 }).toBe(tokens(before[P]) + 1);
  reads.H22 = {before: fighters.map(n => tokens(before[n])), intermediate: intermediate!, afterLeaderReward: fighters.map(n => afterLeaderReward[n].quest),
    followerCompletion: scopeChange ? 'explicit Follow-off and solo Hunt' : 'original party Hunt'};
}

async function huntCyclePlay(live: LiveGame, page: Page, info: TestInfo) {
  await party(live);
  await step('C7', async () => expect((await observed(live))[W].quest).toBeNull());
  await live.post('/formation', {character: M, eventSelections: []});
  // H12's ambient isolation (live-hunt-events.spec.ts) also makes the first cycle's kills the
  // play's own: the warrior's 2 kills left would otherwise go to ambient goos before H12's
  // planted one.
  const ambient = await isolateNativeMapAmbient(live, 'main');
  live.undo('the Main ambient isolation', () => restoreNativeMapAmbient(live, true));
  await info.attach('disabled-anniversary-native-ambient-input', {body: JSON.stringify(ambient), contentType: 'application/json'});
  live.undo('the Anniversary and the planted goo', () => cleanupEvents(live));
  // M35's merchant: sales off, a full bag of helmets and a sale rule that keeps none.
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':false}});
  await live.admin(`output=(()=>{const p=get_player('${M}');p.items=[{name:'stand0'},{name:'hpot1',q:9999},{name:'mpot1',q:9999},...Array.from({length:39},()=>({name:'helmet',level:0}))];cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await step('M35', async () => {
    await expect.poll(async()=>(await live.state()).characters[M].items.filter((e:any)=>e?.item?.name==='helmet').length).toBe(39);
  });
  await live.post('/merchant/auto-npc-sale',{item:{name:'helmet',level:0},keep:0});
  // H21's quests: the follower's is done, the leader has two real kills left.
  await quests(live, info, { [W]: { count: 2 }, [P]: { count: 0 } });
  const before = await world(live), tokenCount = tokens, c8Tokens = tokenCount(before[W]);
  await armFaults(live);
  await step('C8', async () => {
    const destination = await location(live);
    expect(destination, "The real client must publish a Goo spawn catalog").toBeTruthy();
  });
  await step('C7', () => dashboardHunt(live, page));
  await step('H37', () => expect.poll(async () => profile(await live.state()).monsterHunt?.cycleId).toBeTruthy());
  const cycleId = await cycle(live), eventsBefore = await eventsWorld(live);
  // H12: an Anniversary hosted by the merchant, which nobody selected.
  const seed = await beginAnniversary(live, M);
  await info.attach('anniversary-disabled-seed', {body: JSON.stringify(seed), contentType: 'application/json'});
  await step('H12', async () => {
    const world = eventsWorld;
    await expect.poll(async()=>(await world(live)).anniversary?.live,{timeout:30_000}).toBe(true);
  });
  await step('M35', () => staleReturn(live, 'current'));
  await step('M36', () => staleReturn(live, 'deferred'));
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':true}});
  await step('H12', () => anniversaryEncounter(live, info, cycleId, eventsBefore));
  await info.attach('disabled-anniversary-native-ambient-restored', {body: JSON.stringify(await restoreNativeMapAmbient(live, true)), contentType: 'application/json'});
  await step('H37', () => expect.poll(() => intercepted, { timeout: 120_000 }).toBe(true));
  // H21 and H37's rewards, read on the same hand-in: one token each, the priest's for a quest it
  // finished before the Hunt began. The bound is H21's 210 s (gameplay-scenarios.ts:205); H37's
  // own was 180 s (live-hunt-recovery.spec.ts:224).
  const rewarded = expect.poll(async () => {
    const current = await world(live);
    return fighters.every(name => tokens(current[name]) === tokens(before[name]) + 1);
  }, { timeout: 210_000 }).toBe(true);
  rewarded.catch(() => {});
  await step('H37', () => rewarded);
  await step('H21', async () => {
    await rewarded;
    expect(
      (await live.clients[W].events()).some(
        (entry: any) => entry.event === "hit" && entry.data?.kill,
      ),
    ).toBe(true);
  });
  await step('C8', async () => {
    await expect.poll(async () => tokenCount((await world(live))[W]), {
      timeout: 180_000,
      intervals: [1000],
    }).toBeGreaterThan(c8Tokens);
    expect(
      (await live.clients[W].events()).some(
        (entry: any) => entry.event === "hit" || entry.event === "death",
      ),
    ).toBe(true);
  });
  await step('H38', () => expect.poll(() => responded, { timeout: 120_000 }).toBe(true));
  reads.faults = faults;
  // C7's real quest is the one the warrior takes at Daisy after the hand-in.
  await step('C7', async () => {
    await expect.poll(async () => (await observed(live))[W].quest?.c || 0, { timeout: 120_000 }).toBeGreaterThan(0);
    const result = await observed(live);
    expect(result[W].quest.id).toBeTruthy();
    reads.C7 = result[W].quest;
  });
  await step('M35', async () => {
    await expect.poll(async()=>{
      const s=await live.state(),native=await live.admin(`output=get_player('${M}').items.filter(i=>i?.name==='helmet').length`);
      return native===0&&s.merchantActivity.filter((a:any)=>a.message.startsWith('Sold 1 × helmet to NPC')).length===39;
    },{timeout:120_000}).toBe(true);
    const s=await live.state();expect(s.farmingPolicy).toBe('hunt');expect(s.monsterHunt.participants).not.toContain(M);
  });
  // The one restart: H37 and H38's rewards and M35's retired returns are read across it.
  await live.post('/farming-mode', { character: W, mode: 'default' });
  await live.restartCoordinator();
  const after = await world(live);
  for (const id of ['H37', 'H38']) await step(id, async () => {
    for (const name of fighters) expect(tokens(after[name])).toBe(tokens(before[name]) + 1);
  });
  await step('M35', async () => {
    await expect.poll(async()=>{const s=await live.state();return !s.eventReturn?.participants.includes(M)&&!s.deferredEventReturns[M]&&!s.characters[M]?.merchantEventReserved;}).toBe(true);
  });
  reads.M35 = samples;
  await step('H22', () => unequalCycle(live, info));
}

const own = (id: string, owner: string, behaviours: string[]) => ({
  owner, behaviours, start() {}, reads: () => ({failed: failed[id] ?? null, reads: reads[id] ?? null}),
  verdict() { expect(failed[id], `${id}: every step of the play passes`).toBeUndefined(); },
});

liveWindow({
  id: 'W12', name: 'Goo Hunt cycle Daisy - Main goo - Daisy',
  // The old tests' bounds summed: 240 s (C7) + 240 (C8) + 300 (H12) + 300 (H21) + 420 (H22) + 300
  // (H37) + 300 (H38) + 240 (M35) + 240 (M36) = 2,580 s.
  timeoutMs: 2_580_000,
  // The dashboard page belongs to Playwright's base context, so it closes before the native fixture.
  async play({live, page, info}: LiveWorld) { try { await huntCyclePlay(live, page, info); } finally { await page.close(); } },
  observers: [
    {id: 'C7', ...own('C7', 'hunting', ['HNT-111'])}, {id: 'C8', ...own('C8', 'hunting', ['TST-030', 'HNT-136'])},
    {id: 'H12', ...own('H12', 'events', ['EVT-044', 'HNT-024'])}, {id: 'H21', ...own('H21', 'hunting', ['HNT-012'])},
    {id: 'H22', ...own('H22', 'hunting', ['HNT-012'])}, {id: 'H37', ...own('H37', 'movement', [])}, {id: 'H38', ...own('H38', 'movement', [])},
    {id: 'M35', ...own('M35', 'merchant', ['EVT-058', 'INV-117'])}, {id: 'M36', ...own('M36', 'merchant', ['EVT-058', 'INV-117'])},
  ],
});
