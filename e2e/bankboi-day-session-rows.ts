import type {Page, TestInfo} from '@playwright/test';
import {expect, headlessMerchant, type LiveGame} from './live-fixtures';

// W54's one BankBoi day (test-windows DESIGN.md 2.2 W54) on one boot with no merchant selected
// (merchantDefault null). The rounds run in an order the behaviours force:
//  1. the native merchant fills the bank until the first offline BankBoi reserves its transfer row
//     (A12);
//  2. the merchant serves as its own BankBoi and stores slices and gifts (A30);
//  3. the merchant goes headless, and the BankBoi delivers a Lantern triplet for a manual compound
//     (A13);
//  4. the BankBoi retries a timed-out trip and drains seven reserve cells (A29);
//  5. the BankBoi delivers stramulets for an automatic compound (A16);
//  6. one offering delivery supplies a manual and an automatic +8 wand upgrade (A17, A21);
//  7. the BankBoi in error holds the offerings and a remote +0 helmet (A20);
//  8. automatic NPC sales pull throwing stars from the BankBoi (A15);
//  9. a drain lease parks the party while the BankBoi is active (A14).
// The bodies are the old tests' (live-bank-staging.spec.ts, live-bankboi.spec.ts,
// live-bankboi-offerings.spec.ts). Every old spec this file cites is at 21fe30a2b.
const merchant='E2EMerchant',storage='E2EBankBoi';

export async function bankboiDaySessionPlay(live: LiveGame, info: TestInfo, page: Page) {
  // The boot selects no merchant, so A30's `merchantCharacter: null` survives its restarts:
  // initialMerchantRuntime takes `saved.merchantCharacter || defaultMerchant`
  // (runtime/settings/coordinator/initial.ts:358-359). The other rounds name the merchant here.
  await live.restoreHistoricalSettings(()=>({merchantCharacter:merchant}));
  await bankStagingRound(live,info,page);
  // A12 leaves its full packs and the merchant inside the bank; nextRound walks it out and clears
  // the cargo before A30 plants its bank stacks (liveb-step11-run3.log: A30 read no berries).
  await nextRound(live);
  await bankboiStoreRound(live,info);
  await headlessDay(live);
  await lanternCompoundRound(live,info);
  await nextRound(live);
  await reserveDrainRound(live,info);
  await nextRound(live);
  await compoundAdmissionRound(live,info);
  await nextRound(live);
  await offeringRound(live,info,'none',['upgrade-mark','auto-upgrade-mark']);
  await nextRound(live);
  await offeringRound(live,info,'remote input',['upgrade-mark','upgrade-mark']);
  await nextRound(live);
  // A20 leaves Auto upgrade on with every +0 helmet marked (autoUpgradeMarks 'helmet@+0',
  // quantity -1), and A15 plants a +0 helmet it expects to keep.
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto upgrade':false}});
  await npcSalesRound(live,info);
  await nextRound(live);
  // A14's drain lease parks the party, so it runs last.
  await maintenanceRound(live,info);
}

// A30's store ends with the merchant as an unselected BankBoi in the bank. The merchant comes back
// as the selected merchant and moves to headless slot 1, which every later round's BankBoi
// handoff borrows. The idle bound is A30's own bank arrival bound (live-bankboi.spec.ts:74).
async function headlessDay(live: LiveGame) {
  await expect.poll(async()=>!(await live.state()).bankboiTransaction,
    {timeout:90_000,message:"A30's store transaction closes before the merchant is selected"}).toBe(true);
  await live.restoreHistoricalSettings(()=>({merchantCharacter:merchant,bankbois:{}}));
  await bridgeLeased(live);
  await headlessMerchant(live,merchant);
  await expect.poll(async()=>{
    const report=(await live.state()).characters[merchant];
    return report?.runtime==='headless' && Date.now()-report.seenAt<=3000;
  },{timeout:90_000}).toBe(true);
}

// Each round plants the BankBoi's bag while the BankBoi is offline, and counts its items across
// the merchant's bag and every bank pack. So the BankBoi leaves its slot, the merchant ends its
// job, and the round's cargo leaves the merchant's bag and bank, which frees bank room for the
// next delivery. The idle bound is the old staging test's (live-bank-staging.spec.ts:22).
// A merchant inside the bank holds the live packs in p.user, and its client reads the copy
// init_bank builds (player.cuser, read by server.js player_to_client). cache_player_items rebuilds
// only the bag, so without init_bank the merchant's next report wrote the old packs back over the
// checkpoint (liveb-step11-run5.log: A13's coats, observer E2EMerchant, gold 1.8m).
const cargo=['coat','helmet','lantern','stramulet','throwingstars','offeringp','wand','sword','slice_nightberry','anniversarygift'];
async function nextRound(live: LiveGame) {
  const idle=()=>expect.poll(async()=>{
    const s=await live.state();
    // The slot names the merchant before its login lands, so the merchant also has to be in the
    // game (liveb-step11-run6.log: after A29 the cleanup found no merchant player).
    return !s.bankboiTransaction && !s.merchantCurrent && s.activeSlots.some((slot:any)=>slot.character===merchant) &&
      !await live.admin(`output=!!get_player('${storage}')`) && await live.admin(`output=!!get_player('${merchant}')`);
  },{timeout:90_000,message:'The BankBoi is offline and the merchant idle in its slot before the next round'}).toBe(true);
  await idle();
  // Each offering round saves its own +8 to +9 wand rule, which the items owner refuses beside the
  // earlier one (rules.ts offeringProblem; liveb-step11-run7.log: 409 on A20's round), so the
  // round's rules go.
  for (const rule of (await live.state()).upgradeOfferingRules || [])
    await live.post('/command',{character:merchant,type:'upgrade-offering-rule',rule,remove:true});
  // A round's locked copies stay in the BankBoi's bag (A13's locked lantern), and once the cleanup
  // below frees bank cells a store cycle returns them to the bank (storage.ts unloadPlan;
  // liveb-step12-run13a.log: "Returned 1 BankBoi inventory stacks" after A13, then the cargo poll read
  // a lantern). So the cargo leaves the BankBoi's bag, in its document and the coordinator's record.
  const held=((await live.state()).bankbois||[]).find((worker:any)=>worker.name===storage)?.items||[];
  if (held.some((entry:any)=>cargo.includes(entry?.item?.name))) {
    await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'}),cargo=${JSON.stringify(cargo)};
      c.info.items=(c.info.items||[]).map(i=>i&&cargo.includes(i.name)?null:i);await db.collection('character').replaceOne({_id:c._id},c);return true;})()`);
    await live.restoreHistoricalSettings(settings=>({bankbois:Object.fromEntries(Object.entries(settings.bankbois||{}).map(([name,worker]:[string,any])=>
      [name,{...worker,items:(worker.items||[]).filter((entry:any)=>!cargo.includes(entry?.item?.name))}]))}));
    // The restart logs the merchant out and back in (liveb-step12-run13b.log: no merchant player).
    await idle();
  }
  // A mounted bank saves over the account document when it unmounts, so the next round's db plants
  // need the merchant outside it (liveb-step11-run8.log: A29's reserve helmets never reached the
  // native bank), as W51's and W52's round changes do. The bound is A30's bank walk bound
  // (live-bankboi.spec.ts, 90 s).
  if (await live.admin(`output=!!get_player('${merchant}').user`)) {
    await live.post('/command',{character:merchant,type:'character-travel',location:{map:'main',x:0,y:0}});
    await expect.poll(async()=>live.admin(`output=!get_player('${merchant}').user`),
      {timeout:90_000,message:'The merchant leaves the bank before the next round'}).toBe(true);
  }
  const bank=await live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=await db.collection('user').findOne({_id:p.owner}),cargo=${JSON.stringify(cargo)};
    const keep=i=>i&&cargo.includes(i.name)?null:i;
    p.items=p.items.map(keep);
    const source=p.user||u.info,packs=Object.keys(source).filter(k=>/^items\\d+$/.test(k)&&Array.isArray(source[k]));
    const set=Object.fromEntries(packs.map(k=>['info.'+k,source[k].map(keep)]));
    await db.collection('user').updateOne({_id:p.owner},{$set:set});
    if(p.user){for(const k of packs)p.user[k]=set['info.'+k];init_bank(p);}
    cache_player_items(p);resend(p,'reopen+cid');
    return {gold:0,packs:Object.fromEntries(packs.map(k=>[k,set['info.'+k].map((item,slot)=>item?{slot,item}:null)]))};})()`);
  await live.post('/bankboi/checkpoint',{character:merchant,bank});
  await expect.poll(async()=>{
    const s=await live.state();
    return [...(s.characters[merchant]?.items||[]),...Object.values(s.bank?.packs||{}).flat()].some((entry:any)=>cargo.includes(entry?.item?.name));
  },{message:"The round's cargo leaves the merchant's bag and bank"}).toBe(false);
}

export async function bankStagingRound(live: LiveGame, info: TestInfo, page: Page) {
  const openBank = async () => {
    const dialog = page.getByRole('dialog',{name:'Bank',exact:true});
    // Reload returns server-rendered controls before client event handlers attach.
    await expect(async () => {
      if (!await dialog.isVisible()) await page.getByRole('button',{name:'Bank',exact:true}).click();
      await expect(dialog).toBeVisible({timeout:1000});
    }).toPass({timeout:30_000,intervals:[1000]});
    return dialog;
  };
  await live.admin(`output=(async()=>{const p=get_player('${merchant}');const a=Array.from({length:42},()=>({name:'helmet',level:0})),b=Array(42).fill(null);for(let i=0;i<35;i++)b[i]={name:'helmet',level:0};b[40]={name:'sword',level:0};await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':a,'info.items1':b}});return true})()`);
  await live.post('/command',{character:merchant,type:'bank'});
  await expect.poll(async () => (await live.state()).bank?.packs?.items1?.[35]?.item?.name, {timeout:90_000}).toBe('sword');
  const ordinary = await live.state();
  expect(ordinary.bank.packs.items1[40]).toBeFalsy();
  expect(ordinary.bankboiQueue).toHaveLength(0);
  expect(Object.values(ordinary.bank.packs).flat().filter((entry:any)=>entry?.item?.name==='helmet')).toHaveLength(77);
  await expect.poll(async () => (await live.state()).merchantCurrent, {timeout:90_000}).toBeNull();
  await page.goto(live.url);
  const dialog = await openBank();
  await expect(dialog.getByText('RESERVED',{exact:true})).toHaveCount(0);
  await info.attach('ordinary-full-bank',{body:JSON.stringify(ordinary),contentType:'application/json'});
  await info.attach('ordinary-bank-dashboard',{body:await page.screenshot(),contentType:'image/png'});
  await page.keyboard.press('Escape');
  await live.restoreHistoricalSettings(() => ({bankbois:{OfflineStorage:{name:'OfflineStorage',state:'idle',items:[]}}}));
  await live.post('/command',{character:merchant,type:'bank'});
  await expect.poll(async () => (await live.state()).bankboiQueue?.some((request:any)=>request.pack==='items1'&&request.slot===35&&request.item.name==='sword'),{timeout:90_000}).toBe(true);
  await page.reload();
  await openBank();
  await expect(page.getByRole('dialog',{name:'Bank',exact:true}).getByText('RESERVED',{exact:true})).toHaveCount(7);
  const reserved = await live.state();
  expect(reserved.bank.packs.items1[35]?.item?.name).toBe('sword');
  await info.attach('first-offline-bankboi-reservation',{body:JSON.stringify({reserved,events:await live.clients[merchant].events()}),contentType:'application/json'});
  await info.attach('reserved-bank-dashboard',{body:await page.screenshot(),contentType:'image/png'});
  await page.keyboard.press('Escape');
  await live.restoreHistoricalSettings(() => ({bankbois:{}}));
  await expect.poll(async () => (await live.state()).bankboiQueue?.length).toBe(0);
  await live.post('/command',{character:merchant,type:'bank'});
  await expect.poll(async () => (await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
  await page.reload();
  await openBank();
  await expect(page.getByRole('dialog',{name:'Bank',exact:true}).getByText('RESERVED',{exact:true})).toHaveCount(0);
  expect((await live.state()).bank.packs.items1[35]?.item?.name).toBe('sword');
  await info.attach('last-worker-removed',{body:JSON.stringify(await live.state()),contentType:'application/json'});
}

export async function bankboiStoreRound(live: LiveGame, info: TestInfo) {
  // Failure modes: a storage merchant is rejected by production-owner checks;
  // processing never starts; unload leaves compatible berries/gifts split;
  // merging loses quantity or repeats deposits after restart.
  const name = 'E2EMerchant';
  await live.admin(`output=(async()=>{
    const p=get_player('${name}');
    p.items[20]={name:'slice_nightberry',q:3};p.items[21]={name:'anniversarygift',q:4};
    await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0.0':{name:'slice_nightberry',q:10},'info.items0.1':{name:'anniversarygift',q:20}}});
    cache_player_items(p);resend(p,'reopen+cid');return p.items;
  })()`);
  await expect.poll(async () => (await live.clients[name].snapshot()).items[20]?.q).toBe(3);
  await live.restoreHistoricalSettings(() => ({
    merchantCharacter: null,
    bankbois: { [name]: { name, state: 'idle', items: [] } },
    bankboiTransaction: { id: 'historical-bankboi-store', bankboi: name, mode: 'store', phase: 'waiting-for-bankboi', slot: 2, requestIds: [], retrievals: [], startedAt: Date.now() },
  }));
  expect((await live.state()).merchantCharacter).toBeNull();
  expect((await live.state()).bankboiTransaction?.id).toBe('historical-bankboi-store');
  await expect.poll(async () => (await live.clients[name].snapshot()).map, { timeout: 90_000 }).toBe('bank');
  const bank = () => live.admin(`output=(()=>{const p=get_player('${name}');return Object.values(p.user).filter(Array.isArray).flat().filter(i=>i&&['slice_nightberry','anniversarygift'].includes(i.name));})()`);
  await expect.poll(bank, { timeout: 90_000 }).toEqual(expect.arrayContaining([
    { name: 'slice_nightberry', q: 13 }, { name: 'anniversarygift', q: 24 },
  ]));
  await info.attach('bankboi-native-stack-results', { body: JSON.stringify({ bank: await bank(), client: await live.clients[name].snapshot(), state: await live.state(), events: await live.clients[name].events() }), contentType: 'application/json' });
  await live.restartCoordinator();
  await expect.poll(bank).toEqual(expect.arrayContaining([
    { name: 'slice_nightberry', q: 13 }, { name: 'anniversarygift', q: 24 },
  ]));
}

// A bank with no free cell outside the staging row (items1 35-41), in the account document and the
// coordinator's view. With no room, the BankBoi keeps its stacks (storage.ts unloadPlan) and a
// round's inputs stay remote. A16 needs it as A13 does: after the round change empties the bank, a
// store cycle returned the BankBoi's stramulets to the bank before the compound
// (liveb-step11-run9.log).
async function fullBank(live: LiveGame) {
  const bank=await live.admin(`output=(async()=>{const p=get_player('${merchant}');
    const items0=Array.from({length:42},()=>({name:'coat',level:0})),items1=Array.from({length:42},(_,i)=>i<35?{name:'coat',level:0}:null);
    await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':items0,'info.items1':items1}});
    return {gold:0,packs:{items0:items0.map((item,slot)=>({slot,item})),items1:items1.map((item,slot)=>item?{slot,item}:null)}};})()`);
  await live.post('/bankboi/checkpoint',{character:merchant,bank});
}

export async function lanternCompoundRound(live: LiveGame, info: TestInfo) {
  // Failure inventory: virtual packs are rejected; the wrong copy is selected;
  // locked/reserved copies join the triplet; storage delivery loses group source
  // slots; generic withdrawals steal inputs; restart replays or loses the group.
  await live.post('/merchant/force-stand',{enabled:true});
  const items=[...Array.from({length:3},()=>({name:'lantern',level:2})),{name:'lantern',level:2,l:'l'}];
  await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'});c.info.items=${JSON.stringify(items)};await db.collection('character').replaceOne({_id:c._id},c);return true;})()`);
  await fullBank(live);
  await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:'ready',items:items.map((item,slot)=>({slot,item}))}}}));
  await expect.poll(async()=>(await live.state(true)).merchantCatalog?.allItems?.some((e:any)=>e.id==='lantern'&&e.compoundable),{timeout:30_000}).toBe(true);
  const samples:any[]=[];
  const native=()=>live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'}),u=await db.collection('user').findOne({_id:c.owner}),p=get_player('${merchant}');return [...c.info.items,...Object.entries(u.info).filter(([k,v])=>/^items\\d+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v),...(p?.items||[])].filter(i=>i?.name==='lantern');})()`);
  try{
    await live.post('/command',{character:merchant,type:'compound-mark',pack:'bankboi:'+storage,slot:1,item:{name:'lantern',level:2}});
    await expect.poll(async()=>{
      const s=await live.state(),groups=s.compounds[merchant]||[];
      samples.push({at:Date.now(),groups,transaction:s.bankboiTransaction,withdrawals:s.withdrawals[merchant]});
      return groups.length===1&&groups[0].items.length===3&&groups[0].items.every((m:any)=>/^items\d+$/.test(m.storage?.pack))&&!s.bankboiTransaction;
    },{timeout:120_000}).toBe(true);
    const delivered=(await live.state()).compounds[merchant];
    expect(new Set(delivered[0].items.map((m:any)=>m.storage.pack+':'+m.storage.slot)).size).toBe(3);
    expect(delivered[0].items.every((m:any)=>!m.item.l&&m.item.level===2)).toBe(true);
    await live.restartCoordinator();
    await expect.poll(async()=>(await live.state()).compounds[merchant]).toEqual(delivered);
    await live.post('/merchant/force-stand',{enabled:false});
    await expect.poll(async()=>{
      const s=await live.state(),n=await native();
      return (s.compounds[merchant]||[]).length===0&&
        s.merchantActivity.filter((a:any)=>a.message==='Group 1 compounded'||a.message==='Group 1 compound failed').length===1&&
        n.filter((i:any)=>i.level===2&&!i.l).length===0&&n.filter((i:any)=>i.l==='l').length===1&&
        n.filter((i:any)=>i.level===3).length<=1;
    },{timeout:120_000}).toBe(true);
  }finally{
    await info.attach('native-bankboi-manual-lantern-compound',{body:JSON.stringify({samples,native:await native(),state:await live.state()}),contentType:'application/json'});
  }
}

export async function maintenanceRound(live: LiveGame, info: TestInfo) {
  // Failure inventory: recent merchant telemetry survives its native logout;
  // maintenance waits forever for that old owner, misses the replacement, or
  // admits another slot swap during the hold. Native worker lifecycle and
  // client acknowledgements must prove the roster, rather than seeded receipts.
  // Keep remote storage away from the bank so the maintenance request can
  // observe its real slot occupancy before the visit completes.
  await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'});Object.assign(c.info,{map:'winterland',in:'winterland',x:0,y:0,items:[{name:'offeringp',q:1}]});await db.collection('character').replaceOne({_id:c._id},c);return true;})()`);
  await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:'ready',items:[{slot:0,item:{name:'offeringp',q:1}}]}}}));
  await live.post('/command',{character:merchant,type:'withdraw',pack:'bankboi:'+storage,slot:0,item:{name:'offeringp',q:1}});
  const samples:any[]=[];
  try{
    await expect.poll(async()=>(await live.state()).activeSlots.some((s:any)=>s.character===storage),{timeout:90_000}).toBe(true);
    live.consoleDrainLease('bankboi-safe-handoff');
    await expect.poll(async()=>{
      const state=await live.state();
      const maintenance=await fetch(live.deploymentPaths.apiUrl+'/party-api/console-maintenance').then(r=>r.json());
      samples.push({at:Date.now(),maintenance,slots:state.activeSlots,transaction:state.bankboiTransaction,
        merchant:state.characters[merchant]?.consoleMaintenance,storage:state.characters[storage]?.consoleMaintenance});
      return maintenance.id==='bankboi-safe-handoff'&&maintenance.ready&&
        state.activeSlots.some((s:any)=>s.character===storage)&&
        state.characters[storage]?.consoleMaintenance?.ready===true;
    },{timeout:30_000}).toBe(true);
  }finally{
    await info.attach('native-bankboi-safe-handoff',{body:JSON.stringify({samples,state:await live.state()}),contentType:'application/json'});
    live.consoleDrainLease(null);
  }
}

export async function npcSalesRound(live: LiveGame, info: TestInfo) {
  // Failure inventory: remote stock is never discovered; duplicate requests sell
  // twice; keep/locked copies are retrieved; delivery is mistaken for sale; a
  // restart recreates completed demand. Native storage, sales and persistence
  // remain authoritative after the declared offline inventory input.
  const items=[...Array.from({length:5},()=>({name:'throwingstars',level:0})),{name:'helmet',level:0,l:'l'}];
  await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'});c.info.items=${JSON.stringify(items)};await db.collection('character').replaceOne({_id:c._id},c);return true;})()`);
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{withdrawals:false,'auto npc sales':false}});
  await live.post('/merchant/auto-npc-sale',{item:{name:'throwingstars',level:0},keep:2});
  await live.post('/merchant/auto-npc-sale',{item:{name:'helmet',level:0},keep:0});
  await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:'ready',items:items.map((item,slot)=>({slot,item}))}}}));
  const observations:any[]=[];
  const native=()=>live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'}),u=await db.collection('user').findOne({_id:c.owner}),p=get_player('${merchant}');return {storage:c.info.items,bank:Object.entries(u.info).filter(([k,v])=>/^items\\d+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v),merchant:p?.items||[]};})()`);
  try{
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':true}});
    await expect.poll(async()=>{
      const s=await live.state(),n=await native();
      observations.push({at:Date.now(),withdrawals:s.withdrawals[merchant],transaction:s.bankboiTransaction,current:s.merchantCurrent,native:n});
      if(observations.length>128)observations.shift();
      const all=[...n.storage,...n.bank,...n.merchant].filter(Boolean);
      return all.filter((i:any)=>i.name==='throwingstars').length===2 &&
        all.some((i:any)=>i.name==='helmet'&&i.l==='l') &&
        !s.bankboiTransaction && !(s.withdrawals[merchant]||[]).length &&
        s.merchantActivity.filter((a:any)=>a.message.includes('Sold')&&a.message.includes('throwingstars')).length===3;
    },{timeout:180_000,intervals:[250,500]}).toBe(true);
    await live.restartCoordinator();
    await expect.poll(async()=>{
      const s=await live.state(),n=await native();
      return [...n.storage,...n.bank,...n.merchant].filter((i:any)=>i?.name==='throwingstars').length===2 &&
        !s.bankboiTransaction && !(s.withdrawals[merchant]||[]).length;
    }).toBe(true);
  }finally{
    await info.attach('automatic-bankboi-npc-sales',{body:JSON.stringify({observations,native:await native(),state:await live.state()}),contentType:'application/json'});
  }
}

export async function compoundAdmissionRound(live: LiveGame, info: TestInfo) {
  await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'});
    c.info.items=[{name:'stramulet',level:0},{name:'stramulet',level:0},{name:'stramulet',level:0}];
    await db.collection('character').replaceOne({_id:c._id},c);return true;})()`);
  await fullBank(live);
  const observations:any[]=[];
  let sawRemote=false,native:any;
  try{
    await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:'ready',items:[0,1,2].map(slot=>({slot,item:{name:'stramulet',level:0}}))}},
      autoCompounds:{[merchant]:[{name:'stramulet',targetTier:1,quantity:1}]}}));
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto compound':true}});
    await expect.poll(async()=>{
      const state=await live.state();
      native=await live.admin(`output=(async()=>{const p=get_player('${merchant}');if(!p)return null;const u=await db.collection('user').findOne({_id:p.owner});return {bank:Object.entries(u.info).filter(([k,v])=>/^items\\d+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v).filter(i=>i&&i.name==='stramulet'),items:p.items.filter(i=>i&&i.name==='stramulet')};})()`);
      const remote=(state.withdrawals[merchant]||[]).some((r:any)=>String(r.pack).startsWith('bankboi:'));
      if(remote)sawRemote=true;
      const job=state.merchantCurrent;
      if(observations.length===128)observations.shift();
      observations.push({at:Date.now(),remote,job,transaction:state.bankboiTransaction,native});
      // With no carried/native-bank triple, unresolved remote inputs alone
      // must not start an improvement visit. Other merchant work stays allowed.
      if(remote&&!native?.bank.length&&!native?.items.length)
        expect(job?.reason).not.toBe('auto compound');
      return native&&[...native.bank,...native.items].filter((i:any)=>(i.level||0)===0).length===0&&
        state.merchantActivity.some((a:any)=>a.message==='Auto compounded stramulet to +1'||a.message==='Auto compound failed for stramulet');
    },{timeout:270_000,intervals:[250,500]}).toBe(true);
    expect(sawRemote).toBe(true);
    expect([...native.bank,...native.items].filter((i:any)=>i.level===1).length).toBeLessThanOrEqual(1);
    expect((await live.post('/merchant/production',{character:merchant,action:'pending'})).pending).toEqual([]);
  }finally{
    await info.attach('native-bankboi-compound-admission',{body:JSON.stringify({sawRemote,native,observations,state:await live.state()}),contentType:'application/json'});
  }
}

// The offering loop's body (live-bankboi-offerings.spec.ts) for its no-restart cases. `marks` names
// the mark each +8 wand gets, slot 20 first: W54 marks slot 20 manual (A17) and slot 21 automatic
// (A21), so one delivery serves both, as W55's does (bankboi-session-rows.ts). The handoff and
// delivery restarts are W55's.
export type OfferingMark = 'upgrade-mark' | 'auto-upgrade-mark';
export async function offeringRound(live: LiveGame, info: TestInfo, interruption: 'none' | 'remote input', marks: OfferingMark[]) {
  // The offline storage inventory is a declared account input. All subsequent
  // slot handoffs, bank deposits/withdrawals and upgrade responses stay native.
  await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'});
    c.info.items=[{name:'offeringp',q:1},{name:'offeringp',q:1},{name:'offeringp',q:1}${interruption==='remote input'?",{name:'helmet',level:0}":''}];await db.collection('character').replaceOne({_id:c._id},c);
    const p=get_player('${merchant}');p.items[20]={name:'wand',level:8};p.items[21]={name:'wand',level:8};cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  // A20's helmet is remote only while the bank has no room for it: the round change empties the
  // bank, and a store cycle returned the helmet to it before Auto upgrade was on, so a scheduler
  // that admitted BankBoi stock as local left A20 green (liveb-step12-run4.log, run8.log).
  if(interruption==='remote input') await fullBank(live);
  await expect.poll(async()=> (await live.state()).characters[merchant]?.items[20]?.item?.name).toBe('wand');
  await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:interruption==='remote input'?'error':'ready',...(interruption==='remote input'?{error:'POST /merchant/bank-sort/checkpoint · network',retryAt:0}:{}),items:[...[0,1,2].map(slot=>({slot,item:{name:'offeringp',q:1}})),...(interruption==='remote input'?[{slot:3,item:{name:'helmet',level:0}}]:[])]}},...(interruption==='remote input'?{autoUpgradeMarks:{[merchant]:{'helmet@+0':{tiers:1,quantity:-1}}}}:{})}));
  await expect.poll(async()=> (await live.state()).upgradeOfferingStock.offeringp).toBe(3);
  {
    await expect.poll(async()=> (await live.state(true)).merchantCatalog?.allItems?.some((entry:any)=>
      entry.id==='wand' && (entry.upgradeable || entry.meta?.upgradeable)),
    {timeout:120_000,message:'Native upgrade catalog must authorize the offering rule'}).toBe(true);
    await live.post('/command',{character:merchant,type:'upgrade-offering-rule',rule:{name:'wand',floor:8,ceiling:9,offering:'offeringp',required:true}});
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto upgrade':true}});
  }
  for(const [index,type] of marks.entries()) await live.post('/command',{character:merchant,type,slot:20+index,item:{name:'wand',level:8},tiers:1});
  const observations:any[]=[];
  let native:any,sawSupplyDependency=false;
  const checkedUpgradeAdmissions=new Set<string>();
  // A throw inside the poll's callback only retries it, and each job is read once, so the poll
  // collects the auto upgrade jobs that started without their helmet, ends on the first, and the
  // check reads them after it (two breaks left W54 green in liveb-step12-run4.log and run8.log).
  const unadmitted:any[]=[];
  try {
  await expect.poll(async()=>{
    const state=await live.state();
    sawSupplyDependency ||= !!state.merchantCurrent?.offeringSupply || state.merchantQueue.some((job:any)=>job.offeringSupply);
    if(interruption==='remote input'&&state.merchantCurrent?.reason==='auto upgrade'&&!checkedUpgradeAdmissions.has(state.merchantCurrent.id)) {
      checkedUpgradeAdmissions.add(state.merchantCurrent.id);
      const available=[...(state.characters[merchant]?.items||[]),...Object.values(state.bank?.packs||{}).flat()];
      if(!available.some((entry:any)=>entry?.item?.name==='helmet'&&(entry.item.level||0)===0)) unadmitted.push(state.merchantCurrent);
    }
    if(unadmitted.length) return true;
    if(observations.length>=256) observations.shift();
    observations.push({at:Date.now(),transaction:state.bankboiTransaction,withdrawals:state.withdrawals[merchant],current:state.merchantCurrent,queue:state.merchantQueue,upgrades:state.upgrades[merchant],activity:state.merchantActivity.slice(-5)});
    native=await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'}),p=get_player('${merchant}');if(!p)return null;
      const worker=get_player('${storage}'),u=await db.collection('user').findOne({_id:p.owner});
      const all=[...(worker?worker.items:c.info.items||[]),...p.items,...Object.entries(p.user||u.info).filter(([key,value])=>/^items\\d+$/.test(key)&&Array.isArray(value)).flatMap(([,value])=>value)];
      return {remaining:all.filter(i=>i&&i.name==='offeringp').reduce((n,i)=>n+(i.q||1),0),helmets:all.filter(i=>i&&i.name==='wand'),merchantItems:p.items,storageItems:worker?worker.items:c.info.items};})()`);
    return native?.remaining===1 && native.helmets.length<=2 && !native.helmets.some((item:any)=>(item.level||0)===8);
  },{timeout:270_000}).toBe(true);
  expect(unadmitted,'Remote-only upgrade work must await native input delivery').toEqual([]);
  expect(native.helmets.length).toBeLessThanOrEqual(2);
  if(native.helmets.length) expect(native.helmets[0].level).toBe(9);
  await expect.poll(async()=> (await live.post('/merchant/production',{character:merchant,action:'pending'})).pending).toEqual([]);
  expect(sawSupplyDependency).toBe(true);
  } finally {
  await info.attach('native-bankboi-offering-upgrade',{body:JSON.stringify({interruption,marks,sawSupplyDependency,unadmitted,native,observations,state:await live.state()}),contentType:'application/json'});
  }
}

export async function reserveDrainRound(live: LiveGame, info: TestInfo) {
  // Failure inventory: an expired transport error permanently excludes the worker;
  // retry ignores its cooldown; cargo is lost/duplicated; native completion arrives
  // before queue cleanup or merchant restoration; restart replays completed cargo.
  const bank=await live.admin(`output=(async()=>{
    const p=get_player('${merchant}'),u=await db.collection('user').findOne({_id:p.owner});
    u.info.items0=Array.from({length:42},()=>({name:'coat',level:0}));
    u.info.items1=Array.from({length:42},(_,i)=>({name:i<35?'coat':'helmet',level:0}));
    await db.collection('user').updateOne({_id:p.owner},{$set:{'info.items0':u.info.items0,'info.items1':u.info.items1}});
    const c=await db.collection('character').findOne({'info.name':'${storage}'});c.info.items=Array(42).fill(null);
    await db.collection('character').replaceOne({_id:c._id},c);
    return {gold:0,packs:Object.fromEntries(['items0','items1'].map(pack=>[pack,u.info[pack].map((item,slot)=>({slot,item}))]))};
  })()`);
  await live.restoreHistoricalSettings(()=>({bankbois:{[storage]:{name:storage,state:'error',error:'POST /movement-plan · timeout',retryAt:0,items:[]}}}));
  await live.post('/bankboi/checkpoint',{character:merchant,bank});
  const observations:any[]=[];
  const native=()=>live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${storage}'}),u=await db.collection('user').findOne({_id:c.owner});return {items:c.info.items,bank:u?.info.items1};})()`);
  try {
    await expect.poll(async()=>{
      const s=await live.state(),n=await native();
      observations.push({at:Date.now(),queue:s.bankboiQueue,transaction:s.bankboiTransaction,workers:s.bankbois,native:n});
      if(observations.length>128)observations.shift();
      const worker=s.bankbois.find((w:any)=>w.name===storage);
      return n.items.filter((i:any)=>i?.name==='helmet').length===7 &&
        n.bank.slice(35,42).every((i:any)=>!i) && s.bankboiQueue.length===0 &&
        !s.bankboiTransaction && worker?.state==='ready' &&
        s.activeSlots.some((slot:any)=>slot.character===merchant);
    },{timeout:180_000,intervals:[250,500]}).toBe(true);
    await live.restartCoordinator();
    await expect.poll(async()=>{
      const s=await live.state(),n=await native();
      return s.bankboiQueue.length===0 && !s.bankboiTransaction && n.items.filter((i:any)=>i?.name==='helmet').length===7;
    }).toBe(true);
  } finally {
    await info.attach('bankboi-reserve-timeout-recovery',{body:JSON.stringify({observations,native:await native(),state:await live.state()}),contentType:'application/json'});
  }
}

// The roster refuses a Steam action until the bridge leases a restarted coordinator again
// (lifecycle/roster/steam-group.ts:35; liveb-step11-run4.log: 409 right after a settings restore),
// so a Steam action after a restart waits for it as the fixture's logins do (live-fixtures.ts, 30 s).
export async function bridgeLeased(live: LiveGame) {
  await expect.poll(async()=>(await (await fetch(new URL('/party-api/steam/connection',live.url))).json()).ready,
    {timeout:30_000,message:'The Steam bridge leases the restarted coordinator'}).toBe(true);
}
