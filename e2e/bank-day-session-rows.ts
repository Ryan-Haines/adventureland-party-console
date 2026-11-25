import type {Page, TestInfo} from '@playwright/test';
import {expect, type LiveGame} from './live-fixtures';
import {commerceRuleKey} from '../runtime/items/identity';
import {bankQuantity, economy, jobFinished, quantity, record, seed, type Economy} from './stand-session-rows';

// W51's one merchant bank and NPC sale day (test-windows DESIGN.md 2.2 W51), the bodies of
// live-elixir-restock.spec.ts, live-bank-collection.spec.ts, live-bank-npc-sales.spec.ts,
// live-economy.spec.ts's NPC sale and bank round trip, live-mailbox.spec.ts and
// live-npc-sale-keep.spec.ts (every old spec this file cites is at 21fe30a2b):
//  1. the merchant withdraws a stored Liquid Luck and drinks one (M08);
//  2. the bank popup's sort request swaps a merchant-luck pair and the merchant departs (A1);
//  3. it compresses five candy piles and the requested sort merges compatible silk (A6);
//  4. the bank popup's Auto sell to NPC marks two helmets with withdrawals off, turning withdrawals
//     on sells them (A3, A4), and five helmets sell past the collection threshold (A5);
//  5. a disabled sale rule holds across a restart, then sells (A10);
//  6. a full bag holds an automatic compound until eight NPC sales free cells (A8);
//  7. a legacy store caps the first withdrawal pass at ten helmets and keeps the stand rule's shoes (A11);
//  8. a partial NPC sale credits its gold (A51), and a marked deposit and a requested withdrawal
//     conserve one stack across restarts (A52);
//  9. the merchant mails beewings and collects them before deletion (M30, M31);
// 10. an automatic NPC sale keeps 450 across bag, bank and an offline BankBoi's 200 (M50, M51).
// Between rounds `nextRound` puts back the fixture's world for the next body: every merchant automation
// off, no automatic NPC sale rule, the default sort mode, the merchant out of the bank, and no planted
// item in its bag or bank.
const merchant = 'E2EMerchant';
// The items the rounds plant or produce. The bootstrap gives the merchant only hpot1 and mpot1
// (e2e/game/bootstrap.cjs:74), so none of these is the fixture's own.
const roundItems = ['elixirluck', 'helmet', 'shoes', 'candy0', 'spidersilk', 'coat', 'ringsj', 'leather', 'smoke', 'beewings'];
// The merchant's event ledger holds the whole boot, so the sale counts read the receipts after the
// round's start: the `at` of the last event before it, on the same page clock the events carry.
let salesFrom = 0;

export async function bankDaySessionPlay(live: LiveGame, info: TestInfo, page: Page) {
  // M08's bank wait reads `!!bank.packs`, which waits for a visit only while the coordinator has
  // seen no bank, so it comes first.
  await merchantElixirRound(live, info);
  await nextRound(live);
  await bankSortRound(live, page, info);
  await nextRound(live);
  await candySilkRound(live, info);
  await nextRound(live);
  // The toggle case serves A4: its queue shows the auto npc withdrawals job, then the withdrawals
  // job A4's already-enabled case reads.
  await bankCollectionRound(live, page, info, 'toggle');
  await nextRound(live);
  await bankCollectionRound(live, page, info, 'threshold');
  await nextRound(live);
  await disabledSaleRound(live, info);
  await nextRound(live);
  await fullBagCompoundRound(live, info);
  await nextRound(live);
  await tenStackRound(live, info);
  await nextRound(live);
  await partialSaleRound(live, info);
  await nextRound(live);
  await bankRoundTripRound(live, info);
  await nextRound(live);
  await mailboxRound(live, info, false);
  await nextRound(live);
  // M51's offline BankBoi stays declared in an error state (its own restore), so it runs last and
  // no later round meets that worker. Its stored 200 serves M50's bag and bank case too.
  await npcSaleKeepRound(live, page, info, 200);
}

// The rules a round saved stay inert with every automation off: A6's candy0 exchange, A8's ringsj
// compound, A11's shoes stand price and M08's restock policy name stock no later round plants. The
// automatic NPC sale rules go, since A3, A5 and M51 open the rule menu that reads "Update" while one
// exists, and A10 and A11 plant sellable helmets with the sale routine off.
async function nextRound(live: LiveGame) {
  const automations = (await live.state()).merchantAutomations || {};
  await live.post('/merchant/routine-priorities', {priorities: {}, enabled: Object.fromEntries(Object.keys(automations).map(key => [key, false]))});
  await live.post('/merchant/auto-npc-sale', {action: 'clear-all'});
  // A1 and A6 set the request mode; the later bodies ran on the default, which sorts every visit
  // (storage.ts `state.bankSortMode || 'automatic'`).
  await live.post('/merchant/bank-sort', {mode: 'automatic'});
  await jobFinished(live);
  // A mounted bank saves over the account document when it unmounts, so the db plants of the next
  // body need the merchant outside it.
  if (await live.admin(`output=!!get_player('${merchant}').user`)) {
    await live.post('/command', {character: merchant, type: 'character-travel', location: {map: 'main', x: 0, y: 0}});
    await expect.poll(async () => live.admin(`output=!get_player('${merchant}').user`),
      {timeout: 90_000, message: 'The merchant leaves the bank before the next round'}).toBe(true);
  }
  // The boot's potions go back to cells 0 and 1: an earlier round left hpot1 in cell 20, which M51's
  // seed needs empty (liveb-step11-run3.log).
  const bank = await live.admin(`output=(async()=>{const p=get_player('${merchant}'),names=${JSON.stringify(roundItems)};
    p.items=p.items.map(i=>i&&names.includes(i.name)?null:i);
    const pots=['hpot1','mpot1'].map(name=>p.items.find(i=>i?.name===name));
    p.items=p.items.map(i=>pots.includes(i)?null:i);pots.forEach((pot,slot)=>{if(pot)p.items[slot]=pot;});
    cache_player_items(p);resend(p,'reopen+cid');
    const u=await db.collection('user').findOne({_id:p.owner}),set={};
    for(const [k,v] of Object.entries(u.info))if(/^items\\d+$/.test(k)&&Array.isArray(v))set['info.'+k]=v.map(i=>i&&names.includes(i.name)?null:i);
    if(Object.keys(set).length)await db.collection('user').updateOne({_id:u._id},{$set:set});
    return {gold:u.info.gold||0,packs:Object.fromEntries(Object.keys(set).map(k=>[k.slice(5),set[k].map((item,slot)=>item?{slot,item}:null)]))};})()`);
  // The coordinator's bank view keeps the last visit, so a later body's first bank poll would pass
  // on this round's cells (liveb-step11-run4.log: A10's helmet poll passed before its visit). The
  // cleaned bank goes to the view as the merchant's own checkpoint does (items/character/bank.ts).
  await live.post('/bankboi/checkpoint', {character: merchant, bank});
  await expect.poll(async () => {
    const s = await live.state();
    return [...(s.characters[merchant]?.items || []), ...Object.values(s.bank?.packs || {}).flat()].some((entry: any) => roundItems.includes(entry?.item?.name));
  }, {timeout: 30_000, message: "The round's items leave the merchant's bag and the bank view"}).toBe(false);
  salesFrom = (await live.clients[merchant].events()).at(-1)?.at ?? 0;
}

async function restartAndObserve(live: LiveGame) {
  const startedAt = Date.now();
  await live.restartCoordinator();
  await expect.poll(async () => (await live.state()).characters[merchant]?.seenAt,
    { timeout: 30_000, message: 'Replay assertions require a native heartbeat accepted after restart' }).toBeGreaterThan(startedAt);
  await jobFinished(live);
}

// A51's and A52's totals read an economy sample; A10's and A11's read the merchant's carried and
// bank gold from the game server.
function totalGold(state: Economy): number;
function totalGold(live: LiveGame, merchant: string): Promise<number>;
function totalGold(source: Economy | LiveGame, merchant?: string): number | Promise<number> {
  if (merchant === undefined) {
    const state = source as Economy;
    return state.bankGold + Object.values(state.characters).reduce((total, character) => total + character.gold, 0);
  }
  return (source as LiveGame).admin(`output=(async()=>{const p=get_player('${merchant}'),user=await db.collection('user').findOne({_id:p.owner});return p.gold+((p.user||user.info).gold||0)})()`);
}

// M08 (live-elixir-restock.spec.ts 'merchant restocks and consumes its own native elixir').
const target = 'E2EWarrior';
export const policy=(item:string,autoAcquire:boolean,autoConsume=true,max=2)=>({character:target,hp:{min:0,max:0},mp:{min:0,max:0},elixir:{item,min:max===1?0:1,max,autoConsume,autoAcquire}});

export async function merchantElixirRound(live: LiveGame, info: TestInfo) {
  try {
    await live.admin(`output=(async()=>{const m=get_player('${merchant}');if(m.slots.elixir)throw Error('Expected no active elixir');await db.collection('user').updateOne({_id:m.owner},{$set:{'info.items0.20':{name:'elixirluck',q:2}}});return true;})()`);
    await live.clients[merchant].run(`(()=>{globalThis.__elixirUses=[];parent.socket.on('game_response',data=>{if(data?.response==='elixir')globalThis.__elixirUses.push({at:Date.now(),data})});return true})()`);
    await live.post('/command',{character:merchant,type:'bank'});
    await expect.poll(async()=>!!(await live.state()).bank?.packs,{timeout:90000}).toBe(true);
    await expect.poll(async()=>(await live.state()).merchantCurrent,{timeout:90000}).toBeNull();
    await live.post('/restock',{...policy('elixirluck',false),character:merchant});
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{restock:true}});
    await expect.poll(async()=>await live.admin(`output=get_player('${merchant}').slots.elixir?.name||null`),{timeout:90000}).toBe('elixirluck');
    await expect.poll(async()=>{const s=await live.state();return {job:s.merchantCurrent,item:s.characters[merchant]?.slots?.elixir?.item?.name,quantity:s.characters[merchant]?.items?.filter((entry:any)=>entry?.item?.name==='elixirluck').reduce((n:number,entry:any)=>n+(entry.item.q||1),0)};},{timeout:30000}).toEqual({job:null,item:'elixirluck',quantity:1});
    expect(await live.clients[merchant].run('globalThis.__elixirUses')).toHaveLength(1);
  } finally {
    await info.attach('merchant-self-elixir-evidence',{body:JSON.stringify({state:await live.state(),native:await live.clients[merchant].snapshot(),uses:await live.clients[merchant].run('globalThis.__elixirUses||[]')}),contentType:'application/json'});
  }
}

// A1 and A2 (live-bank-collection.spec.ts 'bank popup sort completes ... and permits departure').
// W51 plays A1's native case; A2's legacy recovery is a unit row
// (scripts/tests/live-moves-merchant-state.test.cjs).
export async function bankSortRound(live: LiveGame, page: Page, info: TestInfo) {
  const merchant='E2EMerchant';
  await live.post('/merchant/bank-sort',{mode:'request'});
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':[{name:'shoes',level:2,m:'E2EWarrior',l:'l'},{name:'helmet',level:1}]}});return true})()`);
  await page.goto(live.url);
  await page.getByRole('button',{name:'Bank',exact:true}).click();
  const bank=page.getByRole('dialog',{name:'Bank',exact:true});
  await bank.getByRole('button',{name:'Sort on next visit · Off',exact:true}).click();
  await expect.poll(async()=>(await live.state()).bankSortRequest?.status).toBe('queued');
  await live.post('/command',{character:merchant,type:'bank'});
  await expect.poll(async()=>{
    const state=await live.state();
    return state.bankSortRequest===null&&state.bank?.packs?.items0?.[0]?.item?.name==='helmet'&&
      state.bank?.packs?.items0?.[1]?.item?.name==='shoes';
  },{timeout:180_000}).toBe(true);
  await expect.poll(async()=>{
    const client=await live.clients[merchant].snapshot();
    return client.map==='main'&&!client.items.some((item:any)=>item?.name==='shoes');
  },{timeout:90_000}).toBe(true);
  const native=await live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=await db.collection('user').findOne({_id:p.owner});return {items:u.info.items0.filter(Boolean),inventory:p.items}})()`);
  expect(native.items).toHaveLength(2);
  expect(native.items[0]).toMatchObject({name:'helmet',level:1});
  expect(native.items[1]).toMatchObject({name:'shoes',level:2,l:'l'});
  expect(native.items[1].m).toBeUndefined();
  await info.attach('native-bank-sort-conservation',{body:JSON.stringify({native,state:await live.state(),client:await live.clients[merchant].snapshot(),journal:await live.clients[merchant].run(`localStorage.getItem('party-bank-sort-buffer:${merchant}')`)}),contentType:'application/json'});
  await info.attach('bank-popup-sort-completed',{body:await page.screenshot(),contentType:'image/png'});
}

// A6 (live-bank-collection.spec.ts 'merchant compresses five candy piles and bank sort
// consolidates compatible silk').
// Failure modes: idle-only admission starves behind collection; the first
// over-limit pair hides small piles; partial fills lose stock; bank sorting
// swaps incompatible properties or leaves compatible piles split.
export async function candySilkRound(live: LiveGame, info: TestInfo) {
  const merchant='E2EMerchant';
  const observations:any[]=[];
  try {
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'automatic exchange':true}});
  await live.post('/merchant/bank-sort',{mode:'request',enabled:true});
  await expect.poll(async()=>(await live.state(true)).merchantCatalog?.exchangeable?.some((e:any)=>e.id==='candy0'),{timeout:60_000}).toBe(true);
  await live.post('/command',{character:merchant,type:'auto-exchange',slot:-1,item:{name:'candy0',level:0}});
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');
    [6450,31,9999,4083,15].forEach((q,i)=>{p.items[20+i]={name:'candy0',q};});
    p.items[25]={name:'spidersilk',q:5,p:'cavefound'};
    await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':[{name:'spidersilk',q:39},{name:'spidersilk',q:26,p:'cavefound'},{name:'spidersilk',q:7,p:'shiny'}]}});
    cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await expect.poll(async()=>{
    const c=await live.clients[merchant].snapshot(),quantities=c.items.filter((i:any)=>i?.name==='candy0').map((i:any)=>i.q).sort((a:number,b:number)=>b-a);
    observations.push({at:Date.now(),quantities});if(observations.length>160)observations.shift();return quantities;
  },{timeout:90_000}).toEqual([9999,9999,580]);
  await expect.poll(async()=>(await live.state()).merchantQueue.some((job:any)=>job.reason==='exchange')).toBe(true);
  const exchange=(await live.state()).merchantQueue.find((job:any)=>job.reason==='exchange');
  await live.post('/merchant/job/cancel',{id:exchange.id});
  await live.post('/merchant/force-stand',{enabled:false});
  await live.post('/command',{character:merchant,type:'mark',slot:25,item:{name:'spidersilk',q:5,p:'cavefound'}});
  await live.post('/command',{character:merchant,type:'bank'});
  await expect.poll(async()=>{
    const s=await live.state();return s.bankSortRequest===null&&s.bank?.packs?.items0?.filter((e:any)=>e?.item?.name==='spidersilk').map((e:any)=>e.item).sort((a:any,b:any)=>(b.q||1)-(a.q||1));
  },{timeout:180_000}).toEqual([{name:'spidersilk',q:70},{name:'spidersilk',q:7,p:'shiny'}]);
  await expect.poll(async()=>{const c=await live.clients[merchant].snapshot();return c.map==='main'&&!c.items.some((i:any)=>i?.name==='spidersilk');},{timeout:60_000}).toBe(true);
  await expect.poll(async()=>live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=await db.collection('user').findOne({_id:p.owner});return u.info.items0.filter(i=>i?.name==='spidersilk').sort((a,b)=>b.q-a.q);})()`)).toEqual([{name:'spidersilk',q:70},{name:'spidersilk',q:7,p:'shiny'}]);
  } finally {
    await info.attach('native-stack-compression',{body:JSON.stringify({observations,state:await live.state(),client:await live.clients[merchant].snapshot(),events:await live.clients[merchant].events()}),contentType:'application/json'});
  }
}

// A3, A4 and A5 (live-bank-collection.spec.ts 'bank automatic NPC collection runs with ...').
// Failure modes: auto rules never materialize withdrawals; toggling always-on
// loses existing marks; always-off suppresses threshold trips; duplicate visits
// or locked-stock sales. Native bank moves and NPC receipts prove completion.
export async function bankCollectionRound(live: LiveGame, page: Page, info: TestInfo, scenario: 'toggle'|'already enabled'|'threshold') {
    const merchant='E2EMerchant',count=scenario==='threshold'?5:2;
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{withdrawals:scenario==='already enabled','auto npc sales':false,'party collection':true}});
    await live.post('/config',{itemCollectionThreshold:4});
    await live.admin(`output=(async()=>{const p=get_player('${merchant}'),patch=Object.fromEntries(Array.from({length:${count}},(_,i)=>['info.items0.'+i,{name:'helmet',level:0}]));patch['info.items0.${count}']={name:'helmet',level:0,l:'l'};await db.collection('user').updateOne({_id:p.owner},{$set:patch});return true})()`);
    await live.post('/command',{character:merchant,type:'bank'});
    await expect.poll(async()=>(await live.state()).bank?.packs?.items0?.[count]?.item?.l,{timeout:90_000}).toBe('l');
    await expect.poll(async()=>(await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
    await live.post('/merchant/force-stand',{enabled:true});
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':true}});
    await page.goto(live.url);
    await expect(page.getByRole('heading',{name:merchant,exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Bank',exact:true}).click();
    const bank=page.getByRole('dialog',{name:'Bank',exact:true});
    await bank.getByLabel('Helmet',{exact:true}).first().click({button:'right'});
    await page.getByRole('menuitem',{name:'Auto sell to NPC…',exact:true}).click();
    const confirm=page.getByRole('dialog',{name:'Automatically sell to NPC?',exact:true});
    await confirm.getByRole('button',{name:'Enable auto sale',exact:true}).click();
    await expect.poll(async()=>(await live.state()).withdrawals?.[merchant]?.length).toBe(count);
    const pending=await live.state();
    if(scenario==='toggle'){
      expect(pending.merchantQueue.some((job:any)=>job.reason==='auto npc withdrawals')).toBe(true);
      await live.post('/merchant/routine-priorities',{priorities:{},enabled:{withdrawals:true}});
    }
    await expect.poll(async()=>(await live.state()).merchantQueue.some((job:any)=>job.reason===(scenario==='threshold'?'auto npc withdrawals':'withdrawals'))).toBe(true);
    await info.attach('bank-marked-collection-queued',{body:JSON.stringify({scenario,pending,state:await live.state()}),contentType:'application/json'});
    await page.keyboard.press('Escape');
    await live.post('/merchant/force-stand',{enabled:false});
    await expect.poll(async()=>(await live.clients[merchant].events()).filter(entry=>entry.event==='game_response'&&entry.data?.place==='sell'&&entry.data.success===true&&entry.data.item?.name==='helmet'&&entry.at>salesFrom).length,{timeout:180_000}).toBe(count);
    const after=await live.state();
    expect(Object.values(after.bank.packs).flat().filter((entry:any)=>entry?.item?.name==='helmet'&&entry.item.l==='l')).toHaveLength(1);
    await info.attach('bank-marked-collection-native',{body:JSON.stringify({after,events:await live.clients[merchant].events()}),contentType:'application/json'});
    await info.attach('bank-marked-collection-dashboard',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
}

// A8, A10 and A11 (live-bank-npc-sales.spec.ts).
function bankItems(state:any):any[] {
  return Object.values(state.bank?.packs||{}).flatMap((pack:any)=>pack.map((entry:any)=>entry?.item).filter(Boolean));
}
function unlockedHelmets(state:any):any[] {
  return bankItems(state).filter(item=>item.name==='helmet'&&!item.l);
}
async function helmetSaleReceipts(live:LiveGame,merchant:string) {
  return (await live.clients[merchant].events()).filter(entry=>entry.event==='game_response'&&
    entry.data?.place==='sell'&&entry.data.success===true&&entry.data.item?.name==='helmet'&&entry.at>salesFrom);
}

// A8 'full merchant defers external compounds until native NPC sales free capacity'.
export async function fullBagCompoundRound(live: LiveGame, info: TestInfo) {
  const merchant='E2EMerchant';
  try {
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto compound':false,'auto npc sales':false}});
    // One native triple suffices to prove capacity admission and a real
    // compound attempt; extra triples add unrelated bank sorting work.
    await live.admin(`output=(async()=>{const p=get_player('${merchant}');const patch=Object.fromEntries(Array.from({length:3},(_,i)=>['info.items0.'+i,{name:'ringsj',level:0}]));await db.collection('user').updateOne({_id:p.owner},{$set:patch});return true})()`);
    await live.post('/command',{character:merchant,type:'bank'});
    await expect.poll(async()=>(await live.state()).bank?.packs?.items0?.[2]?.item?.name,{timeout:90_000}).toBe('ringsj');
    await expect.poll(async()=>(await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
    // Initial inventory declaration only fills empty native slots; no existing
    // items are removed and subsequent capacity changes require real sales.
    // Eight sellable fillers provide sufficient withdrawal/scroll capacity;
    // remaining fillers are natively locked, avoiding an unrelated forty-sale
    // workload before the serialized compound job can run on slower clients.
    await live.admin(`output=(()=>{const p=get_player('${merchant}');let fillers=0;for(let i=0;i<p.items.length;i++)if(!p.items[i])p.items[i]={name:'helmet',level:0,...(fillers++<8?{}:{l:'l'})};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
    await expect.poll(async()=>(await live.clients[merchant].snapshot()).items.filter((i:any)=>!i).length).toBe(0);
    await live.clients[merchant].run(`(()=>{globalThis.__capacityCompoundReceipts=[];parent.socket.on('game_response',data=>{const response=typeof data==='string'?data:data?.response;if(response==='compound_success'||response==='compound_fail')globalThis.__capacityCompoundReceipts.push({at:Date.now(),response,data})});return true})()`);
    await live.restoreHistoricalSettings(()=>({autoCompounds:{[merchant]:[{name:'ringsj',targetTier:1,quantity:1}]}}));
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto compound':true,'auto npc sales':false}});
    const blockedAt=Date.now();
    await expect.poll(async()=>(await live.clients[merchant].snapshot()).statusAt,{timeout:30_000}).toBeGreaterThan(blockedAt+15_000);
    const blocked=await live.state();
    expect(blocked.merchantCurrent?.reason).not.toBe('auto compound');
    expect(blocked.merchantQueue.some((job:any)=>job.reason==='auto compound')).toBe(false);
    expect(blocked.withdrawals?.[merchant]?.length||0).toBe(0);
    await info.attach('full-bag-compound-admission',{body:JSON.stringify(blocked),contentType:'application/json'});
    await live.post('/merchant/auto-npc-sale',{item:{name:'helmet',level:0}});
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto compound':true,'auto npc sales':true}});
    await expect.poll(async()=>{
      const sales=await helmetSaleReceipts(live,merchant),client=await live.clients[merchant].snapshot();
      return sales.length===8&&sales.every(entry=>Number(entry.data.gold)>0)&&client.items.filter((item:any)=>!item).length>3;
    },{timeout:150_000,message:'Eight genuine NPC sales must free native withdrawal capacity'}).toBe(true);
    await info.attach('compound-capacity-native-cleanout',{body:JSON.stringify({sales:await helmetSaleReceipts(live,merchant),client:await live.clients[merchant].snapshot(),state:await live.state()}),contentType:'application/json'});
    await expect.poll(async()=>{
      const receipts=await live.clients[merchant].run('globalThis.__capacityCompoundReceipts');
      return (await helmetSaleReceipts(live,merchant)).length>3&&receipts.length>0;
    },{timeout:150_000,message:'Freed capacity must permit actual native compound processing'}).toBe(true);
  } finally {
    await info.attach('compound-capacity-native-evidence',{body:JSON.stringify({state:await live.state(),client:await live.clients[merchant].snapshot(),events:await live.clients[merchant].events(),compoundReceipts:await live.clients[merchant].run('globalThis.__capacityCompoundReceipts||[]')}),contentType:'application/json'});
  }
}

// A10 'bank NPC sale rule withdraws native stock and respects disabled sales across restart'.
export async function disabledSaleRound(live: LiveGame, info: TestInfo) {
  const merchant = 'E2EMerchant';
  await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'auto npc sales': false, withdrawals: false, 'party collection': false } });
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0.0':{name:'helmet',level:0},'info.items0.1':{name:'helmet',level:0,l:'l'}}});return true})()`);
  await live.post('/command', { character: merchant, type: 'bank' });
  await expect.poll(async () => (await live.state()).bank?.packs?.items0?.[0]?.item?.name, {timeout:90_000}).toBe('helmet');
  await live.post('/merchant/auto-npc-sale', { item: {name:'helmet',level:0} });
  await live.restartCoordinator();
  const before = await live.state();
  const goldBefore = await totalGold(live,merchant);
  const observedAt = Date.now();
  await expect.poll(async () => (await live.clients[merchant].snapshot()).statusAt).toBeGreaterThan(observedAt + 2000);
  expect(unlockedHelmets(await live.state())).toHaveLength(1);
  await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'auto npc sales': true } });
  await expect.poll(async () => unlockedHelmets(await live.state()).length, {timeout:150_000}).toBe(0);
  await expect.poll(async () => (await live.clients[merchant].snapshot()).items.some((item:any) => item?.name==='helmet' && !item.l), {timeout:90_000}).toBe(false);
  const after = await live.state();
  expect(bankItems(after).filter(item=>item.name==='helmet'&&item.l==='l')).toHaveLength(1);
  expect(await helmetSaleReceipts(live,merchant)).toHaveLength(1);
  expect(await totalGold(live,merchant)).toBeGreaterThan(goldBefore);
  await info.attach('bank-npc-native-evidence', {body:JSON.stringify({before,after,client:await live.clients[merchant].snapshot(),events:await live.clients[merchant].events()}),contentType:'application/json'});
}

// A11 'bank NPC selection caps ten stacks and excludes persisted NPC stand conflicts'.
export async function tenStackRound(live: LiveGame, info: TestInfo) {
  const merchant='E2EMerchant';
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':false,withdrawals:true}});
  const seeded=await live.admin(`output=(async()=>{const p=get_player('${merchant}'),items=Array.from({length:12},()=>({name:'helmet',level:0}));items.push({name:'helmet',level:0,l:'l'},{name:'shoes',level:0});const patch=Object.fromEntries(items.map((item,i)=>['info.items0.'+i,item]));await db.collection('user').updateOne({_id:p.owner},{$set:patch});return items})()`);
  await live.post('/command',{character:merchant,type:'bank'});
  await expect.poll(async () => (await live.state()).bank?.packs.items0?.[13]?.item.name,{timeout:90_000}).toBe('shoes');
  await expect.poll(async () => (await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
  await live.post('/merchant/force-stand',{enabled:true});
  // The marking stops when each marked stack has a free bag cell past the lucky hold and the
  // protected free slots, so 13 empty cells, 3 protected and no lucky slot cap the first pass at ten.
  // The server pads a short bag with `items.length = 42` (server_functions.js:4577), so its empty
  // cells are holes that filter() skips; the plant counts them by index.
  const planted=await live.admin(`output=(()=>{const p=get_player('${merchant}');
    const empty=()=>{let n=0;for(let i=0;i<p.isize;i++)if(!p.items[i])n++;return n;};let fill=empty()-13;const asked=fill;
    for(let i=0;i<p.isize&&fill>0;i++)if(!p.items[i]){p.items[i]={name:'coat',level:0,l:'l'};fill--;}cache_player_items(p);resend(p,'reopen+cid');
    return {asked,isize:p.isize,length:p.items.length,map:p.map,empty:empty()};})()`);
  try{await expect.poll(async()=>(await live.clients[merchant].snapshot()).items.filter((i:any)=>!i).length).toBe(13);}
  finally{
    const server=await live.admin(`output=(p=>p&&{map:p.map,items:p.items.map(i=>i&&i.name)})(get_player('${merchant}'))`).catch(error=>String(error));
    const client=await live.clients[merchant].snapshot().then((c:any)=>({map:c.map,items:c.items.map((i:any)=>i&&i.name)})).catch(error=>String(error));
    const state=await live.state();
    await info.attach('bank-npc-coat-plant',{body:JSON.stringify({planted,server,client,current:state.merchantCurrent,activity:state.merchantActivity?.slice(-12)}),contentType:'application/json'});
  }
  // Historical rule conflict is input, not fabricated sale success. The normal
  // editor correctly retires competing rules, so restore a legacy mixed store. The stand rule has
  // the shape the console saves (market.ts auto-stand route: item, price, createdAt). The old
  // body's price-only rule crashed the merchant card's Auto stand marks list on `rule.item.name`
  // when M51 opened the card (liveb-step11-run5.log).
  await live.restoreHistoricalSettings(() => ({
    protectedFreeSlots:3,luckyUpgradeSlots:{},luckySlotResume:{},luckySlotLocks:{},
    autoNpcSales:{[commerceRuleKey({name:'helmet',level:0})]:{item:{name:'helmet',level:0},createdAt:Date.now()},[commerceRuleKey({name:'shoes',level:0})]:{item:{name:'shoes',level:0},createdAt:Date.now()}},
    autoStandMarks:{[commerceRuleKey({name:'shoes',level:0})]:{item:{name:'shoes',level:0},price:1000,createdAt:Date.now()}},
  }));
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':true}});
  await expect.poll(async () => (await live.state()).withdrawals[merchant]?.length).toBe(10);
  const first=await live.state();
  expect(first.withdrawals[merchant].every((entry:any)=>entry.item.name==='helmet' && !entry.item.l && !entry.standListingId)).toBe(true);
  const goldBefore=await totalGold(live,merchant);
  await info.attach('bank-first-ten-selected',{body:JSON.stringify({seeded,first}),contentType:'application/json'});
  await live.post('/merchant/force-stand',{enabled:false});
  await expect.poll(async () => {
    const state=await live.state();
    return unlockedHelmets(state).length===0 &&
      !state.characters[merchant].items.some((entry:any)=>entry?.item?.name==='helmet'&&!entry.item.l) &&
      (await helmetSaleReceipts(live,merchant)).length===12;
  },{timeout:240_000}).toBe(true);
  const after=await live.state();
  expect(bankItems(after).filter(item=>item.name==='helmet'&&item.l==='l')).toHaveLength(1);
  expect(bankItems(after).filter(item=>item.name==='shoes')).toHaveLength(1);
  expect(await helmetSaleReceipts(live,merchant)).toHaveLength(12);
  expect(await totalGold(live,merchant)).toBeGreaterThan(goldBefore);
  await live.restartCoordinator();
  const restored=await live.state();
  expect(bankItems(restored).filter(item=>item.name==='shoes')).toHaveLength(1);
  await info.attach('bank-ten-stack-conflict-native-result',{body:JSON.stringify({after,restored,events:await live.clients[merchant].events()}),contentType:'application/json'});
}

// A51 (live-economy.spec.ts 'NPC partial sale credits actual gold and preserves the unsold stack
// after restart').
export async function partialSaleRound(live: LiveGame, info: TestInfo) {
    await seed(live, { 10: { name: 'leather', q: 10 } });
    const before = await economy(live);
    const value = await live.admin("output=calculate_item_value({name:'leather',q:10})");
    const accepted = await live.post('/merchant/npc-sale', { source: 'merchant', slot: 10, item: { name: 'leather' }, quantity: 7 });
    await expect.poll(async () => quantity((await economy(live)).characters[merchant].items, 'leather'),
      { timeout: 150_000 }).toBe(3);
    await jobFinished(live);
    expect(totalGold(await economy(live))).toBe(totalGold(before) + 7 * value);
    await expect.poll(async () => (await live.state()).npcSaleMarks?.some((mark: { id: string }) => mark.id === accepted.mark.id)).toBe(false);
    await restartAndObserve(live);
    expect(quantity((await economy(live)).characters[merchant].items, 'leather')).toBe(3);
    expect(totalGold(await economy(live))).toBe(totalGold(before) + 7 * value);
    await record(live, info, 'partial-npc-sale', before, { unitValue: value, accepted });
}

async function leaveBank(live: LiveGame) {
  await live.post('/command', { character: merchant, type: 'character-travel', location: { map: 'main', x: 0, y: 0 } });
  await expect.poll(async () => (await economy(live)).characters[merchant].map,
    { timeout: 90_000, message: 'Native exit must unmount and save the shared bank' }).toBe('main');
}

// A52 (live-economy.spec.ts 'marked bank deposit and requested withdrawal conserve a real stack
// across restart').
export async function bankRoundTripRound(live: LiveGame, info: TestInfo) {
    // Withdrawal marks must recall the merchant without a separate bank command,
    // consume only confirmed stock, and never replay after restart.
    await seed(live, { 10: { name: 'leather', q: 13 } });
    const before = await economy(live);
    const total = quantity(before.characters[merchant].items, 'leather') + bankQuantity(before, 'leather');
    await live.post('/command', { character: merchant, type: 'mark', slot: 10, item: { name: 'leather', q: 13 } });
    await live.post('/command', { character: merchant, type: 'bank' });
    await expect.poll(async () => {
      const state = await economy(live);
      return quantity(state.characters[merchant].items, 'leather') === 0 && bankQuantity(state, 'leather') === total;
    }, { timeout: 150_000 }).toBe(true);
    await jobFinished(live);
    await leaveBank(live);
    await expect.poll(async () => Object.values((await economy(live)).savedBank).reduce((sum, items) => sum + quantity(items, 'leather'), 0),
      { timeout: 60_000, message: 'The actual bank unmount must persist the deposited stack' }).toBe(total);
    await record(live, info, 'bank-deposit-persisted', before);
    await restartAndObserve(live);
    const bank = await economy(live);
    const [pack, contents] = Object.entries(bank.bank).find(([, items]) => quantity(items, 'leather') > 0)!;
    const slot = contents.findIndex(item => item?.name === 'leather');
    expect(slot).toBeGreaterThanOrEqual(0);
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { withdrawals: false } });
    await live.post('/command', { character: merchant, type: 'withdraw', pack, slot, item: contents[slot] });
    await live.restartCoordinator();
    const disabledAt = Date.now();
    await expect.poll(async () => (await live.clients[merchant].snapshot()).statusAt,
      {timeout:30_000,message:'Observe repeated native scheduling while withdrawals are disabled'}).toBeGreaterThan(disabledAt + 5000);
    const deferred = await live.state();
    expect(deferred.merchantAutomations.withdrawals).toBe(false);
    expect(deferred.withdrawals[merchant]).toHaveLength(1);
    expect([deferred.merchantCurrent, ...deferred.merchantQueue].filter(Boolean).some(job => job.reason === 'withdrawals')).toBe(false);
    expect(bankQuantity(await economy(live), 'leather')).toBe(total);
    await record(live, info, 'marked-withdrawal-disabled', before, {pack,slot});
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { withdrawals: true } });
    await expect.poll(async () => {
      const state = await economy(live);
      return quantity(state.characters[merchant].items, 'leather') === total && bankQuantity(state, 'leather') === 0;
    }, { timeout: 150_000 }).toBe(true);
    await jobFinished(live);
    await leaveBank(live);
    await restartAndObserve(live);
    const after = await economy(live);
    expect(quantity(after.characters[merchant].items, 'leather') + bankQuantity(after, 'leather')).toBe(total);
    expect(quantity(after.characters[merchant].items, 'leather')).toBe(total);
    expect(totalGold(after)).toBe(totalGold(before));
    await record(live, info, 'bank-round-trip', before, { pack, slot, total });
}

// M30 and M31 (live-mailbox.spec.ts). Failure inventory: docs/testing-mailbox-enhancements.md.
// Only the initial merchant inventory is declared; sending, pickup, native taken and deletion are
// real. W51 plays M30's case, deletion enabled after the collection.
export async function mailboxRound(live: LiveGame, info: TestInfo, deleteDuringCollection: boolean) {
  const merchant='E2EMerchant',subject='ChronAL mailbox attachment proof '+info.testId,observations:any[]=[];
  // Native deletion removes account ownership, retaining the underlying mail
  // record. Check this account's inbox, scoped to this scenario's exact subject.
  const read=async()=>live.admin(`output=(async()=>{const p=get_player('E2EMerchant'),mail=await db.collection('mail').find({owner:p.owner,'info.subject':${JSON.stringify(subject)}}).toArray();
    return {items:p.items.filter(i=>i&&i.name==='beewings').reduce((n,i)=>n+(i.q||1),0),mail:mail.map(m=>({id:m._id,taken:m.taken,item:m.info.item,to:m.to}))};})()`);
  try{
    await expect.poll(async()=>!!(await live.state(true)).merchantCatalog?.allItems?.find((i:any)=>i.id==='beewings'),{timeout:90000}).toBe(true);
    const seed=await live.admin(`output=(()=>{const p=get_player('E2EMerchant');if(p.items[20]||p.items.some(i=>i&&i.name==='beewings'))throw Error('Requires empty mail source slot and no duplicate beewings');p.items[20]={name:'beewings',q:2};cache_player_items(p);resend(p,'reopen+cid');return {name:p.name,slot:20,item:p.items[20]};})()`);
    await info.attach('declared-native-mail-attachment',{body:JSON.stringify(seed),contentType:'application/json'});
    await expect.poll(async()=>(await live.state()).characters[merchant]?.items?.find((e:any)=>e?.slot===20)?.item?.q,{timeout:30000}).toBe(2);
    const order=await live.post('/merchant/send-mail',{recipient:'E2EWarrior',subject,message:'Native attachment round trip',quantity:2,source:{pack:'merchant',slot:20,item:{name:'beewings',q:2}}});
    await expect.poll(async()=>{const box=await live.post('/mail/refresh',{}),native=await read();observations.push({at:Date.now(),box,native});return {sent:box.outbox?.filter((m:any)=>m.id===order.jobId).length,carried:native.items,messages:box.messages.filter((m:any)=>m.subject===subject).length};},{timeout:120000}).toEqual({sent:1,carried:0,messages:1});
    const before=await live.post('/mail/refresh',{}),mail=before.messages.find((m:any)=>m.subject===subject);expect(mail.taken).toBe(false);expect(before.newCount).toBeGreaterThan(0);
    await live.post('/mail/seen',{});await live.post('/mail/settings',{autoCollect:true,autoDelete:deleteDuringCollection});
    await expect.poll(async()=>{const box=await live.post('/mail/refresh',{}),native=await read(),s=await live.state();observations.push({at:Date.now(),box,native});return {taken:deleteDuringCollection?native.mail.length===0:native.mail[0]?.taken,carried:native.items,pending:[s.merchantCurrent,...s.merchantQueue].filter(j=>j?.reason==='collect mail'&&j.mail?.id===mail.id).length};},{timeout:120000}).toEqual({taken:true,carried:2,pending:0});
    await live.post('/mail/settings',{autoCollect:true,autoDelete:true});
    await expect.poll(async()=>(await read()).mail.length,{timeout:30000}).toBe(0);
    const completed=await live.post('/mail/refresh',{});expect(completed.outbox.filter((m:any)=>m.id===order.jobId)).toHaveLength(1);
    await live.post('/mail/outbox-delete',{id:order.jobId});await live.restartCoordinator();
    const final=await live.post('/mail/refresh',{});expect(final.settings).toEqual({autoCollect:true,autoDelete:true});expect(final.outbox.filter((m:any)=>m.id===order.jobId)).toHaveLength(0);expect((await read()).items).toBe(2);
  }finally{await info.attach('native-mailbox-send-collect-delete-ledger',{body:JSON.stringify(observations),contentType:'application/json'});}
}

// M50 and M51 (live-npc-sale-keep.spec.ts). Failure inventory: e2e/npc-sale-keep-failures.md
// (#116). Declared inputs: three stacks of 100 Pouch of Poof carried by the merchant and three in
// its bank. The rule is set in the dashboard; withdrawals and NPC sales are native.
const native = (live: { admin(code: string): Promise<any> }) => live.admin(`output=(async()=>{const p=get_player('${merchant}');
  const u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;
  const count=list=>(list||[]).filter(i=>i&&i.name==='smoke').reduce((n,i)=>n+(i.q||1),0);
  const bank=Object.entries(u).filter(([k,v])=>/^items\\d+$/.test(k)&&Array.isArray(v)).reduce((n,[,v])=>n+count(v),0);
  return {carried:count(p.items),bank,gold:p.gold+(Number(u.gold)||0)};})()`);

export async function npcSaleKeepRound(live: LiveGame, page: Page, info: TestInfo, stored: number) {
  const samples: any[] = [];
  const reserve = 250 + stored;
  try {
    await expect.poll(async () => Date.now() - ((await live.state()).characters[merchant]?.seenAt || 0), { timeout: 90_000 }).toBeLessThan(3_000);
    const seeded = await live.admin(`output=(async()=>{const p=get_player('${merchant}');
      for(const slot of [20,21,22]){if(p.items[slot])throw Error('Fixture requires empty cells 20-22');p.items[slot]={name:'smoke',q:100};}
      const seed=info=>{const pack=info.items0||(info.items0=[]);for(let n=0;n<3;n++){const slot=pack.findIndex(i=>!i);
        if(slot<0&&pack.length>=42)throw Error('Fixture requires 3 free items0 slots');pack[slot<0?pack.length:slot]={name:'smoke',q:100};}};
      if(p.user)seed(p.user);else{const u=await db.collection('user').findOne({_id:p.owner});seed(u.info);await db.collection('user').replaceOne({_id:u._id},u);}
      cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
    expect(seeded).toBe(true);
    if (stored) {
      // A deliberately unavailable offline worker retains native stock without
      // triggering the unrelated headless slot-borrow/unload journey.
      await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'E2EBankBoi'});
        if(!c)throw Error('Owned BankBoi missing');c.info.items=[{name:'smoke',q:100},{name:'smoke',q:100}];
        await db.collection('character').replaceOne({_id:c._id},c);return true;})()`);
      await live.restoreHistoricalSettings(()=>({bankbois:{E2EBankBoi:{name:'E2EBankBoi',state:'error',error:'Declared offline storage; inventory retained',items:[0,1].map(slot=>({slot,item:{name:'smoke',q:100}}))}}}));
    }
    const before = await native(live);
    expect(before).toMatchObject({ carried: 300, bank: 300 });
    await info.attach('declared-poofs', { body: JSON.stringify(before), contentType: 'application/json' });
    // The coordinator learns the bank from a bank visit, as after any real trip (the Visit bank action).
    await live.post('/command', { character: merchant, type: 'bank' });
    await expect.poll(async () => {
      const response = await fetch(live.url + '/party-api/state?catalog=0&dashboard=1&section=bank');
      const packs = (await response.json()).bank?.packs || {};
      return Object.values(packs).flat().filter((entry: any) => entry?.item?.name === 'smoke').reduce((n: number, entry: any) => n + (entry.item.q || 1), 0);
    }, { timeout: 120_000, message: 'The bank visit must report the banked Pouches of Poof' }).toBe(300);

    await page.goto(live.url);
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: merchant, exact: true }) });
    const inventory = card.getByRole('button', { name: /^Inventory/ });
    const dialog = page.getByRole('dialog', { name: 'Automatically sell to NPC?' });
    const openRule = async (label: RegExp) => {
      await expect(async () => {
        if (await inventory.getAttribute('aria-expanded') !== 'true') await inventory.click();
        await card.getByLabel('Pouch of Poof', { exact: true }).first().click({ button: 'right' });
        await page.getByRole('menuitem', { name: label }).click();
        await expect(dialog).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 60_000 });
    };
    // 1: the dialog takes the amount to keep.
    await openRule(/^Auto sell to NPC/);
    await expect(dialog.getByLabel('Number to keep reserved')).toHaveValue('0');
    await dialog.getByLabel('Number to keep reserved').fill(String(reserve));
    await info.attach('npc-sale-keep-dialog', { body: await dialog.screenshot(), contentType: 'image/png' });
    await dialog.getByRole('button', { name: 'Enable auto sale', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (Object.values((await live.state()).autoNpcSales || {}) as any[]).find(rule => rule.item?.name === 'smoke')?.keep).toBe(reserve);
    // 5: the saved amount shows when the rule is reopened. The merchant still carries every copy:
    // its automations stay off until here, so nothing has been sold or banked yet.
    await openRule(/^Update auto sell to NPC/);
    await expect(dialog.getByLabel('Number to keep reserved')).toHaveValue(String(reserve));
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await live.restartCoordinator();
    await expect.poll(async()=>(Object.values((await live.state()).autoNpcSales || {}) as any[]).find(rule=>rule.item?.name==='smoke')?.keep).toBe(reserve);

    // The fixture starts with merchant automations off; this journey needs its sale and withdrawal routines.
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'auto npc sales': true, withdrawals: true } });

    // 2, 3: the merchant sells down to exactly 250 across bag and bank.
    await expect.poll(async () => { const n = await native(live); samples.push({ at: Date.now(), ...n }); return n.carried + n.bank; },
      { timeout: 300_000, intervals: [2000] }).toBe(250);
    // 4: and stops there. The sale routine marks from the merchant's inventory reports, so the row
    // reads the total on each sample until a newer report reached the coordinator and no automatic
    // sale is queued or running: the routine had its next check and sold nothing past the keep.
    const reportedAt = (await live.state()).characters[merchant]?.seenAt || 0;
    let settled = await native(live);
    await expect.poll(async () => {
      settled = await native(live); samples.push({ at: Date.now(), ...settled });
      expect(settled.carried + settled.bank, 'the total stays at the keep on every sample').toBe(250);
      const s = await live.state(), jobs = [s.merchantCurrent, ...(s.merchantQueue || [])];
      return (s.characters[merchant]?.seenAt || 0) > reportedAt && !jobs.some((job: any) => job?.reason === 'auto npc sales');
    }, { timeout: 60_000, intervals: [2000], message: 'The sale routine checks again and sells nothing past the keep' }).toBe(true);
    expect(settled.gold).toBeGreaterThan(before.gold);
    if (stored) {
      const offline = await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'E2EBankBoi'});
        return c.info.items.filter(i=>i&&i.name==='smoke').reduce((n,i)=>n+(i.q||1),0);})()`);
      expect(offline).toBe(stored);
      expect(settled.carried + settled.bank + offline).toBe(reserve);
    }
    // 6: the kept copies go back to the bank rather than staying in the merchant's bag.
    await expect.poll(async () => { const n = await native(live); samples.push({ at: Date.now(), ...n }); return n; },
      { timeout: 240_000, intervals: [2000], message: 'Kept Pouches of Poof must be banked, not left carried' }).toMatchObject({ carried: 0, bank: 250 });
  } finally {
    await info.attach('npc-sale-keep-samples', { body: JSON.stringify({ samples, activity: (await live.state()).merchantActivity?.slice(-20) }), contentType: 'application/json' });
  }
}
