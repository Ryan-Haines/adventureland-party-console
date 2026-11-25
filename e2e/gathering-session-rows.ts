import type {Page, TestInfo} from '@playwright/test';
import {test, expect, type LiveGame} from './live-fixtures';
import {party} from './game/hunt-lifecycle';
import {CHARACTER_NOTICES, FIXTURE_KIND, FIXTURE_REASON, characterHeard, merchantHooksSwitches, registerCharacterHalf,
  type Heard} from './fixtures/merchant-hooks-addon';

// W58's one gathering day (test-windows DESIGN.md 2.2 W58), the bodies of live-merchant-hooks.spec.ts,
// live-equipment.spec.ts's tool crafting and manual weapon tests and live-gathering-cooldown.spec.ts
// (every old spec this file cites without a commit is at 21fe30a2b):
//  1. the merchant hooks fixture add-on registers and stays on for the day; its kind, its job with
//     the refused listings, a force stand pausing the job and the stand return run (M40);
//  2. the fishing tool, then the mining tool, is missing: no order before the opt-in, a 409 on the
//     missing materials, then one craft from the planted recipe (M14, M15);
//  3. with both modes on, the player equips a Broom during an owned cast; gathering resumes after
//     the Broom receipt (M11; M10 is its uninterrupted case);
//  4. those resumed casts are the declared rolls: each miss is recast at once and each hit starts
//     the game cooldown (M25), and the fishing attempts are M40's gathering row;
//  5. gathering stops, the Broom stays equipped, and a coordinator restart keeps the weapon and
//     the cooldowns.
// The rolls are declared only after the Broom receipt: the interrupted channel ends with the
// server's delete of its condition, which would arm the roll hook, so an earlier declaration
// would spend a miss on the interrupted cast.
const merchant = 'E2EMerchant', name = merchant;
const M = merchant;

type Roll = { mode: string; outcome: string; at: number };
async function rolls(live: LiveGame): Promise<Roll[]> {
  return live.admin(`output=(globalThis.__e2eGather?.log||[]).slice()`);
}
async function stock(live: LiveGame): Promise<number> {
  return live.admin(`output=get_player('${name}').items.filter(item=>item&&!['rod','pickaxe','hpot0','mpot0','hpot1','mpot1','broom','staff','stand0'].includes(item.name)).reduce((n,item)=>n+(item.q||1),0)`);
}
const fixture = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-merchant-hooks', body);
const heard = async (live: LiveGame, since: number) => await fixture(live, { op: 'heard', since }) as Heard[];
const ask = async (live: LiveGame, hook: string, args: unknown[] = []) => (await fixture(live, { op: 'ask', hook, args }) as { answer: any }).answer;
const of = (list: Heard[], hook: string, owner?: string) => list.filter(h => h.hook === hook && (!owner || h.payload.owner === owner));

// The build's native gathering readiness (v1.5 aac30d45 live-equipment.spec.ts:128-138, read through
// the owners' names): the runner's holder record, the bag owner's inventory commands and the last
// command the intake accepted.
async function gatheringCommandSnapshot(live: LiveGame, name: string) {
  return live.clients[name].frame.evaluate(() => {
    const root = (document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
    const holder = root?.__merchantHolder;
    return {at: Date.now(), lastCommand: root?.__partyLastCommand, inventoryCommands: root?.partyItems?.bag?.facts().inventoryCommands,
      blocked: root?.__merchantGatheringBlockedReason,
      holder: holder && {kind: holder.kind, mode: holder.mode, phase: holder.phase, cancelled: holder.cancelled, commandId: holder.commandId},
      session: root?.__merchantGatheringSession, status: root?.__partyStatusDiagnostics?.slice(-6)};
  });
}
// Ryan's bounds: availability agrees within 15 s, and an owned native cast starts within 90 s.
const AVAILABILITY_MS = 15_000; // aac30d45 e2e/live-equipment.spec.ts:165
const CAST_WAIT_MS = 90_000; // aac30d45 e2e/live-equipment.spec.ts:287

async function gatheringOff(live: LiveGame) {
  for (const mode of ['fishing', 'mining']) await live.post('/merchant/gather', { mode, enabled: false });
  await expect.poll(async () => (await live.state()).gatheringModes, { timeout: 30_000 }).toEqual([]);
  await expect.poll(() => live.clients[name].frame.evaluate(() => {
    const root = (document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
    return !root.__merchantGatheringSession && !(root.__merchantHolder&&root.__merchantHolder.kind==='gathering');
  }), { timeout: 30_000 }).toBe(true);
}

export async function gatheringSessionPlay(live: LiveGame, page: Page, info: TestInfo) {
  await party(live);
  await gatheringOff(live);
  const client = live.clients[M]!;
  // The reset merchant carries 1000 HP potions, past the restock's maximum of 20, and 10M gold, so the
  // fixture's restock ended in the tick it started and the force stand had no running job to pause.
  // Ten potions, above the minimum of 5 that queues the core restock, and no gold send the fixture's
  // job to the bank for the 200 gold first. The stand row needs a stand0, which the reset merchant
  // does not carry; the fishing row's rod comes from round 2's craft.
  expect(await live.admin(`output=(async()=>{const m=get_player('${M}'),free=()=>m.items.findIndex((v,i)=>!v&&i<m.isize);
    const potion=m.items.findIndex(v=>v&&v.name==='hpot1');if(potion<0)throw Error('No HP potion stack');m.items[potion].q=10;
    for(const name of ['stand0'])if(!m.items.some(v=>v&&v.name===name)){const slot=free();if(slot<0)throw Error('No free slot for '+name);m.items[slot]={name};}
    m.gold=0;if(m.user)m.user.gold=Math.max(Number(m.user.gold)||0,100000);
    else await db.collection('user').updateOne({_id:m.owner,'info.gold':{$lt:100000}},{$set:{'info.gold':100000}});
    cache_player_items(m);resend(m,'reopen+cid');return true;})()`)).toBe(true);
  await expect.poll(async () => (await client.snapshot()).items.filter((i: any) => i && ['stand0'].includes(i.name)).length).toBe(1);
  expect(await fixture(live, { op: 'register' }), 'the coordinator half registers').toEqual({ ok: true });
  expect(await client.run(registerCharacterHalf), 'the character half registers').toEqual({ ok: true });
  await live.post('/settings', { changes: [{ field: 'addons', value: await client.run(merchantHooksSwitches(true)) }] });
  const since = Date.now(), pageSince = await client.run('Date.now()') as number, rows: Record<string, unknown> = {};
  const pageHeard = async () => await client.run(characterHeard(pageSince)) as Heard[];
  // The declared rolls' hook goes on now with no outcomes, so every gathering roll before the
  // declaration is the game's own.
  live.undo('the gathering roll hook', () => live.admin(`output=(()=>{clearInterval(globalThis.__e2eGatherTimer);if(globalThis.__e2eOrigRandom)Math.random=globalThis.__e2eOrigRandom;globalThis.__e2eGather=null;
      const p=get_player('${name}');if(p&&p.c&&p.c.__e2eTarget)p.c=p.c.__e2eTarget;return true;})()`));
  const hook = await live.admin(`output=(()=>{const p=get_player('${name}');
    globalThis.__e2eGather={armed:null,outcomes:{},log:[]};
    if(!globalThis.__e2eOrigRandom)globalThis.__e2eOrigRandom=Math.random;
    const original=globalThis.__e2eOrigRandom;
    Math.random=function(){const g=globalThis.__e2eGather;
      if(g&&g.armed){const mode=g.armed;g.armed=null;const outcome=(g.outcomes[mode]||[]).shift();
        if(outcome){g.log.push({mode,outcome,at:Date.now()});return outcome==='hit'?0.001:0.999;}}
      return original();};
    // A reconnect creates a new player object; keep its conditions wrapped.
    const wrap=()=>{const q=get_player('${name}');if(!q||!q.c||q.c.__e2eTarget)return;
      q.c=new Proxy(q.c,{get(t,k){return k==='__e2eTarget'?t:t[k];},deleteProperty(t,k){
        if((k==='fishing'||k==='mining')&&globalThis.__e2eGather)globalThis.__e2eGather.armed=k;return delete t[k];}});};
    wrap();clearInterval(globalThis.__e2eGatherTimer);globalThis.__e2eGatherTimer=setInterval(wrap,50);
    return {wrapped:!!p.c.__e2eTarget};})()`);
  expect(hook.wrapped, 'The roll hook wraps the merchant conditions').toBe(true);
  try {
    const owner = await hooksRound(live, since, pageHeard, rows);
    await live.post('/settings', { changes: [{ field: 'merchantRealmBlacklist', value: [] }] });
    for (const mode of ['fishing', 'mining'] as const) await toolCraftRound(live, info, mode);
    await weaponRound(live, page, info, hook);
    await test.step('merchant.gathering.phase, .cast: one fishing attempt walks, casts and reports its catch or miss', async () => {
      await expect.poll(async () => of(await pageHeard(), 'merchant.gathering.cast').length, { timeout: 300_000, intervals: [1000] }).toBeGreaterThan(0);
      const phases = of(await pageHeard(), 'merchant.gathering.phase').map(h => h.payload.phase);
      rows.phases = phases;
      // Every attempt's holder opens at 'travel', and an attempt that ends before its cast (a tool
      // order, a movement retry, a bank trip, the Broom equip) leaves its own 'travel' ahead of the
      // casting one.
      const cast = phases.indexOf('cast');
      expect(phases[0]).toBe('travel');
      expect(cast, 'a cast phase was told').toBeGreaterThan(0);
      expect(phases[cast - 1]).toBe('travel');
      expect(['catch', 'miss']).toContain(of(await pageHeard(), 'merchant.gathering.cast')[0]!.payload.outcome);
    });
    // MJ22: every character notice of the table was heard.
    const all = await pageHeard();
    expect(CHARACTER_NOTICES.filter(n => !of(all, n).length), 'every character notice was heard').toEqual([]);
    rows.owner = owner;
    await restartRound(live, page, info);
  } finally {
    await info.attach('merchant-hooks', { body: JSON.stringify({ rows, heard: await heard(live, since).catch(() => null),
      page: await pageHeard().catch(() => null) }), contentType: 'application/json' });
    live.holdMerchantStatus(false, { completionOnly: true });
    await fixture(live, { op: 'jobs', jobs: [] }).catch(() => {});
    await gatheringOff(live).catch(() => {});
    await live.post('/settings', { changes: [{ field: 'merchantRealmBlacklist', value: [] }] }).catch(() => {});
    await live.post('/settings', { changes: [{ field: 'addons', value: await client.run(merchantHooksSwitches(false)).catch(() => ({})) }] }).catch(() => {});
  }
}

// 1. M40 (live-merchant-hooks.spec.ts): each step's title is the `fixture` its `HOOKS` or `SLOTS`
// row names (runtime/hooks/rows/08-merchant.ts).
async function hooksRound(live: LiveGame, since: number, pageHeard: () => Promise<Heard[]>, rows: Record<string, unknown>) {
  // The dashboard state names the realm in realmControl; it has no top-level activeRealm.
  const home = (await live.state()).realmControl.activeRealm as string;
  let owner = '';
  await test.step("merchant.jobKind: the fixture's kind at priority 90 runs at 74, with a ring entry", async () => {
    await expect.poll(async () => of(await heard(live, since), 'merchant.jobKind').length, { timeout: 60_000, intervals: [500] }).toBeGreaterThan(0);
    const kind = await ask(live, 'merchant.kind', [FIXTURE_REASON]);
    rows.kind = kind;
    expect([kind.priority, kind.asked, kind.command, kind.realm]).toEqual([74, 90, 'merchant-self-restock', 'listing']);
  });
  await test.step("merchant-routines: the fixture's kind is a row of the routine priorities", async () => {
    expect((await ask(live, 'merchant.kind', [FIXTURE_REASON])).label, "the slot entry's label").toBe('Fixture restock');
  });
  await test.step("merchant.kind: answers a core kind and the fixture's clamped kind", async () => {
    expect((await ask(live, 'merchant.kind', ['restock'])).command).toBe('merchant-self-restock');
  });
  await test.step("merchant.job: the fixture's job is queued and runs; its PVP and blacklisted listings are refused", async () => {
    await live.post('/settings', { changes: [{ field: 'merchantRealmBlacklist', value: ['SR_EUI'] }] });
    // The restock finishes in under a second, so the row holds the merchant's completion and the
    // job stays current until the force stand row pauses it.
    live.holdMerchantStatus(true, { completionOnly: true });
    await fixture(live, { op: 'jobs', jobs: [{ kind: FIXTURE_KIND, target: M, realm: 'USPVP' }, { kind: FIXTURE_KIND, target: M, realm: 'SR_EUI' },
      { kind: FIXTURE_KIND, target: M, realm: home }] });
    await expect.poll(async () => of(await heard(live, since), 'merchant.job.started').filter(h => h.payload.kind === FIXTURE_REASON).length,
      { timeout: 120_000, intervals: [500] }).toBe(1);
    const queued = of(await heard(live, since), 'merchant.job.queued').filter(h => h.payload.kind === FIXTURE_REASON);
    rows.queued = queued;
    expect(queued.length, 'the PVP and blacklisted listings queue nothing').toBe(1);
    owner = String(queued[0]!.payload.owner);
  });
  await test.step("jobs.current: names the fixture's job while it runs", async () => {
    await expect.poll(async () => (await ask(live, 'jobs.current'))?.reason, { timeout: 30_000, intervals: [250] }).toBe(FIXTURE_REASON);
  });
  await test.step("merchant.holder.changed: the runner's holder goes to the fixture's job and back to none", async () => {
    await expect.poll(async () => of(await pageHeard(), 'merchant.holder.changed').some(h => h.payload.to === 'job'),
      { timeout: 60_000, intervals: [250] }).toBe(true);
  });
  await test.step("merchant.job.paused, .resumed: force stand pauses the fixture's job, which resumes after it", async () => {
    await live.post('/merchant/force-stand', { enabled: true });
    await expect.poll(async () => of(await heard(live, since), 'merchant.job.paused', owner).length, { timeout: 60_000, intervals: [250] }).toBe(1);
    live.holdMerchantStatus(false, { completionOnly: true });
    await live.post('/merchant/force-stand', { enabled: false });
    await expect.poll(async () => of(await heard(live, since), 'merchant.job.resumed', owner).length, { timeout: 120_000, intervals: [500] }).toBe(1);
  });
  await test.step("merchant.job.queued, .started, .ended: one each for the fixture's job", async () => {
    await expect.poll(async () => of(await heard(live, since), 'merchant.job.ended', owner).length, { timeout: 180_000, intervals: [500] }).toBe(1);
    const all = await heard(live, since);
    expect(['merchant.job.queued', 'merchant.job.ended'].map(n => of(all, n, owner).length)).toEqual([1, 1]);
    expect(of(all, 'merchant.job.started', owner).length, 'started once, and once more on its resume').toBe(2);
    expect(of(await pageHeard(), 'merchant.holder.changed').some(h => h.payload.from === 'job'), 'the job holder let go').toBe(true);
  });
  await test.step("merchant.stand.opened, .closed: the stand return opens the stand and the fixture's job closes it", async () => {
    // A stand the return opens after the row starts, so the fixture's job meets an open stand.
    const at = await live.clients[M]!.run('Date.now()') as number;
    await expect.poll(async () => of(await pageHeard(), 'merchant.stand.opened').filter(h => h.at >= at).length, { timeout: 180_000, intervals: [500] }).toBeGreaterThan(0);
    await fixture(live, { op: 'jobs', jobs: [{ kind: FIXTURE_KIND, target: M, realm: home }] });
    await expect.poll(async () => of(await pageHeard(), 'merchant.stand.closed').some(h => h.payload.by === 'job'),
      { timeout: 120_000, intervals: [500] }).toBe(true);
  });
  // The second job's end, so round 2 starts with no fixture job.
  await expect.poll(async () => of(await heard(live, since), 'merchant.job.ended').filter(h => h.payload.kind === FIXTURE_REASON).length,
    { timeout: 180_000, intervals: [500], message: "The fixture's stand job ends before the tool rounds" }).toBe(2);
  await fixture(live, { op: 'jobs', jobs: [] });
  return owner;
}

// 2. M14 and M15 (live-equipment.spec.ts 'missing <mode> tool crafts once only after opt in and
// available materials').
async function toolCraftRound(live: LiveGame, info: TestInfo, mode: 'fishing' | 'mining') {
 const tool=mode==='fishing'?'rod':'pickaxe',responses:any[]=[],pending:Promise<void>[]=[];
 const native=()=>live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;return {gold:p.gold+(Number(u.gold)||0),tools:p.items.filter(i=>i&&i.name==='${tool}').length+(p.slots.mainhand?.name==='${tool}'?1:0),bank:Object.entries(u).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v).filter(i=>i&&i.name==='${tool}').length};})()`);
 const observe=(response:any)=>{if(!new URL(response.url()).pathname.endsWith('/merchant/order'))return;pending.push((async()=>{responses.push({at:Date.now(),status:response.status(),body:await response.json()});})().catch(()=>{}));};
 live.clients[merchant].page.on('response',observe);
 try {
  await expect.poll(async()=>(await live.state(true)).merchantCatalog?.craftable?.some((choice:any)=>choice.id===tool),{timeout:120_000}).toBe(true);
  const catalog=(await live.state(true)).merchantCatalog,recipe=catalog.craftable.find((choice:any)=>choice.id===tool).materials;
  expect(recipe.length).toBeGreaterThan(0);
  expect(recipe.some((material:any)=>!catalog.buyable.some((choice:any)=>choice.id===material.id))).toBe(true);
  for(const skill of ['fishing','mining'])await live.post('/merchant/gather',{mode:skill,enabled:false});
  // Declared initial inventory removes only these recipe inputs and tools. No
  // native action, craft receipt, result or cooldown is substituted by the fixture.
  const seed=await live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=await db.collection('user').findOne({_id:p.owner}),b=p.user||u.info,names=${JSON.stringify(recipe.map((m:any)=>m.id).concat([tool]))};
    for(const q of Object.values(players).filter(q=>q.owner===p.owner)){q.items=q.items.map(i=>i&&names.includes(i.name)?null:i);cache_player_items(q);resend(q,'reopen+cid');}
    for(const [key,items]of Object.entries(b))if(/^items[0-9]+$/.test(key)&&Array.isArray(items))b[key]=items.map(i=>i&&names.includes(i.name)?null:i);
    if(p.slots.mainhand?.name==='${tool}'){p.slots.mainhand=null;p.cslots.mainhand=null;resend(p,'reopen+cid');}
    if(!p.user)await db.collection('user').replaceOne({_id:u._id},u);return {recipe:${JSON.stringify(recipe)},bankMounted:!!p.user};})()`);
  await expect.poll(async()=>{const n=await native();return n.tools+n.bank;},{timeout:30_000}).toBe(0);
  const before=await native();
  // Default-off missing-tool behavior neither creates an order nor spends gold.
  await live.post('/merchant/gather',{mode,enabled:true});
  await expect.poll(async()=>(await live.state()).gatheringNoTool?.[mode],{timeout:90_000}).toBe(true);
  expect(responses).toHaveLength(0);expect((await native()).gold).toBe(before.gold);
  // The no-tool report goes once per missing record, and the race of a late report against the
  // opt-in is gone with the mode switch-off it raced. The opt-in
  // clears the record and the merchant orders the replacement.
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{['craft '+mode+' tools']:true}});
  await live.post('/merchant/gather',{mode,enabled:true});
  await expect.poll(()=>responses.some(response=>response.status===409&&response.body.error==='crafting materials are no longer available'),{timeout:90_000}).toBe(true);
  expect((await native()).gold).toBe(before.gold);
  expect(responses.some(response=>response.status===200)).toBe(false);
  // Provide exactly one native recipe; successful crafting must own and consume it.
  await live.admin(`output=(()=>{const p=get_player('${merchant}');for(const material of ${JSON.stringify(recipe)}){const slot=p.items.findIndex(i=>!i);if(slot<0)throw Error('No material seed slot');p.items[slot]={name:material.id,...(material.level?{level:material.level}:{}),...(material.quantity>1?{q:material.quantity}:{})};}cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await expect.poll(async()=>(await native()).tools,{timeout:240_000,message:'Native crafting must produce its missing tool'}).toBe(1);
  await live.post('/merchant/gather',{mode,enabled:false});
  await expect.poll(async()=>{const state=await live.state();return [state.merchantCurrent,...state.merchantQueue].some(job=>job?.order?.crafts?.some((line:any)=>line.id===tool));},{timeout:30_000}).toBe(false);
  await Promise.all(pending);
  const accepted=responses.filter(response=>response.status===200);
  expect(accepted.length).toBeGreaterThan(0);
  expect(new Set(accepted.map(response=>response.body.jobId)).size).toBe(1);
  expect((await native()).tools).toBe(1);
  await info.attach('native-replacement-tool-craft-'+mode,{body:JSON.stringify({mode,tool,seed,before,after:await native(),responses,state:await live.state()}),contentType:'application/json'});
 } finally {
  live.clients[merchant].page.off('response',observe);await Promise.all(pending);
  await live.post('/merchant/gather',{mode,enabled:false}).catch(()=>{});
 }
}

// 3 and 4. M11 (live-equipment.spec.ts 'manual merchant weapon remains selected through gathering
// and restart across an interrupted native cast') and M25 (live-gathering-cooldown.spec.ts).
async function weaponRound(live: LiveGame, page: Page, info: TestInfo, hook: unknown) {
  await gatheringOff(live);
  // Availability is declared before native login (initialGatheringReady). Clearing a live cooldown
  // races status replies already in the browser, which keep known cooldowns; observe agreement.
  // The crafting rounds turned each mode off as its tool appeared, before any cast.
  let availability:any;
  await expect.poll(async()=>{
    const [state,client,server]=await Promise.all([live.state(),live.clients[name].frame.evaluate(()=>{
      const game=window as any,root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      return {now:Date.now(),next:Object.fromEntries(['fishing','mining'].map(mode=>[mode,Number(new Date(game.next_skill[mode]||0))])),
        recorded:{...root.__merchantGatheringCooldowns},session:!!root.__merchantGatheringSession,
        attempt:!!(root.__merchantHolder&&root.__merchantHolder.kind==='gathering')};
    }),live.admin(`output=(()=>{const p=get_player('${name}');return {fishing:p.last.fishing,mining:p.last.mining};})()`)]);
    availability={coordinator:state.gatheringCooldowns,client,server};
    return !client.session&&!client.attempt&&['fishing','mining'].every(mode=>
      Number(new Date(server[mode]))===0&&Number(client.next[mode])<=client.now&&
      Number(client.recorded[mode]||0)===0&&Number(state.gatheringCooldowns[mode]||0)===0);
  },{timeout:AVAILABILITY_MS,message:'Native gathering availability must agree before the first cast'}).toBe(true);
  await info.attach('native-gathering-initial-availability',{body:JSON.stringify(availability),contentType:'application/json'});
  // M25's twelve free cells (gathering skips casts at three or fewer), with the day's tools, stand
  // and potions moved out of them, full MP, and M11's Broom in the bag and staff in the hand. A tool
  // in the hand goes to the bag first.
  const seed=await live.admin(`output=(()=>{const p=get_player('${name}'),size=p.isize||p.items.length;
    const keep=['rod','pickaxe','stand0','hpot0','hpot1','mpot0','mpot1'];
    if(p.slots.mainhand&&['rod','pickaxe'].includes(p.slots.mainhand.name)){const slot=p.items.findIndex((v,i)=>!v&&i<size);p.items[slot]=p.slots.mainhand;p.slots.mainhand=null;}
    for(let i=size-12;i<size;i++){const item=p.items[i];p.items[i]=null;
      if(item&&keep.includes(item.name)){const slot=p.items.findIndex((v,j)=>!v&&j<size-12);if(slot<0)throw Error('No cell to keep '+item.name);p.items[slot]=item;}}
    const slot=p.items.findIndex((v,j)=>!v&&j<size-12);if(slot<0)throw Error('No cell for the Broom');
    p.items[slot]={name:'broom',level:6};
    p.slots.mainhand={name:'staff',level:0};p.slots.offhand=null;p.mp=p.max_mp;
    cache_player_items(p);p.cslots.mainhand=cache_item(p.slots.mainhand);resend(p,'reopen+cid');
    return {level:p.level,items:p.items,slots:p.slots,free:p.items.slice(0,size).filter(v=>!v).length};})()`);
  expect(seed.level, 'Fishing and Mining need level 16').toBeGreaterThanOrEqual(16);
  await expect.poll(async()=> (await live.state()).characters[name]?.items?.some((entry:any)=>entry?.item?.name==='broom'),{timeout:30_000}).toBe(true);
  // Seed the existing explicit normal-weapon preference through its public action.
  const old=await live.admin(`output=(()=>{const p=get_player('${name}'),slot=p.items.findIndex((v,i)=>!v&&i<(p.isize||p.items.length));p.items[slot]=p.slots.mainhand;p.slots.mainhand=null;cache_player_items(p);p.cslots.mainhand=null;resend(p,'reopen+cid');return {slot,item:p.items[slot]};})()`);
  await expect.poll(async()=> (await live.state()).characters[name]?.items?.some((entry:any)=>entry?.slot===old.slot&&entry.item.name==='staff'),{timeout:30_000}).toBe(true);
  await live.post('/command',{type:'merchant-weapon',character:name,slot:old.slot,item:old.item});
  // Every native equip the client sends, for the one-Broom assertion.
  await live.clients[name].frame.evaluate(()=>{
    const game=window as any,root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
    const observed:any=root.__e2eEquipRequests={list:[] as any[]};
    observed.listener=(event:string,data:any)=>{if(event==='equip')observed.list.push({at:Date.now(),commandId:root.__partyLastCommand,
      data:{...data},item:JSON.parse(JSON.stringify(root.character.items[data.num]||null))});};
    game.socket.onAnyOutgoing(observed.listener);
  });
  let after:any,ownedCast:any,equipRequests:any[]=[];
  const before = await stock(live);
  try {
  // Dashboard setup must not consume the native cast the Equip interrupts.
  await page.goto(live.url);
  const card=page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
  const inventory=card.getByRole('button',{name:/^Inventory/});
  if(await inventory.getAttribute('aria-expanded')!=='true')await inventory.click();
  await card.getByLabel('Broom',{exact:true}).click({button:'right'});
  await live.post('/merchant/gather',{mode:'fishing',enabled:true});
  await live.post('/merchant/gather',{mode:'mining',enabled:true});
  await expect.poll(async()=> (await live.state()).gatheringModes,{timeout:10_000}).toEqual(expect.arrayContaining(['fishing','mining']));
  await expect.poll(()=>live.admin(`output=['rod','pickaxe'].includes(get_player('${name}')?.slots.mainhand?.name)`),{timeout:CAST_WAIT_MS}).toBe(true);
  await expect.poll(async()=>{
    ownedCast=await live.clients[name].frame.evaluate(()=>{
      const game=window as any,root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      const holder=root.__merchantHolder;
      return holder&&holder.kind==='gathering'&&{id:holder.id,phase:holder.phase,cancelled:holder.cancelled,mode:holder.mode,at:Date.now(),channel:game.character.c?.[holder.mode]};
    });
    return !!ownedCast&&ownedCast.phase==='cast'&&!ownedCast.cancelled&&!!ownedCast.channel;
  },{timeout:CAST_WAIT_MS,intervals:[25,50],message:'Equip must interrupt an owned real native gathering cast'}).toBe(true);
  await info.attach('owned-native-gathering-cast',{body:JSON.stringify(ownedCast),contentType:'application/json'});
  const priorWeaponSequence=Math.max(0,...(await live.clients[name].events()).map(event=>event.sequence||0));
  const requestedAt=await live.clients[name].run('Date.now()');
  // The console holds the Equip until the owned cast's channel ends, so that cast rolls. Its roll is
  // declared a miss: the game's own roll hit in the step 14 rerun, which started the fishing
  // cooldown and left only mining's two declared rolls.
  await live.admin(`output=(()=>{globalThis.__e2eGather.outcomes={${JSON.stringify(ownedCast.mode)}:['miss']};return true;})()`);
  await page.getByRole('menuitem',{name:'Equip',exact:true}).click();
  let weaponReceipts:any[]=[];const commandObservations:any[]=[];
  try{
    await expect.poll(async()=>{commandObservations.push(await gatheringCommandSnapshot(live,name));weaponReceipts=(await live.clients[name].events()).filter((event:any)=>event.event==='player'&&event.at>=requestedAt&&event.sequence>priorWeaponSequence&&event.data?.slots?.mainhand).map((event:any)=>({sequence:event.sequence,at:event.at,mainhand:event.data.slots.mainhand}));return weaponReceipts.some(receipt=>receipt.mainhand.name==='broom'&&receipt.mainhand.level===6);},{timeout:30_000,message:'Native item packet must confirm the requested Broom equip'}).toBe(true);
  }finally{await info.attach('native-manual-weapon-equip-receipts',{body:JSON.stringify({requestedAt,priorWeaponSequence,receipts:weaponReceipts.slice(-32),commandObservations}),contentType:'application/json'});}
  // The interrupted channel's roll is past (the Broom receipt follows it), so the next rolls are
  // the resumed casts'. The log starts again here, so M25 counts only those.
  await live.admin(`output=(()=>{globalThis.__e2eGather.outcomes={fishing:['miss','miss','hit'],mining:['miss','hit']};globalThis.__e2eGather.log=[];return true;})()`);
  await expect.poll(async()=> (await live.state()).merchantWeapon?.item,{timeout:10_000}).toMatchObject({name:'broom',level:6});
  const broomSequence=weaponReceipts.find(receipt=>receipt.mainhand.name==='broom'&&receipt.mainhand.level===6).sequence;
  const resumedObservations:any[]=[];
  try {
    await expect.poll(async()=>{resumedObservations.push(await gatheringCommandSnapshot(live,name));return (await live.clients[name].events()).some((event:any)=>event.event==='player'&&event.sequence>broomSequence&&['rod','pickaxe'].includes(event.data?.slots?.mainhand?.name));},{timeout:CAST_WAIT_MS,message:'Native gathering tool equip must follow the actual Broom receipt'}).toBe(true);
  } finally {await info.attach('gathering-after-manual-equip',{body:JSON.stringify(resumedObservations),contentType:'application/json'});}

  // M25: every declared roll happens, misses first: a miss is followed by another real cast.
  await expect.poll(async () => (await rolls(live)).length, { timeout: 480_000, intervals: [2000],
    message: 'Both modes must recast after each miss until their declared hit' }).toBe(5);
  const log = await rolls(live);
  for (const mode of ['fishing', 'mining']) {
    const own = log.filter(entry => entry.mode === mode);
    expect(own.map(entry => entry.outcome), mode + ' rolls').toEqual(mode === 'fishing' ? ['miss', 'miss', 'hit'] : ['miss', 'hit']);
    // A miss starts no cooldown, so the next cast of that mode follows within a channel or two.
    for (let i = 1; i < own.length; i++)
      expect(own[i].at - own[i - 1].at, mode + ' recast after a miss').toBeLessThan(120_000);
  }
  // Each hit granted its catch.
  await expect.poll(() => stock(live), { timeout: 30_000 }).toBeGreaterThanOrEqual(before + 2);
  // After the hits, the recorded cooldowns are the game's.
  const server = await live.admin(`output=(()=>{const p=get_player('${name}');return {fishing:new Date(p.last.fishing).getTime(),mining:new Date(p.last.mining).getTime()};})()`);
  // The success cooldown is the game's G.skills[mode].reuse_cooldown, the value the merchant's
  // gathering reads (runtime/merchant-jobs/character/gathering.ts).
  const reuse = await live.admin(`output={fishing:G.skills.fishing.reuse_cooldown,mining:G.skills.mining.reuse_cooldown}`) as Record<'fishing' | 'mining', number>;
  await expect.poll(async () => {
    const recorded = (await live.state()).gatheringCooldowns;
    return (['fishing', 'mining'] as const).every(mode => Math.abs(recorded[mode] - (server[mode] + reuse[mode])) < 15_000);
  }, { timeout: 30_000, message: 'Recorded cooldowns follow the game after a success' }).toBe(true);
  await info.attach('gathering-cooldown-evidence', { body: JSON.stringify({ seed, hook, before, after: await stock(live), log: await rolls(live), server, reuse,
    activity: ((await live.state()).merchantActivity || []).filter((entry: any) => /fish|min|gather|caught|catch/i.test(entry.message || '')) }, null, 2), contentType: 'application/json' });

  // M11: gathering stops and the hand goes back to the Broom.
  await live.post('/merchant/gather',{mode:'fishing',enabled:false});
  await live.post('/merchant/gather',{mode:'mining',enabled:false});
  await expect.poll(()=>live.admin(`output=get_player('${name}')?.slots.mainhand`),{timeout:30_000}).toMatchObject({name:'broom',level:6});
  after=await live.state();expect(after.merchantWeapon.item).toMatchObject({name:'broom',level:6});
  } finally {
    // The observer leaves before the restart, so the restart exercises plain transport recovery.
    equipRequests=await live.clients[name].frame.evaluate(()=>{
      const game=window as any,root=(document.getElementById('maincode') as HTMLIFrameElement).contentWindow as any;
      const observed=root.__e2eEquipRequests;if(!observed)return [];game.socket.offAnyOutgoing(observed.listener);delete root.__e2eEquipRequests;return observed.list;
    });
    await info.attach('manual-equipment-handoff',{body:JSON.stringify({ownedCast,equipRequests,after}),contentType:'application/json'});
  }
  expect(equipRequests.filter((entry:any)=>entry.item?.name==='broom'&&entry.item.level===6&&entry.data.slot===undefined),'Manual Equip must issue exactly one native Broom request').toHaveLength(1);
}

// 5. The restart: M11's weapon preference and cargo, and M25's recorded cooldowns.
async function restartRound(live: LiveGame, page: Page, info: TestInfo) {
  const recorded = (await live.state()).gatheringCooldowns;
  await live.restartCoordinator();
  await expect.poll(async()=> (await live.state()).merchantWeapon?.item,{timeout:30_000}).toMatchObject({name:'broom',level:6});
  await expect.poll(async () => (await live.state()).gatheringCooldowns, { timeout: 30_000 }).toEqual(recorded);
  const cargo=await live.admin(`output=(()=>{const p=get_player('${name}');return {items:p.items,slots:p.slots}})()`);
  for(const item of ['staff','broom','rod','pickaxe'])expect([...cargo.items,...Object.values(cargo.slots)].filter((entry:any)=>entry?.name===item)).toHaveLength(1);
  expect(cargo.slots.mainhand).toMatchObject({name:'broom',level:6});
  await info.attach('manual-merchant-weapon-cycle',{body:JSON.stringify({recorded,cargo,events:await live.clients[name].events()}),contentType:'application/json'});
  await info.attach('manual-merchant-weapon-inventory',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
}
