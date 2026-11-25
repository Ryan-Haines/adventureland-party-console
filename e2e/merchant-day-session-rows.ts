import type {TestInfo} from '@playwright/test';
import {expect, headlessMerchant, type LiveGame} from './live-fixtures';
import {bridgeLeased} from './bankboi-day-session-rows';
import {bankQuantity, catalog, economy, jobFinished, quantity, record, seed, type Economy} from './stand-session-rows';

// W52's one merchant buy, upgrade and compound day (test-windows DESIGN.md 2.2 W52) on one boot,
// the bodies of live-economy.spec.ts's buy and upgrade tests, live-manual-upgrade.spec.ts,
// live-stat-scroll-bank.spec.ts and live-bankboi-offerings.spec.ts's offering stock boundary
// (every old spec this file cites is at 21fe30a2b):
//  1. the merchant buys one Liquid Luck at the Winter Inn bar (A31);
//  2. a duplicate queued helmet order buys once across a restart (A50);
//  3. a cancelled scroll order stays cancelled across a restart while a later helmet buy runs (A53);
//  4. a manual helmet upgrade consumes one scroll and does not replay after a restart (A54, and
//     A27's live remainder);
//  5. a ten-coat buy and upgrade batch leaves the old +5 coat out (A45);
//  6. an unavailable upgrade estimate stops at its gold cap across a restart (A35);
//  7. one upgrade batch holds an interrupted automatic broom, a displaced manual wcap and a
//     withdrawn and a carried manual shield, and a restart replays none (M32, M33, M34);
//  8. banked str and luck stat scrolls go onto two helmets with no purchase (M58, M60);
//  9. a manual and then an automatic compound each withdraw one reserved bank triplet (A60, A61);
// 10. the mass skills at full and capped MP, and potion recovery from critical HP and MP during an
//     exchange (A44);
// 11. headless, a manual helmet upgrade takes its offering from the bag, from the bank, and runs
//     without its locked offerings (A24, A25, A28).
// The round order: A54 is the first upgrade of the day, so its whole-ledger upgrade read meets no
// earlier upgrade. A45 and A35 end with their orders still open (a held batch, a spent cap), so the
// player clears the merchant's work after each. A44 seeds lucky slot 30 with a restart, so it comes
// after every round that plants bag cells, and the slot goes back before the headless rounds. The
// offering rounds need a headless merchant (live-bankboi-offerings.spec.ts:5), and the day goes
// headless once, so they come last.
// The merged rounds (M32 with M33 and M34, M58 with M60, A60 with A61) and A44's fixed round are
// new; their old tests kept their own bodies.
const merchant = 'E2EMerchant';
const totalGold = (state: Economy) => state.bankGold + Object.values(state.characters).reduce((total, character) => total + character.gold, 0);
// The bootstrap gives the merchant only hpot1 and mpot1 (e2e/game/bootstrap.cjs:74), so every other
// bag item is a round's plant, purchase or reward. These are the bank's planted or deposited items.
const bankItems = ['elixirluck', 'helmet', 'scroll0', 'scroll1', 'scroll2', 'softstepgloves', 'coat', 'armorbox', 'broom', 'wcap',
  'sshield', 'strring', 'beewings', 'strscroll', 'luckscroll', 'offeringp'];

export async function merchantDaySessionPlay(live: LiveGame, info: TestInfo) {
  await liquidLuckRound(live, info);
  await nextRound(live);
  await duplicateBuyRound(live, info);
  await nextRound(live);
  await cancelledBuyRound(live, info);
  await nextRound(live);
  await manualUpgradeRound(live, info);
  await nextRound(live);
  await coatBatchRound(live, info);
  // The coat order goes on upgrading ten coats once the round has read its first checkpoint, and
  // the batch size stays 10 for every later buy, so the player clears the work and sets the
  // default back (runtime/items/saved-fields.ts:71, default 1).
  await live.post('/merchant/clear', {});
  await live.post('/config', {buyUpgradeBatchSize: 1});
  await nextRound(live);
  // The capped order stays with its gold cap error, which no later round reads.
  await goldCapRound(live, info);
  await live.post('/merchant/clear', {});
  await nextRound(live);
  await upgradeBatchRound(live, info);
  await nextRound(live);
  await statScrollRound(live, info);
  await nextRound(live);
  await bankCompoundRound(live, info);
  await nextRound(live);
  await massSkillsRound(live, info);
  await nextRound(live);
  // A44's lucky slot 30 would move the offering rounds' helmet out of cell 20.
  await live.restoreHistoricalSettings(() => ({luckyUpgradeSlots: {}}));
  await bridgeLeased(live);
  await headlessMerchant(live, merchant);
  await expect.poll(async()=>{const c=(await live.state()).characters[merchant];return c?.runtime==='headless'&&Date.now()-c.seenAt<3000;},{timeout:90_000}).toBe(true);
  await offeringBoundaryRound(live, info, 'carried');
  await nextRound(live, true);
  await offeringBoundaryRound(live, info, 'native bank');
  await nextRound(live, true);
  await offeringBoundaryRound(live, info, 'protected');
}

// Each body plants its own cells (seed refuses an occupied one, stand-session-rows.ts:57) and counts
// its items from a bag and bank that hold none, so the round's work ends, the merchant leaves a
// mounted bank (a mounted bank saves over the db plants of the next body), every automation goes
// off, and the bag goes back to its two potions and the bank to no planted item. The headless
// rounds read the bank from the coordinator's snapshot, so a checkpoint names the cleared bank, as
// W54's round change does (bankboi-day-session-rows.ts `nextRound`).
async function nextRound(live: LiveGame, headless = false) {
  await jobFinished(live);
  // A cleared batch can leave an upgrade's production journal pending, and the items owner holds
  // every merchant job until the merchant reconciles its receipt (items/coordinator/owner.ts
  // productionPending). The bag clear below would remove the items that receipt names, so the
  // round waits for the journal first (liveb-step11-run3.log: A45's clear held A35's order).
  await expect.poll(async () => (await live.post('/merchant/production', {character: merchant, action: 'pending'})).pending,
    {message: "The cleared work's production journal reconciles before the next round"}).toEqual([]);
  const {merchantAutomations: automations = {}, upgradeOfferingRules: offeringRules = []} = await live.state();
  await live.post('/merchant/routine-priorities', {priorities: {}, enabled: Object.fromEntries(Object.keys(automations).map(key => [key, false]))});
  // Each offering round saves its own +0 to +1 helmet rule, which the items owner refuses beside an
  // earlier one that covers the same levels (rules.ts offeringProblem; liveb-step11-run6.log: 409
  // on the 'native bank' round), so the round's rules go.
  for (const rule of offeringRules)
    await live.post('/command', {character: merchant, type: 'upgrade-offering-rule', rule, remove: true});
  if (await live.admin(`output=!!get_player('${merchant}').user`)) {
    await live.post('/command', {character: merchant, type: 'character-travel', location: {map: 'main', x: 0, y: 0}});
    await expect.poll(async () => live.admin(`output=!get_player('${merchant}').user`),
      {timeout: 90_000, message: 'The merchant leaves the bank before the next round'}).toBe(true);
  }
  // A cleared order can leave one game upgrade, compound or exchange in flight (A45's batch), whose
  // result would land in a cleared cell, so the clear waits for the game's own queue. The bound is
  // the bag clear's (W51's `nextRound`).
  await expect.poll(async () => live.admin(`output=(q=>!q.upgrade&&!q.compound&&!q.exchange)(get_player('${merchant}').q||{})`),
    {timeout: 30_000, message: "The merchant's game queue is empty before the round's items go"}).toBe(true);
  const bank = await live.admin(`output=(async()=>{const p=get_player('${merchant}'),names=${JSON.stringify(bankItems)};
    p.items=p.items.map(i=>i&&!['hpot1','mpot1'].includes(i.name)?null:i);cache_player_items(p);resend(p,'reopen+cid');
    const u=await db.collection('user').findOne({_id:p.owner}),set={};
    const packs=Object.keys(u.info).filter(k=>/^items\\d+$/.test(k)&&Array.isArray(u.info[k]));
    for(const k of packs)set['info.'+k]=u.info[k].map(i=>i&&names.includes(i.name)?null:i);
    if(packs.length)await db.collection('user').updateOne({_id:u._id},{$set:set});
    return {gold:0,packs:Object.fromEntries(packs.map(k=>[k,set['info.'+k].map((item,slot)=>item?{slot,item}:null)]))};})()`);
  if (headless) await live.post('/bankboi/checkpoint', {character: merchant, bank});
  await expect.poll(async () => live.admin(`output=get_player('${merchant}').items.some(i=>i&&!['hpot1','mpot1'].includes(i.name))`),
    {timeout: 30_000, message: "The round's items leave the merchant's bag"}).toBe(false);
}

async function restartAndObserve(live: LiveGame) {
  const startedAt = Date.now();
  await live.restartCoordinator();
  await expect.poll(async () => (await live.state()).characters[merchant]?.seenAt,
    { timeout: 30_000, message: 'Replay assertions require a native heartbeat accepted after restart' }).toBeGreaterThan(startedAt);
  await jobFinished(live);
}

// The page-clock `at` of the merchant's last event: the merchant's event ledger holds the whole
// boot, so a round counts the responses after its start (bank-day-session-rows.ts `salesFrom`).
const lastEventAt = async (live: LiveGame) => (await live.clients[merchant].events()).at(-1)?.at ?? 0;

// A31 (live-economy.spec.ts 'merchant buys one Liquid Luck from the customer side of the Winter Inn bar').
export async function liquidLuckRound(live: LiveGame, info: TestInfo) {
  // Failure modes: the destination is behind the counter; arrival never buys;
  // a duplicated purchase changes quantity/spending; queue removal precedes telemetry.
  await catalog(live, 'elixirluck');
  const before = await economy(live);
  const count = (state: Economy) => Object.values(state.characters).reduce((n, c) => n + quantity(c.items, 'elixirluck'), 0) + bankQuantity(state, 'elixirluck');
  const order = await live.post('/merchant/order', {buys: [{id: 'elixirluck', quantity: 1, level: 0}], crafts: []});
  try {
    await expect.poll(async () => count(await economy(live)), {timeout: 180_000}).toBe(count(before) + 1);
    await jobFinished(live, order.jobId);
    const after = await economy(live);
    expect(count(after)).toBe(count(before) + 1);
    expect(totalGold(before) - totalGold(after)).toBe(240_000);
    await expect.poll(async () => {
      const state = await live.state();
      return state.characters[merchant]?.items?.some((entry: any) => entry?.item?.name === 'elixirluck');
    }, {timeout: 30_000}).toBe(true);
  } finally {
    await record(live, info, 'native-liquid-luck-purchase', before, {jobId: order.jobId});
  }
}

// A50 (live-economy.spec.ts 'duplicate queued NPC buys execute once and remain complete after coordinator restart').
export async function duplicateBuyRound(live: LiveGame, info: TestInfo) {
  await catalog(live, 'helmet');
  await live.post('/merchant/force-stand', { enabled: true });
  const before = await economy(live);
  const price = await live.admin("output=G.items.helmet.g");
  const order = { buys: [{ id: 'helmet', quantity: 3 }], crafts: [] };
  const accepted = await live.post('/merchant/order', order);
  const duplicate = await live.post('/merchant/order', order);
  expect(duplicate).toMatchObject({ duplicate: true, jobId: accepted.jobId });
  await live.post('/merchant/force-stand', { enabled: false });
  await expect.poll(async () => quantity((await economy(live)).characters[merchant].items, 'helmet'),
    { timeout: 150_000 }).toBe(quantity(before.characters[merchant].items, 'helmet') + 3);
  await jobFinished(live, accepted.jobId);
  expect(totalGold(await economy(live))).toBe(totalGold(before) - 3 * price);
  await restartAndObserve(live);
  expect(quantity((await economy(live)).characters[merchant].items, 'helmet')).toBe(quantity(before.characters[merchant].items, 'helmet') + 3);
  expect(totalGold(await economy(live))).toBe(totalGold(before) - 3 * price);
  await record(live, info, 'npc-buy-once', before, { price, accepted, duplicate });
}

// A53 (live-economy.spec.ts 'a cancelled queued purchase stays cancelled while a later real purchase completes').
export async function cancelledBuyRound(live: LiveGame, info: TestInfo) {
  await catalog(live, 'scroll0');
  await catalog(live, 'helmet');
  await live.post('/merchant/force-stand', { enabled: true });
  const before = await economy(live);
  const cancelled = await live.post('/merchant/order', { buys: [{ id: 'scroll0', quantity: 2 }], crafts: [] });
  await live.post('/merchant/job/cancel', { id: cancelled.jobId });
  await restartAndObserve(live);
  expect((await live.state()).merchantForceStand).toBe(true);
  await live.post('/merchant/force-stand', { enabled: false });
  await catalog(live, 'helmet');
  const later = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1 }], crafts: [] });
  await expect.poll(async () => quantity((await economy(live)).characters[merchant].items, 'helmet'),
    { timeout: 150_000 }).toBe(quantity(before.characters[merchant].items, 'helmet') + 1);
  await jobFinished(live, later.jobId);
  const after = await economy(live);
  expect(quantity(after.characters[merchant].items, 'scroll0')).toBe(quantity(before.characters[merchant].items, 'scroll0'));
  expect(totalGold(after)).toBe(totalGold(before) - await live.admin('output=G.items.helmet.g'));
  await record(live, info, 'cancelled-buy-not-replayed', before, { cancelled, later });
}

// A54 (live-economy.spec.ts 'a manual upgrade consumes one real scroll and does not replay after restart').
// requestedAt is the page clock's (`lastEventAt`), the clock the events carry, where the old test
// read the runner's Date.now().
export async function manualUpgradeRound(live: LiveGame, info: TestInfo) {
  await seed(live, { 10: { name: 'helmet', level: 0 }, 11: { name: 'scroll0', q: 10 } });
  const before = await economy(live);
  const requestedAt = await lastEventAt(live);
  const observedUpgrade = async () => {
    const events = (await live.clients[merchant].events()).filter((event: any) => event.at >= requestedAt);
    const responses = events.flatMap((event: any) => event.event === 'game_response' ? [event.data] :
      event.event === 'player' ? (event.data?.hitchhikers || []).filter(([kind]: [string]) => kind === 'game_response').map(([, data]: [string, any]) => data) : []);
    // Maintained lucky-slot handling can move the marked item before upgrading.
    const pending = events.filter((event: any) => event.event === 'player').flatMap((event: any) =>
      (event.data?.items || []).map((item: any, slot: number) => ({ item, slot })))
      .find(({ item }: any) => item?.name === 'placeholder' && item.p?.name === 'helmet' && item.p?.scroll === 'scroll0');
    const final = responses.find((response: any) => pending && response?.num === pending.slot && response.level === 1 &&
      ['upgrade_success', 'upgrade_fail'].includes(response.response));
    return { final, chance: pending?.item.p.chance, slot: pending?.slot };
  };
  await live.post('/command', { character: merchant, type: 'upgrade-mark', slot: 10, item: { name: 'helmet', level: 0 }, tiers: 1 });
  await expect.poll(async () => {
    const state = await economy(live), character = state.characters[merchant];
    const helmet = character.items.find(item => item?.name === 'helmet');
    const observed = await observedUpgrade();
    return !character.upgrading && quantity(character.items, 'scroll0') === 9 &&
      (observed.final?.response === 'upgrade_success' ? helmet?.level === 1 :
        observed.final?.response === 'upgrade_fail' && Number.isFinite(observed.chance) && observed.chance < 1 && !helmet);
  }, { timeout: 150_000, message: 'A native final upgrade response must agree with authoritative inventory and one consumed scroll' }).toBe(true);
  await jobFinished(live);
  const completed = await economy(live);
  const observed = await observedUpgrade();
  expect(observed.final).toMatchObject({ num: observed.slot, level: 1 });
  expect(totalGold(completed)).toBe(totalGold(before));
  const outcome = completed.characters[merchant].items.filter(item => item?.name === 'helmet');
  await restartAndObserve(live);
  const after = await economy(live);
  expect(quantity(after.characters[merchant].items, 'scroll0')).toBe(9);
  expect(after.characters[merchant].items.filter(item => item?.name === 'helmet')).toEqual(outcome);
  expect(totalGold(after)).toBe(totalGold(before));
  await record(live, info, 'single-native-upgrade', before, { completed, outcome, observed });
}

// A45 (live-economy.spec.ts 'upgrade purchase batch excludes an existing target-level coat').
export async function coatBatchRound(live: LiveGame, info: TestInfo) {
  // Failure modes: existing results reduce a new order, command dispatch drops
  // the batch setting, or purchase sizing includes nonzero-level inventory.
  await catalog(live, 'coat');
  await seed(live, { 30: { name: 'coat', level: 5 } });
  await live.post('/config', { buyUpgradeBatchSize: 10 });
  const before = await economy(live);
  const nativePage = live.clients[merchant].page;
  const checkpoints: any[] = [];
  let purchased: Economy | undefined;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await nativePage.route('**/party-api/merchant/checkpoint', async route => {
    const body = route.request().postDataJSON();
    if (checkpoints.length < 64) checkpoints.push({at:Date.now(),commandId:body.commandId,
      sequence:body.state?.sequence,pendingUpgrade:body.state?.pendingUpgrade,
      spent:body.state?.spent,frame:route.request().frame().url()});
    if (!purchased && body.state?.pendingUpgrade) {
      purchased = await economy(live);
      if (checkpoints.length < 64) checkpoints.push({at:Date.now(),snapshotCaptured:true});
      await gate;
    }
    await route.continue();
  });
  try {
    const order = await live.post('/merchant/order', { buys: [{ id: 'coat', quantity: 4, level: 5 }], crafts: [] });
    await expect.poll(() => purchased, { timeout: 240_000 }).toBeDefined();
    const coats = purchased!.characters[merchant].items.filter(item => item?.name === 'coat');
    expect(coats.filter(item => (item!.level || 0) === 0)).toHaveLength(10);
    expect(coats.filter(item => item!.level === 5)).toHaveLength(1);
    await record(live, info, 'upgrade-batch-existing-target-coat', before, { order, purchased });
  } finally {
    release!();
    await nativePage.unrouteAll({behavior:'wait'});
    await info.attach('native-coat-checkpoint-capture',{body:JSON.stringify({checkpoints,purchased,state:await live.state()}),contentType:'application/json'});
  }
}

// A35 (live-economy.spec.ts 'unavailable upgrade estimate enforces its gold cap across native purchases and restart').
export async function goldCapRound(live: LiveGame, info: TestInfo) {
  // Failure inventory: fabricated attempt allowance; base/scroll spending skips
  // cap; restart resets accrued spend; retry purchases beyond the same cap.
  // Native buys/upgrades remain real. Only checkpoint transport is held after
  // the coordinator has persisted the first paid purchase, to place restart.
  // Protection-only checkpoint probes have no progress state; forward them
  // normally and retain only actual durable commerce progress for assertions.
  const item='softstepgloves';
  await catalog(live,item);
  const nativeCosts=await live.clients[merchant].run(`({base:G.items.softstepgloves.g,scroll:G.items.scroll1.g,
    nextScroll:G.items.scroll2.g,initialGrade:item_grade({name:'softstepgloves',level:0}),nextGrade:item_grade({name:'softstepgloves',level:5})})`);
  expect(nativeCosts).toMatchObject({base:420000,scroll:40000,nextScroll:1600000,initialGrade:1,nextGrade:2});
  const cap=nativeCosts.base+nativeCosts.scroll;
  await seed(live,{10:{name:'scroll1',q:4}});
  expect((await live.clients[merchant].snapshot()).items[10]?.q).toBe(4);
  // Four preexisting scrolls leave exactly one paid native scroll and base.
  // A failed upgrade cannot afford another base; five successes need scroll2.
  // This retains genuine cap exhaustion without an unrelated seven-step chain.
  const funding=await live.admin(`output=(async()=>{const p=get_player('${merchant}');
    const before=await db.collection('user').findOne({_id:p.owner});
    await db.collection('user').updateOne({_id:p.owner},{$set:{'info.gold':1000000}});
    for(const member of Object.values(players))if(member.owner===p.owner&&member.user)member.user.gold=1000000;
    return {beforeBankGold:before.info.gold,bankGold:1000000,merchantGold:p.gold};})()`);
  expect(funding.bankGold).toBe(1000000);
  expect(funding.bankGold+funding.merchantGold).toBeLessThan(64000000);
  await info.attach('declared-capped-commerce-funding',{body:JSON.stringify(funding),contentType:'application/json'});
  const checkpoints:any[]=[];
  let held=false,release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  try {
  await live.clients[merchant].page.route('**/party-api/merchant/checkpoint',async route=>{
    const body=route.request().postDataJSON();
    // Protection probes are not the fault target. Let the browser observe a
    // real disconnect during restart instead of throwing from route.fetch.
    if(!body.state||typeof body.state!=='object')return route.continue();
    if(held){
      await gate;
      checkpoints.push(body.state);
      // Once the paid checkpoint is durable, retire the proxy on release.
      // Browser transport owns disconnect/reconnect against the restarted host.
      return route.continue();
    }
    const response=await route.fetch();
    if(body.state&&typeof body.state==='object') {
      checkpoints.push(body.state);
      if(response.ok()&&!held&&Number(body.state.spent)>0&&!body.state.pendingPurchase){
        held=true;await gate;
        // The coordinator persisted this exact purchase before restart. Lose
        // only its acknowledgement; never replay the completed checkpoint.
        return route.abort('failed');
      }
    }
    await route.fulfill({response});
  });
  const order=await live.post('/merchant/order',{buys:[{id:item,quantity:1,level:12,acknowledgeUnavailable:true,goldCap:cap}],crafts:[]});
  await expect.poll(()=>held,{timeout:120_000}).toBe(true);
  const before=await live.state();
  const jobs=[before.merchantCurrent,...before.merchantQueue].filter((entry:any)=>entry?.id===order.jobId||entry?.commerceOrderId===order.jobId);
  expect(jobs,'Exactly one durable commerce owner must survive a native movement retry').toHaveLength(1);
  const job=jobs[0];
  expect(job.order.buys[0]).toMatchObject({goldCap:cap,budget:cap,estimateUnavailable:true});
  expect(job.order.buys[0].attempts).toBeUndefined();
  expect(job.resumeState.spent).toBeGreaterThan(0);
  await live.restartCoordinator();release();
  await expect.poll(async()=>{
    const state=await live.state();
    return [state.merchantCurrent,...state.merchantQueue].some((entry:any)=>(entry?.id===order.jobId||entry?.commerceOrderId===order.jobId)&&/budget exhausted|gold cap/i.test(entry.lastError||entry.error||entry.blockedReason||''))||state.merchantActivity.some((entry:any)=>/budget exhausted|gold cap/i.test(JSON.stringify(entry)));
  },{timeout:300_000}).toBe(true);
  expect(Math.max(...checkpoints.map(state=>Number(state.spent)||0))).toBeLessThanOrEqual(cap);
  expect(checkpoints.some(state=>state.pendingPurchase?.name==='scroll1'&&state.pendingPurchase.quantity===1&&state.pendingPurchase.cost===nativeCosts.scroll)).toBe(true);
  expect(checkpoints.some(state=>state.pendingPurchase?.name===item&&state.pendingPurchase.quantity===1&&state.pendingPurchase.cost===nativeCosts.base)).toBe(true);
  expect(checkpoints.some(state=>Number(state.spent)===cap)).toBe(true);
  await info.attach('capped-native-upgrade-restart',{body:JSON.stringify({nativeCosts,cap,declaredScrollStock:4,order,before,after:await live.state(),checkpoints,events:await live.clients[merchant].events()}),contentType:'application/json'});
  } finally {
    // A failed assertion must not leave a real checkpoint response held while
    // the fixture disposes its browser/request context. Suppress route errors
    // only during teardown, after ordinary assertions and response handling.
    release();
    if(!live.clients[merchant].page.isClosed())
      await live.clients[merchant].page.unrouteAll({behavior:'ignoreErrors'});
    await info.attach('native-cap-budget-ledger',{body:JSON.stringify({nativeCosts,cap,declaredScrollStock:4,
      checkpoints,final:await live.state(),events:await live.clients[merchant].events()}),contentType:'application/json'});
  }
}

// M32 with M33 and M34 (live-manual-upgrade.spec.ts), one upgrade batch: the interrupted automatic
// broom resumes from +2 (M32), a manual wcap mark is displaced before the batch starts (M33), and a
// shield withdrawn from the bank and one carried share one manual batch (M34). The coordinator
// restarts once at the end, and no mark comes back. The cells move off the old tests' ones where
// two collide: the broom's historical mark names cell 7, where M33 planted its wcap, and M33 swapped
// the wcap into cell 10, the broom's.
export async function upgradeBatchRound(live: LiveGame, info: TestInfo) {
  const from = await lastEventAt(live);
  await live.post('/merchant/force-stand',{enabled:true});
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');p.items[7]=null;p.items[10]={name:'broom',level:2};p.items[11]={name:'broom',level:7};
    p.items[20]={name:'scroll0',q:100};p.items[21]={name:'scroll1',q:100};p.items[22]={name:'scroll2',q:100};
    p.items[15]={name:'wcap',level:0};p.items[17]={name:'wcap',level:1};p.items[18]={name:'wcap',level:1};p.items[16]=null;
    p.items[9]={name:'sshield',level:0};cache_player_items(p);resend(p,'reopen+cid');
    await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0.0':{name:'sshield',level:0}}});return true})()`);
  await expect.poll(async()=>(await live.clients[merchant].snapshot()).items[10]?.level).toBe(2);
  await expect.poll(async()=>(await live.clients[merchant].snapshot()).items[9]?.name).toBe('sshield');
  // M34's bank visit shows the banked shield before its withdrawal is marked; Auto upgrade is off,
  // so the visit leaves the broom alone.
  await live.post('/command',{character:merchant,type:'bank'});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async()=>(await live.state()).bank?.packs?.items0?.some((entry:any)=>entry?.item?.name==='sshield'),{timeout:90_000}).toBe(true);
  await expect.poll(async()=>(await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
  await live.post('/merchant/force-stand',{enabled:true});
  // M32's interrupted mark: the broom was marked at cell 7 and moved to cell 10 at +2.
  await live.restoreHistoricalSettings(()=>({autoUpgradeMarks:{[merchant]:{'broom@+0':{tiers:7,quantity:-1}}},upgrades:{[merchant]:[{slot:7,liveSlot:7,item:{name:'broom',level:0},liveItem:{name:'broom',level:2},tiers:7,auto:true,passId:'historical-native-broom'}]}}));
  // M33: the player marks the wcap, then moves it before the batch starts.
  await live.post('/command',{character:merchant,type:'upgrade-mark',slot:15,item:{name:'wcap',level:0},tiers:1});
  await live.clients[merchant].run(`(async()=>{await swap(15,16);return true})()`);
  await expect.poll(async()=>(await live.clients[merchant].snapshot()).items[16]?.name).toBe('wcap');
  // M34: the banked shield's withdrawal and the carried shield, each marked +4. M32's restore
  // restarted the coordinator, and the withdrawal's upgrade admission reads the native catalog
  // (items/coordinator/production.ts validBankUpgrade), which the merchant publishes again after
  // the restart (liveb-step11-run4.log: 400 before it did). The bound is W55's catalog wait.
  await expect.poll(async()=> (await live.state(true)).merchantCatalog?.allItems?.some((entry:any)=>
    entry.id==='sshield' && (entry.upgradeable || entry.meta?.upgradeable)),
  {timeout:120_000,message:'Native upgrade catalog must authorize the shield upgrade'}).toBe(true);
  const bank=(await live.state()).bank.packs.items0.find((entry:any)=>entry?.item?.name==='sshield');
  const withdrawal=await live.post('/command',{character:merchant,type:'withdraw',pack:'items0',slot:bank.slot,item:bank.item,upgradeTiers:4});
  await live.post('/command',{character:merchant,type:'upgrade-mark',slot:9,item:{name:'sshield',level:0},tiers:4});
  const before=await live.state();
  await info.attach('upgrade-batch-intents',{body:JSON.stringify({withdrawal,before,items:(await live.clients[merchant].snapshot()).items}),contentType:'application/json'});
  const shields=before.upgrades[merchant].filter((mark:any)=>mark.item?.name==='sshield');
  expect(shields).toHaveLength(2);
  expect(new Set(shields.map((mark:any)=>mark.requestId)).size).toBe(2);
  expect(shields.every((mark:any)=>typeof mark.requestId==='string'&&mark.tiers===4&&!mark.auto)).toBe(true);
  expect(before.upgrades[merchant].filter((mark:any)=>mark.item?.name==='wcap')).toHaveLength(1);
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto upgrade':true}});
  await live.post('/merchant/force-stand',{enabled:false});
  // The three old polls' bounds summed: M32 210 s, M33 120 s, M34 150 s.
  await expect.poll(async()=>{
    const state=await live.state(),items=(await live.clients[merchant].snapshot()).items;
    const brooms=items.filter((item:any)=>item?.name==='broom');
    const errors=state.merchantActivity.filter((entry:any)=>JSON.stringify(entry).includes('Manual upgrade continuation changed'));
    expect(errors).toHaveLength(0);
    return !(state.upgrades[merchant]||[]).length && !state.merchantCurrent && !state.merchantQueue.some((job:any)=>job.reason==='auto upgrade') &&
      brooms.length>=1 && brooms.length<=2 && brooms.every((item:any)=>item.level===7) &&
      (state.characters[merchant]?.items||[]).filter((entry:any)=>entry?.item?.name==='broom').length===brooms.length;
  },{timeout:480_000}).toBe(true);
  const after=await live.state(),items=(await live.clients[merchant].snapshot()).items;
  const events=(await live.clients[merchant].events()).filter((event:any)=>event.at>from);
  expect(events.some((event:any)=>event.event==='game_response'&&['upgrade_success','upgrade_fail'].includes(event.data?.response))).toBe(true);
  expect(events.filter((event:any)=>event.event==='game_response'&&['upgrade_success','upgrade_fail'].includes(event.data?.response)).length).toBeGreaterThanOrEqual(2);
  expect(items.filter((item:any)=>item?.name==='wcap'&&item.level===1).length).toBeGreaterThanOrEqual(2);
  expect(after.merchantActivity.filter((e:any)=>JSON.stringify(e).includes('survivor is ambiguous'))).toHaveLength(0);
  const completed=items.filter((item:any)=>item?.name==='broom');
  await live.restartCoordinator();
  expect((await live.state()).upgrades[merchant]||[]).toHaveLength(0);
  expect((await live.clients[merchant].snapshot()).items.filter((item:any)=>item?.name==='broom')).toEqual(completed);
  await info.attach('native-upgrade-batch-results',{body:JSON.stringify({before,after,events,items,restarted:await live.state()}),contentType:'application/json'});
}

// M58 with M60 (live-stat-scroll-bank.spec.ts 'a merchant str stat scroll comes from the bank' and
// its luck case), one bank visit: a dex helmet in cell 20 takes the banked str scroll and one in
// cell 21 the banked luck scroll, and nothing is bought.
const statMarks = [{stat: 'str', scroll: 'strscroll', slot: 20}, {stat: 'luck', scroll: 'luckscroll', slot: 21}];
const native = (live: { admin(code: string): Promise<any> }, scroll: string, slot: number) => live.admin(`output=(async()=>{const p=get_player('${merchant}');
  const u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;
  const scrolls=list=>(list||[]).filter(i=>i&&i.name===${JSON.stringify(scroll)}).reduce((n,i)=>n+(i.q||1),0);
  const goldByCharacter=Object.fromEntries(['E2EWarrior','E2EPriest','${merchant}'].map(name=>[name,get_player(name).gold]));
  const bankGold=Number(u.gold)||0;
  return {helmet:p.items[${slot}],gold:Object.values(goldByCharacter).reduce((sum,gold)=>sum+gold,bankGold),goldByCharacter,bankGold,carried:scrolls(p.items),
    bank:Object.entries(u).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).reduce((n,[,v])=>n+scrolls(v),0)};})()`);

export async function statScrollRound(live: LiveGame, info: TestInfo) {
  const observations: any[] = [], completions: any[] = [];
  const observe=(request:any)=>{if(new URL(request.url()).pathname.endsWith('/merchant/complete'))completions.push(request.postDataJSON());};
  live.clients[merchant].page.on('request',observe);
  try {
    await expect.poll(async () => Date.now() - ((await live.state()).characters[merchant]?.seenAt || 0), { timeout: 90_000 }).toBeLessThan(3_000);
    const seeded = await live.admin(`output=(async()=>{const p=get_player('${merchant}'),marks=${JSON.stringify(statMarks)};
      if(p.items[20]||p.items[21]) throw Error('Fixture requires empty inventory cells 20 and 21');
      if(p.items.some(i=>i&&marks.some(m=>m.scroll===i.name))) throw Error('Fixture requires no carried stat scrolls');
      for(const m of marks)p.items[m.slot]={name:'helmet',level:0,stat_type:'dex'};
      const seed=info=>{const pack=info.items0||(info.items0=[]);for(const m of marks){const slot=pack.findIndex(i=>!i);
        if(slot<0&&pack.length>=42) throw Error('Fixture requires a free items0 slot');pack[slot<0?pack.length:slot]={name:m.scroll,q:1};}};
      if(p.user) seed(p.user); else {const u=await db.collection('user').findOne({_id:p.owner});
        if(Object.values(u.info).some(v=>Array.isArray(v)&&v.some(i=>i&&marks.some(m=>m.scroll===i.name)))) throw Error('Fixture requires no banked stat scrolls');
        seed(u.info);await db.collection('user').replaceOne({_id:u._id},u);}
      cache_player_items(p);resend(p,'reopen+cid');return {items:marks.map(m=>p.items[m.slot]),inBank:!!p.user};})()`);
    await info.attach('declared-inputs', { body: JSON.stringify(seeded), contentType: 'application/json' });
    await expect.poll(async () => (await live.state()).characters[merchant]?.items?.find((entry: any) => entry?.slot === 20)?.item, { timeout: 30_000 })
      .toEqual({ name: 'helmet', level: 0, stat_type: 'dex' });
    await expect.poll(async () => (await live.state()).characters[merchant]?.items?.find((entry: any) => entry?.slot === 21)?.item, { timeout: 30_000 })
      .toEqual({ name: 'helmet', level: 0, stat_type: 'dex' });
    // M60's bank visit: the coordinator sees both scrolls in the bank before the marks.
    await live.post('/command',{character:merchant,type:'bank'});
    for (const {scroll} of statMarks)
      await expect.poll(async()=>Object.values((await live.state()).bank?.packs||{}).flat().some((entry:any)=>entry?.item?.name===scroll),{timeout:90_000}).toBe(true);
    // The packs publish when the merchant enters the bank, before its visit ends. A read mid-visit
    // found a str scroll carried that was back in the bank after the visit (liveb-step12-run9.log),
    // so the reads below wait for the visit to end. The bound is A60's bank wait.
    await expect.poll(async()=>{const state=await live.state();
      return [state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.reason==='manual bank exchange');},{timeout:90_000}).toBe(false);
    const befores: Record<string, any> = {};
    for (const {scroll, slot} of statMarks) {
      const before = await native(live,scroll,slot);
      expect(before).toMatchObject({ carried: 0, bank: 1 });
      befores[scroll] = before;
    }
    await live.post('/merchant/force-stand', {enabled:true});
    for (const {stat, slot} of statMarks)
      await live.post('/command', { character: merchant, type: 'stat-scroll-mark', slot, item: { name: 'helmet', level: 0, stat_type: 'dex' }, statType: stat });
    await live.post('/merchant/force-stand',{enabled:false});
    for (const {stat, scroll, slot} of statMarks)
      await expect.poll(async () => { const n = await native(live,scroll,slot); observations.push({ at: Date.now(), n }); return n.helmet?.stat_type; },
        { timeout: 240_000, intervals: [500, 1000] }).toBe(stat);
    for (const {stat} of statMarks) {
      await expect.poll(()=>completions.flatMap(body=>body.statScrollsApplied||[]).filter((receipt:any)=>receipt.mark.statType===stat).length,{timeout:30_000}).toBe(1);
      expect(completions.flatMap(body=>body.statScrollsApplied||[]).find((receipt:any)=>receipt.mark.statType===stat).item.stat_type).toBe(stat);
    }
    // The banked scrolls were used and nothing was bought. A bank visit may deposit carried gold,
    // so the party's three balances and the bank sum to the same gold.
    for (const {scroll, slot} of statMarks) {
      const before = befores[scroll], after = await native(live,scroll,slot);
      expect(after).toMatchObject({ carried: 0, bank: 0 });
      expect(after.gold).toBe(before.gold);
    }
  } finally {
    live.clients[merchant].page.off('request',observe);
    await info.attach('native-stat-scroll-bank', { body: JSON.stringify({ observations, completions,
      native: await Promise.all(statMarks.map(m => native(live,m.scroll,m.slot).catch(String))),
      activity: (await live.state()).merchantActivity.slice(-20) }), contentType: 'application/json' });
  }
}

// A60 with A61 (live-economy.spec.ts '<manual|automatic> compound from native bank withdraws exactly
// its reserved triplet'), one bank of six +0 strrings beside a locked one and three beewings: the
// player marks one triplet for a manual compound (A60), then turns Auto compound on and marks
// another with quantity 1 (A61). Each compound's roll is declared a success at the game's compound
// handler, scoped to a triplet of +0 strrings; the travel, withdrawals, scrolls and results stay
// native.
export async function bankCompoundRound(live: LiveGame, info: TestInfo) {
  const observations:any[]=[];
  const account=(state:Economy,level:number)=>Object.values(state.characters).reduce((sum,character)=>sum+character.items.filter(item=>item?.name==='strring'&&(item.level||0)===level).length,0)+Object.values(state.bank).reduce((sum,items)=>sum+items.filter(item=>item?.name==='strring'&&(item.level||0)===level).length,0);
  const bankRings=async(rings:number)=>expect.poll(async()=>{
    const state=await live.state();
    return {rings:state.bank?.packs?.items0?.filter((entry:any)=>entry?.item?.name==='strring'&&!(entry.item.level||0)).length,
      bankJobPending:[state.merchantCurrent,...state.merchantQueue].some(job=>job?.reason==='manual bank exchange')};
  },{timeout:90_000,message:'The native bank visit must finish publishing its final slot layout before selecting the reserved triplet'}).toEqual({rings,bankJobPending:false});
  const select=async(phase:string)=>{
    const selectionState=await live.state(),selected=selectionState.bank.packs.items0.find((entry:any)=>entry?.item?.name==='strring'&&!entry.item.l&&!(entry.item.level||0));
    observations.push({at:Date.now(),phase,selected:{slot:selected.slot,item:selected.item},bank:selectionState.bank.packs.items0.map((entry:any)=>entry&&({slot:entry.slot,item:entry.item}))});
    return selected;
  };
  let before:Economy|undefined;
  try{
    await live.post('/merchant/force-stand',{enabled:true});
    await live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=await db.collection('user').findOne({_id:p.owner}),b=p.user||u.info;
     b.items0=b.items0||[];for(const slot of [30,31,32,33,34,35,36,37])if(b.items0[slot])throw Error('Bank fixture occupied');
     for(const slot of [30,31,32,33,34,35])b.items0[slot]={name:'strring',level:0};b.items0[36]={name:'strring',level:0,l:'l'};b.items0[37]={name:'beewings',q:3};
     if(!p.user)await db.collection('user').replaceOne({_id:u._id},u);return true;})()`);
    await live.post('/command',{character:merchant,type:'bank'});
    await live.post('/merchant/force-stand',{enabled:false});
    await bankRings(7);
    await live.post('/merchant/force-stand',{enabled:true});
    const manual=await select('manual selection');
    await live.clients[merchant].run(`(()=>{globalThis.__manualBankCompoundReceipts=[];parent.socket.on('game_response',data=>{const response=typeof data==='string'?data:data&&data.response;if(response==='compound_success'||response==='compound_fail')globalThis.__manualBankCompoundReceipts.push({at:Date.now(),response,data});});return true;})()`);
    await live.admin(`output=(()=>{const p=get_player('${merchant}'),socket=p.socket,handlers=socket.listeners('compound');
     if(handlers.length!==1)throw Error('Expected one native compound handler');
     const original=handlers[0],log=[];
     function wrapped(data){const selected=data&&!data.calculate&&Array.isArray(data.items)&&data.items.length===3&&data.items.every(slot=>p.items[slot]?.name==='strring'&&(p.items[slot].level||0)===0);
      if(!selected)return original.apply(this,arguments);
      const grade=G.items.strring.igrade,previous=D.compounds[grade][1];D.compounds[grade][1]=1;
      try{log.push({at:Date.now(),items:data.items.slice(),declaredProbability:1});return original.apply(this,arguments);}finally{D.compounds[grade][1]=previous;}}
     socket.removeListener('compound',original);socket.on('compound',wrapped);globalThis.__manualBankCompoundHook={socket,original,wrapped,log};return true;})()`);
    await live.post('/command',{character:merchant,type:'compound-mark',pack:'items0',slot:manual.slot,item:manual.item});
    before=await economy(live);
    await live.post('/merchant/force-stand',{enabled:false});
    await expect.poll(async()=>{
      const state=await live.state(),native=await economy(live),receipts=await live.clients[merchant].run('globalThis.__manualBankCompoundReceipts');
      observations.push({at:Date.now(),groups:state.compounds?.[merchant],native,receipts});
      return !(state.compounds?.[merchant]||[]).length&&receipts.length===1&&receipts[0].response==='compound_success'&&account(native,0)===account(before!,0)-3&&account(native,1)===account(before!,1)+1;
    },{timeout:240_000}).toBe(true);
    {
      const after=await economy(live),bankItems=Object.values(after.bank).flat();
      expect(bankItems.filter(item=>item?.name==='strring'&&item.l)).toEqual([{name:'strring',level:0,l:'l'}]);
      expect(bankItems.filter(item=>item?.name==='beewings').reduce((sum,item)=>sum+(item?.q||1),0)).toBe(3);
      expect(bankQuantity(after,'strring')).toBe(bankQuantity(before,'strring')-3);
      await record(live,info,'native-bank-compound',before,{automatic:false,after,observations});
    }
    // A61: the merchant's next visit publishes the bank with the three +0 rings left beside the
    // locked one, and the automatic mark takes one of them.
    await live.post('/merchant/force-stand',{enabled:true});
    await live.post('/command',{character:merchant,type:'bank'});
    await live.post('/merchant/force-stand',{enabled:false});
    await bankRings(4);
    await live.post('/merchant/force-stand',{enabled:true});
    const automatic=await select('automatic selection');
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto compound':true}});
    await live.post('/command',{character:merchant,type:'auto-compound-mark',pack:'items0',slot:automatic.slot,item:automatic.item,targetTier:1,quantity:1});
    before=await economy(live);
    await live.post('/merchant/force-stand',{enabled:false});
    await expect.poll(async()=>{
      const state=await live.state(),native=await economy(live),receipts=await live.clients[merchant].run('globalThis.__manualBankCompoundReceipts');
      observations.push({at:Date.now(),groups:state.compounds?.[merchant],native,receipts});
      return (state.autoCompounds?.[merchant]||[]).some((rule:any)=>rule.name==='strring'&&rule.quantity===0)&&receipts.length===2&&receipts[1].response==='compound_success'&&account(native,0)===account(before!,0)-3&&account(native,1)===account(before!,1)+1;
    },{timeout:240_000}).toBe(true);
    const after=await economy(live),bankItems=Object.values(after.bank).flat();
    expect(bankItems.filter(item=>item?.name==='strring'&&item.l)).toEqual([{name:'strring',level:0,l:'l'}]);
    expect(bankItems.filter(item=>item?.name==='beewings').reduce((sum,item)=>sum+(item?.q||1),0)).toBe(3);
    await record(live,info,'native-bank-compound-automatic',before,{automatic:true,after,observations,declaredRolls:await live.admin('output=globalThis.__manualBankCompoundHook.log')});
  }finally{
    await info.attach('native-manual-bank-compound-observations',{body:JSON.stringify({before,observations,state:await live.state()}),contentType:'application/json'});
    await live.admin(`output=(()=>{const hook=globalThis.__manualBankCompoundHook;if(hook){hook.socket.removeListener('compound',hook.wrapped);hook.socket.on('compound',hook.original);delete globalThis.__manualBankCompoundHook;}return true;})()`).catch(()=>{});
  }
}

// A44 (live-economy.spec.ts 'merchant mass skills use both tiers and passive recovery restores
// critical HP and MP during work'), with DESIGN.md's fix: the round reads use_skill on the
// merchant's own work and plants vitals on the game server, and stops none of the runtime's
// timers. The low tier's MP is a cap on the server's merchant (`capMana`), which the passive
// regeneration and the potions keep refilling up to; the old test stopped the regeneration timer
// and the role runner instead. The recovery reads a third armorbox exchange, a job of the merchant's
// own, in place of a reconnect and a held checkpoint, and that job ends on jobFinished's own bound.
async function capMana(live: LiveGame, cap: number | null) {
  return live.admin(`output=(()=>{const p=get_player('${merchant}'),cap=${JSON.stringify(cap)};
    const value=p.mp;delete p.mp;p.mp=value;
    if(cap!==null){let mp=Math.min(value,cap);Object.defineProperty(p,'mp',{configurable:true,enumerable:true,get(){return mp;},set(next){mp=Math.min(next,cap);}});}
    resend(p,'reopen+cid');return p.mp})()`) as Promise<number>;
}

export async function massSkillsRound(live: LiveGame, info: TestInfo) {
  // Failure modes: commerce omits production buffs; ++ crosses the MP reserve;
  // exchange waits forever on a legacy skill promise; busy work fences recovery;
  // missing potions prevent free recovery or overlapping pulses consume twice.
  await catalog(live, 'helmet');
  await seed(live, { 10: { name: 'armorbox', q: 3 } });
  await live.restoreHistoricalSettings(() => ({ luckyUpgradeSlots: { [merchant]: 30 } }));
  await catalog(live, 'helmet');
  await live.clients[merchant].run(`(()=>{
    globalThis.__e2eMerchantSkills=[];const native=use_skill;
    use_skill=function(skill,...args){globalThis.__e2eMerchantSkills.push({skill,mp:character.mp,maxMp:character.max_mp,hp:character.hp});return native(skill,...args)};
    return true;
  })()`);
  const before = await economy(live);
  const high = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 1 }], crafts: [] });
  await jobFinished(live, high.jobId);
  await jobFinished(live, (await live.post('/merchant/exchange-order', { exchanges: [{ id: 'armorbox', level: 0, quantity: 1 }] })).jobId);
  const highSkills = await live.clients[merchant].run('globalThis.__e2eMerchantSkills');
  expect(highSkills.some((entry: any) => entry.skill === 'massproductionpp')).toBe(true);
  expect(highSkills.some((entry: any) => entry.skill === 'massexchangepp')).toBe(true);

  // The higher tiers leave one Merchant's Luck cast of MP (production.ts `massBuff`), so the pool
  // sits below a higher tier's cost plus that reserve and above both lower tiers' costs.
  const costs = await live.admin(`output=Object.fromEntries(['massproductionpp','massexchangepp','massproduction','massexchange','mluck'].map(s=>[s,G.skills[s].mp]))`);
  const ceiling = Math.min(costs.massproductionpp, costs.massexchangepp) + costs.mluck - 5;
  async function lowMana() {
    const pool = await capMana(live, ceiling);
    expect(pool).toBeGreaterThanOrEqual(Math.max(costs.massproduction, costs.massexchange));
    await expect.poll(async () => (await live.clients[merchant].snapshot()).mp).toBeLessThanOrEqual(pool + 50);
  }
  await lowMana();
  try {
    const low = await live.post('/merchant/order', { buys: [{ id: 'helmet', quantity: 1, level: 1 }], crafts: [] });
    await jobFinished(live, low.jobId);
    await lowMana();
    await jobFinished(live, (await live.post('/merchant/exchange-order', { exchanges: [{ id: 'armorbox', level: 0, quantity: 1 }] })).jobId);
  } finally {
    await capMana(live, null);
  }
  const skills = await live.clients[merchant].run('globalThis.__e2eMerchantSkills');
  expect(skills.some((entry: any) => entry.skill === 'massproduction')).toBe(true);
  expect(skills.some((entry: any) => entry.skill === 'massexchange')).toBe(true);
  for (const entry of skills.filter((entry: any) => ['massproductionpp', 'massexchangepp'].includes(entry.skill)))
    expect(entry.mp - costs[entry.skill]).toBeGreaterThanOrEqual(costs.mluck);

  const recovery = await live.post('/merchant/exchange-order', { exchanges: [{ id: 'armorbox', level: 0, quantity: 1 }] });
  await expect.poll(async () => (await live.state()).merchantCurrent?.id).toBe(recovery.jobId);
  const depleted = await live.admin(`output=(()=>{const p=get_player('${merchant}');p.hp=Math.floor(p.max_hp*.2)-100;p.mp=Math.floor(p.max_mp*.1);cache_player_items(p);resend(p,'reopen+cid');return {hp:p.hp,mp:p.mp,potions:p.items.filter(i=>i&&['hpot1','mpot1'].includes(i.name))}})()`);
  await expect.poll(async () => {
    const p = await live.clients[merchant].snapshot();
    return p.hp > depleted.hp && p.mp > depleted.mp && depleted.potions.every((item: any) =>
      (p.items.find((liveItem: any) => liveItem?.name === item.name)?.q || 0) < item.q);
  }, { timeout: 20_000, message: 'Production must not block native HP/MP potion recovery' }).toBe(true);
  await jobFinished(live, recovery.jobId);
  await record(live, info, 'merchant-mass-skills-and-recovery', before, { highSkills, skills, depleted });
}

// The offering stock boundary: W52 plays carried (A24), native bank (A25) and protected (A28) on its
// headless merchant. Optional absent (A26) is a unit row of upgrade-offerings-client.test.cjs, and
// required absent (A27), a wait across a coordinator restart, is upgrade-offerings.test.cjs's.
export type OfferingSource = 'carried' | 'native bank' | 'protected';
export async function offeringBoundaryRound(live: LiveGame, info: TestInfo, source: OfferingSource) {
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');p.items[20]={name:'helmet',level:0};p.items[22]={name:'scroll0',q:10};
    ${source==='carried'?"p.items[24]={name:'offeringp',q:2};":source==='protected'?"p.items[24]={name:'offeringp',q:2,l:'l'};":source==='native bank'?"const bank=await db.collection('user').findOne({_id:p.owner});bank.info.items0[0]={name:'offeringp',q:2};await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':bank.info.items0}});if(p.user)p.user.items0=bank.info.items0;":''}
    cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await expect.poll(async()=>(await live.state()).characters[merchant]?.items[20]?.item?.name).toBe('helmet');
  if(source==='native bank') {
    const bank=await live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=await db.collection('user').findOne({_id:p.owner});return {gold:0,packs:{items0:u.info.items0.map((item,slot)=>item?{slot,item}:null)}};})()`);
    await live.post('/bankboi/checkpoint',{character:merchant,bank});
  }
  const required=source!=='protected';
  await live.post('/command',{character:merchant,type:'upgrade-offering-rule',rule:{name:'helmet',floor:0,ceiling:1,offering:'offeringp',required}});
  await live.post('/command',{character:merchant,type:'upgrade-mark',slot:20,item:{name:'helmet',level:0},tiers:1});
  const observations:any[]=[];let native:any;
  try {
    await expect.poll(async()=>{
      const state=await live.state();if(observations.length>=128)observations.shift();observations.push({upgrades:state.upgrades[merchant],job:state.merchantCurrent,withdrawals:state.withdrawals[merchant]});
      native=await live.admin(`output=(async()=>{const p=get_player('${merchant}');if(!p)return null;const u=await db.collection('user').findOne({_id:p.owner});const all=[...p.items,...Object.entries(p.user||u.info).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v)];return {helmets:all.filter(i=>i&&i.name==='helmet'),offerings:all.filter(i=>i&&i.name==='offeringp').reduce((sum,i)=>sum+(i.q||1),0)};})()`);
      return native && !native.helmets.some((item:any)=>(item.level||0)===0) && !(state.upgrades[merchant] || []).length;
    },{timeout:120_000}).toBe(true);
    expect(native.offerings).toBe(source==='carried'||source==='native bank'?1:source==='protected'?2:0);
    for(const item of native.helmets) expect(item.level).toBe(1);
  } finally {
    await info.attach('native-offering-stock-boundary',{body:JSON.stringify({source,native,observations,state:await live.state()}),contentType:'application/json'});
  }
}
