import type {Page, TestInfo} from '@playwright/test';
import {waitForGameplay} from './network-clock';
import {expect, type LiveGame} from './live-fixtures';
import {bankQuantity, economy, jobFinished, quantity, record, seed} from './stand-session-rows';

// W57's one exchange day (test-windows DESIGN.md 2.2 W57), the bodies of
// live-exchange-reward-bank.spec.ts, live-economy.spec.ts's exchange test,
// live-bank-collection.spec.ts's resumed exchange and live-exchange-collection.spec.ts (every old
// spec this file cites is at 21fe30a2b):
//  1. ten gems exchanged with every reward stack carried bank their rewards by default and the
//     Auto bank rules survive a restart (M18);
//  2. a box exchanged with no rule banks its reward, then Auto exchange chains the marked boxes,
//     sells the rewards and takes the next box after a restart (A47);
//  3. a resumed gem exchange compresses the candy the priest sends mid-job (A7);
//  4. the player marks a fighter's box Exchange, the pickup survives a restart (M16), then marks
//     the next box Auto exchange, and turning the rule off keeps the box after it (M17).
// Each round starts from the stock the last one planted: the merchant's planted cells, the
// fighter's planted cells and the Auto exchange rules go between rounds, since each round's counts
// read its own plants and M17's menu toggles the armorbox rule A47 saved.
const merchant = 'E2EMerchant';

export async function exchangeSessionPlay(live: LiveGame, page: Page, info: TestInfo) {
  await rewardBankRound(live, info);
  await clearPlants(live, merchant, 20, 30);
  await exchangeChainRound(live, info);
  await clearPlants(live, merchant, 10, 14);
  await live.restoreHistoricalSettings(() => ({autoExchanges: {}}));
  const resumed = await resumedExchangeRound(live, info);
  // The hundred-gem order would hold the merchant for the rest of the window, so its gems go with
  // the candy, the order ends, and the candy rule goes before M17 turns automatic exchange on.
  await clearPlants(live, merchant, 20, 27);
  await clearPlants(live, 'E2EPriest', 20, 21);
  await jobFinished(live, resumed);
  // M18's default Auto bank mark for armorbox stays saved, so the warrior's planted box was marked for
  // collection and the Exchange menu was refused as "already has a collection intent" (market.ts
  // `once`; liveb-step11-run1.log: autoItemMarks {"armorbox@+0":"bank"}, the merchant carrying 3
  // boxes from A47). M16 reads a fighter's box with no rule, from a merchant that carries none.
  await live.restoreHistoricalSettings(() => ({autoExchanges: {}, autoItemMarks: {}}));
  await live.admin(`output=(()=>{const p=get_player('${merchant}');p.items=p.items.map(i=>i?.name==='armorbox'?null:i);cache_player_items(p);resend(p,'reopen+cid');return true})()`);
  await expect.poll(async()=>(await live.state()).characters[merchant]?.items?.some((entry:any)=>entry?.item?.name==='armorbox'),
    {message:"The merchant's carried boxes leave before M16"}).toBe(false);
  await partyExchangeRound(live, page, info, false);
  await clearPlants(live, 'E2EWarrior', 20, 23);
  await partyExchangeRound(live, page, info, true);
}

// Empties a character's planted cells [from, to) and waits until the coordinator reads them empty.
async function clearPlants(live: LiveGame, name: string, from: number, to: number) {
  await live.admin(`output=(()=>{const p=get_player('${name}');for(let slot=${from};slot<${to};slot++)p.items[slot]=null;cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  await expect.poll(async()=>((await live.state()).characters[name]?.items||[]).some((entry:any)=>entry&&entry.slot>=from&&entry.slot<to),{timeout:30_000}).toBe(false);
}

// M18 (live-exchange-reward-bank.spec.ts). The declared inputs are the merchant's seeded
// inventory: ten gem0 plus a carried stack of every item gem0 can yield, so each item reward
// merges into a stack. The exchange rolls, the reward placement and every bank deposit are native.
const rewards: Record<string, number> = { armorbox: 2, weaponbox: 2, offering: 1, scroll1: 10, cscroll1: 4, scroll3: 1, cscroll3: 1 };
const native = (live: { admin(code: string): Promise<any> }) => live.admin(`output=(async()=>{const p=get_player('${merchant}');
  const u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;
  const count=(list,test)=>(list||[]).filter(i=>i&&test(i)).reduce((n,i)=>n+(i.q||1),0);
  const bank=Object.entries(u).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v);
  const names=${JSON.stringify(Object.keys(rewards))}.concat(['gem0','beewings']);
  return {carried:Object.fromEntries(names.map(n=>[n,count(p.items,i=>i.name===n&&!i.l)])),
    locked:p.items.filter(i=>i&&i.l).map(i=>({name:i.name,q:i.q,l:i.l})),
    bank:Object.fromEntries(names.map(n=>[n,count(bank,i=>i.name===n)])),gold:p.gold+(Number(u.gold)||0)};})()`);

async function rewardBankRound(live: LiveGame, info: TestInfo) {
  const observations: any[] = [];
  try {
    await expect.poll(async () => (await live.state(true)).merchantCatalog?.exchangeable?.some((entry: { id: string }) => entry.id === 'gem0'),
      { timeout: 120_000 }).toBe(true);
    const seeded = await live.admin(`output=(()=>{const p=get_player('${merchant}');
      const names=${JSON.stringify(Object.keys(rewards))}.concat(['gem0','beewings']);
      for(let slot=20;slot<=29;slot++) if(p.items[slot]) throw Error('Fixture requires empty inventory cells 20-29');
      if(p.items.some(i=>i&&names.includes(i.name))) throw Error('Fixture requires no carried reward items');
      p.items[20]={name:'gem0',q:10};
      ${JSON.stringify(Object.entries(rewards))}.forEach(([name,q],n)=>{p.items[21+n]={name,q};});
      p.items[28]={name:'armorbox',q:1,l:'l'};p.items[29]={name:'beewings',q:3};
      cache_player_items(p);resend(p,'reopen+cid');return p.items.slice(20,30);})()`);
    await info.attach('declared-merchant-inventory', { body: JSON.stringify(seeded), contentType: 'application/json' });
    await expect.poll(async () => (await live.state()).characters[merchant]?.items?.find((entry: any) => entry?.slot === 29)?.item?.name,
      { timeout: 30_000 }).toBe('beewings');
    const before = await native(live);

    const order = await live.post('/merchant/exchange-order', { exchanges: [{ id: 'gem0', level: 0, quantity: 10 }] });
    await expect.poll(async () => {
      const state = await live.state(), n = await native(live);
      observations.push({ at: Date.now(), n });
      return [state.merchantCurrent, ...(state.merchantQueue || [])].some(job => job?.id === order.jobId) || n.carried.gem0 > 0;
    }, { timeout: 360_000, intervals: [1000, 2000] }).toBe(false);
    const after = await native(live);
    const gainedNames = Object.keys(rewards).filter(name => after.carried[name] + after.bank[name] > before.carried[name] + before.bank[name]);
    await expect.poll(async () => {
      const state = await live.state();
      return gainedNames.every(name => state.autoItemMarks?.[merchant]?.[name + '@+0'] === 'bank');
    }, {timeout: 30_000, message: 'Received default rewards must become visible saved Auto bank rules'}).toBe(true);
    await live.restartCoordinator();
    const restored = await live.state();
    for (const name of gainedNames) expect(restored.autoItemMarks?.[merchant]?.[name + '@+0']).toBe('bank');

    // Every item reward left the merchant's inventory; nothing was lost on the way.
    const gained = Object.keys(rewards).reduce((sum, name) => sum + after.carried[name] + after.bank[name] - before.carried[name] - before.bank[name], 0);
    expect(gained, 'ten gem0 exchanges yield at least one item (all-gold odds are about 1 in 400)').toBeGreaterThan(0);
    for (const name of Object.keys(rewards)) {
      expect(after.carried[name], `${name} rewards must not stay carried`).toBeLessThanOrEqual(before.carried[name]);
      expect(after.carried[name] + after.bank[name], `${name} copies must not be lost`).toBeGreaterThanOrEqual(before.carried[name] + before.bank[name]);
    }
    // Stock the exchange did not add to stays carried, locked stock included.
    expect(after.carried.beewings).toBe(3);
    expect(after.locked).toContainEqual({ name: 'armorbox', q: 1, l: 'l' });
    expect(after.carried.gem0).toBe(0);
  } finally {
    await info.attach('native-exchange-reward-bank', { body: JSON.stringify({ observations, native: await native(live).catch(String),
      activity: (await live.state()).merchantActivity.slice(-20) }), contentType: 'application/json' });
  }
}

// A47 (live-economy.spec.ts 'native exchanges bank default rewards, chain marked boxes and sell
// rewards across restart'). Round 1's Auto bank rules bank the same rewards this round's no-rule
// exchange banks by default.
async function exchangeChainRound(live: LiveGame, info: TestInfo) {
    await expect.poll(async () => (await live.state(true)).merchantCatalog?.exchangeable?.some((entry: { id: string }) => entry.id === 'armorbox'),
      { timeout: 120_000 }).toBe(true);
    await live.post('/merchant/force-stand', { enabled: true });
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'automatic exchange': false, 'auto npc sales': true } });
    await seed(live, { 10: { name: 'armorbox', q: 1 } });
    const before = await economy(live);
    const choices = (await live.state(true)).merchantCatalog.exchangeable;
    const rewardIds = [...new Set<string>(choices.filter((entry: { id: string }) => ['armorbox', 'weaponbox', 'gem0'].includes(entry.id))
      .flatMap((entry: { results: { id: string; kind: string }[] }) => entry.results.filter(result => result.id === result.kind && !['gold', 'shells', 'empty'].includes(result.kind)).map(result => result.id)))];
    const checkpoints: unknown[] = [];
    live.clients[merchant].page.on('response', async response => {
      if (!new URL(response.url()).pathname.endsWith('/exchange-progress')) return;
      try { checkpoints.push({ request: response.request().postDataJSON(), status: response.status(), response: await response.json() }); } catch { /* Closing client. */ }
    });
    const fallback = await live.post('/merchant/exchange-order', { exchanges: [{ id: 'armorbox', level: 0, quantity: 1 }] });
    await live.post('/merchant/force-stand', { enabled: false });
    await jobFinished(live, fallback.jobId);
    const defaultBanked = await economy(live);
    expect(rewardIds.reduce((sum, id) => sum + bankQuantity(defaultBanked, id) - bankQuantity(before, id), 0)).toBe(1);
    await live.post('/merchant/force-stand', { enabled: true });
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'automatic exchange': true } });
    for (const id of rewardIds.filter(id => !['armorbox', 'weaponbox'].includes(id)))
      await live.post('/merchant/auto-npc-sale', { item: { name: id, level: 0 } });
    for (const id of ['gem0', 'armorbox', 'weaponbox'])
      await live.post('/command', { character: merchant, type: 'auto-exchange', slot: -1, item: { name: id, level: 0 } });
    await seed(live, { 10: { name: 'gem0', q: 15 }, 11: { name: 'armorbox', q: 2 }, 12: { name: 'weaponbox', q: 2 }, 13: { name: 'armorbox', q: 1, l: 'l' } });
    await live.post('/merchant/force-stand', { enabled: false });
    await expect.poll(async () => {
      const observed = await economy(live);
      return quantity(observed.characters[merchant].items, 'gem0') === 0 &&
        quantity(observed.characters[merchant].items, 'armorbox') === 1 && quantity(observed.characters[merchant].items, 'weaponbox') === 0 &&
        rewardIds.filter(id => !['armorbox', 'weaponbox'].includes(id)).every(id => quantity(observed.characters[merchant].items, id) === 0);
    }, { timeout: 420_000, message: 'Native marked stock and exchange rewards must finish their selected actions' }).toBe(true);
    const firstBatch = await economy(live);
    expect(firstBatch.characters[merchant].items.find(item => item?.name === 'armorbox')).toMatchObject({ l: 'l', q: 1 });
    expect(bankQuantity(firstBatch, 'armorbox')).toBe(0);
    expect(bankQuantity(firstBatch, 'weaponbox')).toBe(0);
    await live.post('/merchant/force-stand', { enabled: true });
    await live.restartCoordinator();
    await expect.poll(async () => Object.keys((await live.state()).autoExchanges || {}).sort()).toEqual(['armorbox@0', 'gem0@0', 'weaponbox@0']);
    await seed(live, { 10: { name: 'armorbox', q: 1 } });
    await live.post('/merchant/force-stand', { enabled: false });
    await expect.poll(async () => {
      const observed = await economy(live);
      return quantity(observed.characters[merchant].items, 'armorbox') === 1 &&
        rewardIds.filter(id => !['armorbox', 'weaponbox'].includes(id)).every(id => quantity(observed.characters[merchant].items, id) === 0);
    }, { timeout: 150_000 }).toBe(true);
    await record(live, info, 'native-exchange-actions-and-restart', before, { defaultBanked, firstBatch, rewardIds, checkpoints });
    await info.attach('native-exchange-reward-events', { body: JSON.stringify(await live.clients[merchant].events()), contentType: 'application/json' });
}

// A7 (live-bank-collection.spec.ts 'resumed exchange compresses newly delivered candy while
// reward receipts remain owned').
async function resumedExchangeRound(live: LiveGame, info: TestInfo): Promise<string> {
  const sender='E2EPriest',observations:any[]=[];
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'automatic exchange':false}});
  await expect.poll(async()=>(await live.state(true)).merchantCatalog?.exchangeable?.some((e:any)=>e.id==='candy0'),{timeout:60_000}).toBe(true);
  // Retain this reward for processing, matching the live Rare Candy rule. A
  // default Auto bank mark would intentionally own its physical bag copies.
  await live.post('/command',{character:merchant,type:'auto-exchange',slot:-1,item:{name:'candy0',level:0}});
  await live.admin(`output=(()=>{const p=get_player('${merchant}'),s=get_player('${sender}');
    [6450,31,9999,4083,15].forEach((q,i)=>p.items[20+i]={name:'candy0',q});p.items[26]={name:'gem0',q:100};s.items[20]={name:'candy0',q:9500};
    for(const c of [p,s]){cache_player_items(c);resend(c,'reopen+cid');}return true;})()`);
  await expect.poll(async()=>(await live.state()).characters[merchant].items.some((e:any)=>e?.item?.name==='gem0'&&e.item.q===100)).toBe(true);
  const order=await live.post('/merchant/exchange-order',{exchanges:[{id:'gem0',level:0,quantity:100}]});
  // Declared persisted recovery input, matching actual seeded owned stock.
  await live.restoreHistoricalSettings(settings=>({merchantQueue:settings.merchantQueue.map((job:any)=>job.id===order.jobId?{...job,exchangeResume:true,exchangeRewards:[{name:'candy0',q:20578}]}:job)}));
  try {
    await expect.poll(async()=>{const c=await live.clients[merchant].snapshot();return c.items.filter((i:any)=>i?.name==='candy0').map((i:any)=>i.q).sort((a:number,b:number)=>b-a);},{timeout:60_000}).toEqual([9999,9999,580]);
    await live.post('/merchant/force-stand',{enabled:false});
    await expect.poll(async()=>{
      const s=await live.state(),n=await live.admin(`output=get_player('${merchant}').items.filter(i=>i?.name==='gem0').reduce((n,i)=>n+i.q,0)`);
      return s.merchantCurrent?.id===order.jobId&&n<100&&n>0;
    },{timeout:90_000}).toBe(true);
    const position=await live.clients[merchant].run(`({map:character.map,x:character.x,y:character.y})`);
    await live.clients[sender].run(`smart_move(${JSON.stringify(position)})`);
    await expect.poll(async()=>{const s=await live.clients[sender].snapshot(),m=await live.clients[merchant].snapshot();return s.map===m.map&&Math.hypot(s.x-m.x,s.y-m.y)<300;},{timeout:60_000}).toBe(true);
    await live.clients[sender].run(`send_item('${merchant}',character.items.findIndex(i=>i?.name==='candy0'&&i.q===9500),9500)`);
    // The merchant's own exchange command merges the delivered candy; the play only observes the
    // stacks (DESIGN.md A7 fix: the old test's stack-merge-permission calls drove the merge).
    await expect.poll(async()=>{
      const s=await live.state(),c=s.characters[merchant],quantities=c.items.filter((e:any)=>e?.item?.name==='candy0').map((e:any)=>e.item.q).sort((a:number,b:number)=>b-a);
      observations.push({at:Date.now(),job:s.merchantCurrent?.id,quantities,error:c.inventoryStackError});if(observations.length>160)observations.shift();
      return {job:s.merchantCurrent?.id,quantities};
    },{timeout:30_000}).toEqual({job:order.jobId,quantities:[9999,9999,9999,81]});
    const native=await live.admin(`output=Object.fromEntries(['${merchant}','${sender}'].map(n=>[n,get_player(n).items.filter(i=>i?.name==='candy0').reduce((q,i)=>q+i.q,0)]))`);
    expect(native).toEqual({[merchant]:30078,[sender]:0});
  } finally {
    await info.attach('native-active-exchange-stack-compression',{body:JSON.stringify({order,observations,state:await live.state(),merchant:await live.clients[merchant].snapshot(),sender:await live.clients[sender].snapshot(),events:await live.clients[merchant].events()}),contentType:'application/json'});
  }
  return order.jobId as string;
}

// M16 and M17 (live-exchange-collection.spec.ts 'party Exchange / Auto exchange hands selected
// native stock to the merchant').
async function partyExchangeRound(live: LiveGame, page: Page, info: TestInfo, automatic: boolean) {
    const fighter='E2EWarrior',checkpoints:any[]=[];
    live.clients[merchant].page.on('response',async response=>{if(new URL(response.url()).pathname.endsWith('/exchange-progress')){try{checkpoints.push(response.request().postDataJSON());}catch{}}});
    await expect.poll(async()=>(await live.state(true)).merchantCatalog?.exchangeable?.some((line:any)=>line.id==='armorbox'),{timeout:120_000}).toBe(true);
    await live.post('/config',{itemCollectionThreshold:1});
    await live.post('/merchant/force-stand',{enabled:true});
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'party collection':true,'automatic exchange':false,'auto compound':false}});
    await live.admin(`output=(()=>{const p=get_player('${fighter}');for(const [slot,item] of [[20,{name:'armorbox',q:1}],[21,{name:'armorbox',q:1,l:'l'}],[22,{name:'beewings',q:2}]]){if(p.items[slot])throw Error('Occupied fixture slot');p.items[slot]=item;}cache_player_items(p);resend(p,'reopen+cid');return p.items;})()`);
    await expect.poll(async()=>(await live.state()).characters[fighter]?.items?.find((entry:any)=>entry?.slot===20)?.item?.name,{timeout:30_000}).toBe('armorbox');
    await page.goto(live.url);
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:fighter,exact:true})});
    const tile=card.getByLabel('Armor Box',{exact:true}).first();
    await tile.click({button:'right'});
    await expect(page.getByRole('menuitem',{name:'Exchange',exact:true})).toBeVisible();
    await expect(page.getByRole('menuitem',{name:'Auto exchange',exact:true})).toBeVisible();
    await page.getByRole('menuitem',{name:automatic?'Auto exchange':'Exchange',exact:true}).click();
    let pending=await live.state();
    if(automatic){
      await expect(tile).toContainText('Auto exchange');
      await live.post('/merchant/force-stand',{enabled:false});
      await waitForGameplay(10_000);
      expect((await live.clients[fighter].snapshot()).items[20]?.q).toBe(1);
      await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'automatic exchange':true}});
    }else{
      const matchingPickup=(state:any,exchangeId?:string,pickupId?:string)=>{
        const jobs=[...state.merchantQueue,...(state.merchantCurrent?[state.merchantCurrent]:[])];
        const exchange=jobs.find((job:any)=>job.reason==='exchange'&&job.exchangePickupId&&(!exchangeId||job.id===exchangeId));
        return exchange&&(!pickupId||exchange.exchangePickupId===pickupId)&&jobs.some((job:any)=>job.id===exchange.exchangePickupId&&job.exchangeDeliveryId===exchange.id);
      };
      await expect.poll(async()=>{pending=await live.state();return !!matchingPickup(pending);},{timeout:30_000}).toBe(true);
      const exchange=pending.merchantQueue.find((job:any)=>job.reason==='exchange'&&job.exchangePickupId)??pending.merchantCurrent;
      await live.restartCoordinator();
      await expect.poll(async()=>!!matchingPickup(await live.state(),exchange.id,exchange.exchangePickupId),{timeout:30_000}).toBe(true);
      await live.post('/merchant/force-stand',{enabled:false});
    }
    await expect.poll(async()=>(await live.clients[fighter].snapshot()).items.filter((item:any)=>item?.name==='armorbox'&&!item.l).length,{timeout:180_000}).toBe(0);
    await expect.poll(async()=>(await live.clients[merchant].snapshot()).items.filter((item:any)=>item?.name==='armorbox').length,{timeout:180_000}).toBe(0);
    await expect.poll(()=>checkpoints.some(checkpoint=>checkpoint.rewards?.length>0),{timeout:120_000}).toBe(true);
    const after=await live.clients[fighter].snapshot();
    expect(after.items[21]).toMatchObject({name:'armorbox',q:1,l:'l'});
    expect(after.items[22]).toMatchObject({name:'beewings',q:2});
    await live.post('/merchant/force-stand',{enabled:true});
    await live.admin(`output=(()=>{const p=get_player('${fighter}');if(p.items[20])throw Error('Occupied follow-up slot');p.items[20]={name:'armorbox',q:1};cache_player_items(p);resend(p,'reopen+cid');return p.items;})()`);
    await expect.poll(async()=>(await live.state()).characters[fighter]?.items?.find((entry:any)=>entry?.slot===20)?.item?.q,{timeout:30_000}).toBe(1);
    if(automatic){
      await tile.click({button:'right'});
      await page.getByRole('menuitem',{name:'Auto mark for merchant',exact:true}).click();
      await expect.poll(async()=>(await live.state()).autoExchanges?.['armorbox@0']).toBeUndefined();
    }
    await live.post('/merchant/force-stand',{enabled:false});
    if(automatic){
      await expect.poll(async()=>(await live.clients[merchant].snapshot()).items.filter((item:any)=>item?.name==='armorbox').length,{timeout:120_000}).toBe(1);
      await waitForGameplay(10_000);
      expect((await live.clients[merchant].snapshot()).items.filter((item:any)=>item?.name==='armorbox')).toHaveLength(1);
    }else{
      await waitForGameplay(10_000);
      expect((await live.clients[fighter].snapshot()).items[20]).toMatchObject({name:'armorbox',q:1});
    }
    expect((await live.clients[fighter].events()).filter((event:any)=>event.event==='game_response'&&event.data?.place==='exchange')).toHaveLength(0);
    await info.attach('party-exchange-native',{body:JSON.stringify({automatic,pending,after,checkpoints,state:await live.state(),merchantEvents:await live.clients[merchant].events(),fighterEvents:await live.clients[fighter].events()}),contentType:'application/json'});
    await info.attach('party-exchange-dashboard',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
}
