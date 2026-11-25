import type {Page, TestInfo} from '@playwright/test';
import { expect, type LiveGame } from './live-fixtures';
import type { Item } from '../runtime/coordinator/contracts/item';

// W56's one stand session (test-windows DESIGN.md 2.2 W56), the bodies of live-economy.spec.ts's
// stand and WTB tests at 21fe30a2b:
//  1. the merchant relogs at level 80 and reports the game's 30 trade slots (A62);
//  2. its first stand point is valid and saved, a wall point is refused, the player sets 80, 80 on
//     the dashboard and the merchant walks there and opens its stand (A38);
//  3. a persisted reservation with no native identity is retried live after the restart (A56);
//  4. one covered stand bid queues its funding at most once across six other jobs (A39);
//  5. a bid above the carried gold withdraws bank funding, and a reopened stand reconciles the
//     replaced offer (A55).
// A56 runs before the live bids of A39 and A55: its seed is one blocked offer and its check reads
// one leather WTB slot, which a live offer from an earlier round would make two.
const merchant = 'E2EMerchant';
const names = ['E2EWarrior', 'E2EPriest', merchant];
type Items = (Item | null)[];
export type Economy = {
  characters: Record<string, { map: string; gold: number; isize: number; items: Items; upgrading: boolean }>;
  bank: Record<string, Items>;
  savedBank: Record<string, Items>;
  bankGold: number;
};
export const quantity = (items: Items, id: string) => items.reduce((total, item) => total + (item?.name === id ? Number(item.q) || 1 : 0), 0);
export const bankQuantity = (state: Economy, id: string) => Object.values(state.bank).reduce((total, items) => total + quantity(items, id), 0);
const totalGold = (state: Economy) => state.bankGold + Object.values(state.characters).reduce((total, character) => total + character.gold, 0);

export async function economy(live: LiveGame): Promise<Economy> {
  // A mounted bank is authoritative in server memory until native unmount saves it.
  // Reading only MongoDB during a bank visit would mistake normal persistence lag for loss.
  let observed:Economy|null=null;
  await expect.poll(async()=>{
    observed=await live.admin(`output=(async()=>{
    const m=get_player(${JSON.stringify(merchant)});
    if(!m || ${JSON.stringify(names)}.some(name=>!get_player(name)))return null;
    const user=await db.collection('user').findOne({_id:m.owner});
    const mounted=Object.values(players).find(p=>p.owner===m.owner&&p.user);
    const bank=mounted?mounted.user:user.info;
    const packs=value=>Object.fromEntries(Object.entries(value).filter(([key,items])=>/^items[0-9]+$/.test(key)&&Array.isArray(items)));
    return {characters:Object.fromEntries(${JSON.stringify(names)}.map(name=>{
      const p=get_player(name);return [name,{map:p.map,gold:p.gold,isize:p.isize,items:p.items,upgrading:!!p.q.upgrade}];
    })),bank:packs(bank),savedBank:packs(user.info),bankGold:Number(bank.gold)||0};
  })()`);
    return !!observed;
  },{timeout:30_000,message:'All native account characters must be present for an authoritative economy sample'}).toBe(true);
  return observed!;
}

export async function record(live: LiveGame, info: TestInfo, name: string, before: Economy, details: unknown = {}) {
  await info.attach(name, { body: JSON.stringify({ before, after: await economy(live), details, coordinator: await live.state() }, null, 2), contentType: 'application/json' });
}

export async function seed(live: LiveGame, items: Record<number, Item>) {
  await live.admin(`output=(()=>{
    const p=get_player(${JSON.stringify(merchant)}),items=${JSON.stringify(items)};
    for(const slot of Object.keys(items)){if(p.items[slot])throw Error('Seed would overwrite occupied slot '+slot);p.items[slot]=items[slot];}
    cache_player_items(p);calculate_player_stats(p);resend(p,'reopen+cid');return p.items;
  })()`);
  await expect.poll(async () => {
    const current = await live.clients[merchant].snapshot();
    const state = await live.state();
    return Object.entries(items).every(([slot, item]) => current.items[Number(slot)]?.name === item.name &&
      state.characters[merchant]?.items?.some((entry: { slot: number; item: Item } | null) => entry?.slot === Number(slot) && entry.item?.name === item.name));
  }, { timeout: 30_000, message: 'Native client and coordinator must observe initial inventory before commands' }).toBe(true);
}

export async function catalog(live: LiveGame, id: string) {
  await expect.poll(async () => (await live.state(true)).merchantCatalog?.buyable?.some((item: { id: string }) => item.id === id),
    { timeout: 120_000, message: `Native merchant must publish the ${id} NPC catalog entry` }).toBe(true);
}

export async function jobFinished(live: LiveGame, id?: string, timeout = 150_000) {
  await expect.poll(async () => {
    const state = await live.state();
    const jobs = [state.merchantCurrent, ...(state.merchantQueue || [])].filter(Boolean);
    return id ? !jobs.some(job => job.id === id || job.commerceOrderId === id) : jobs.length === 0;
  }, { timeout, message: 'Requested merchant work must leave both active and queued state' }).toBe(true);
}

export async function standSessionPlay(live: LiveGame, page: Page, info: TestInfo) {
  const level=async(value:number)=>{
    const replaced=await live.admin(`output=(async()=>{const c=await db.collection('character').findOne({'info.name':'${merchant}'});
      const before=c.level;c.level=${value};await db.collection('character').replaceOne({_id:c._id},c);return before;})()`);
    await live.reconnectClient(merchant);
    return Number(replaced);
  };
  const original=await level(80);
  try {
    await expect.poll(async()=>(await live.state()).characters[merchant]?.standSlots,{timeout:120_000}).toBe(30);
    await info.attach('IT21 stand slots',{body:JSON.stringify({original,slots:30}),contentType:'application/json'});
    await standLocationRound(live, page, info);
    await unconfirmedReservationRound(live, info);
    await standFundingRound(live, info);
    await wtbFundingRound(live, info);
  } finally {
    await level(original);
  }
}

// A38 ('merchant stand location is valid at first setup and stays saved through restart').
async function standLocationRound(live: LiveGame, page: Page, info: TestInfo) {
  // Failure modes: a shared constant survives first setup; a wall point is saved;
  // restart rerolls coordinates; settings never reach native stand movement.
  const first = (await live.state()).merchantStandLocation;
  expect(first.map).toBe('main');
  expect(first.x).toBeGreaterThanOrEqual(-100); expect(first.x).toBeLessThanOrEqual(100);
  expect(first.y).toBeGreaterThanOrEqual(-100); expect(first.y).toBeLessThanOrEqual(100);
  expect(await live.clients[merchant].run(`can_move({map:'main',x:${first.x},y:${first.y},going_x:${first.x},going_y:${first.y},base:character.base})`)).toBe(true);
  await live.restartCoordinator();
  expect((await live.state()).merchantStandLocation).toEqual(first);
  const blocked = await live.clients[merchant].run(`(()=>{const l=G.geometry.main.x_lines[0];return {map:'main',x:l[0],y:(l[1]+l[2])/2}})()`);
  await expect(live.post('/merchant/stand-location', blocked)).rejects.toThrow(/clear|geometry|blocked|valid/i);
  expect((await live.state()).merchantStandLocation).toEqual(first);
  await page.goto(live.url);
  await page.getByText(/Merchant logistics ·/).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Stand X', { exact: true }).fill('80');
  await page.getByLabel('Stand Y', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Save stand location', exact: true }).click();
  await expect.poll(async () => (await live.state()).merchantStandLocation).toEqual({ map: 'main', x: 80, y: 80 });
  await info.attach('merchant-stand-location-settings', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await seed(live,{10:{name:'stand0'}});
  await live.post('/merchant/force-stand', { enabled: true });
  await expect.poll(async () => {
    const c = await live.clients[merchant].snapshot();
    return c.map === 'main' && Math.hypot(c.x-80,c.y-80) <= 35 && await live.clients[merchant].run('!!character.stand');
  }, { timeout: 90_000 }).toBe(true);
  await live.restartCoordinator();
  expect((await live.state()).merchantStandLocation).toEqual({ map: 'main', x: 80, y: 80 });
  await info.attach('merchant-stand-location-native', { body: JSON.stringify({ first, blocked, client: await live.clients[merchant].snapshot(), state: await live.state(), events: await live.clients[merchant].events() }), contentType: 'application/json' });
}

// A56 ('native WTB retries an empty never-confirmed reservation after restart without counting a fill').
async function unconfirmedReservationRound(live: LiveGame, info: TestInfo) {
  await catalog(live,'hpot0');
  // Slot 10 holds round 2's stand0.
  const before=await economy(live);
  await live.restoreHistoricalSettings(()=>({
    standBids:{leather:{price:1000,quantity:3,minimumQuality:0,useStandSlot:true,revision:1}},
    nativeStand:{sequence:1,offers:{'native-1':{token:'native-1',itemId:'leather',auto:false,slot:'trade1',revision:1,level:0,price:1000,quantity:3,acknowledged:0,phase:'blocked',problem:'Offer disappeared without a confirmed fill/removal; reconciliation required'}},problems:{}},
  }));
  await expect.poll(async ()=>Object.values((await live.state()).nativeStand.offers).some((offer:any)=>offer.itemId==='leather' && offer.phase==='live' && offer.rid && !offer.problem),{timeout:90_000}).toBe(true);
  const state=await live.state(), current=await live.clients[merchant].snapshot();
  expect(state.standBids.leather.quantity).toBe(3);
  expect(Object.values(current.slots).filter((item:any)=>item?.b && item.name==='leather')).toHaveLength(1);
  expect(totalGold(await economy(live))).toBe(totalGold(before));
  await record(live,info,'native-unconfirmed-wtb-recovered',before,{state,slots:current.slots});
  await info.attach('native-unconfirmed-wtb-recovered-stand',{body:await live.clients[merchant].page.screenshot(),contentType:'image/png'});
}

// A39 ('MJ15: one covered stand bid queues its funding once across six other jobs').
async function standFundingRound(live: LiveGame, info: TestInfo) {
  // Slot 10 holds round 2's stand0.
  await live.admin(`output=(()=>{const m=get_player(${JSON.stringify(merchant)});m.gold=20000;if(m.user)m.user.gold=Math.max(Number(m.user.gold)||0,500000);resend(m,'reopen+cid');return m.gold;})()`);
  await live.restoreHistoricalSettings(() => ({
    autoStandBuys: true,
    standBids: { leather: { price: 150000, quantity: 3, minimumQuality: 0, useStandSlot: true, revision: 1 } },
  }));
  await live.post('/merchant/force-stand', { enabled: true });
  await expect.poll(async () => live.clients[merchant].run('!!character.stand'), { timeout: 90_000 }).toBe(true);
  await live.post('/merchant/force-stand', { enabled: false });
  const jobs = Array.from({ length: 6 }, (_, index) => ({ id: 'mj15-' + index, target: merchant, reason: 'manual bank exchange', queuedAt: Date.now() + index }));
  await live.restoreHistoricalSettings(() => ({ merchantQueue: jobs }));
  const funding = new Set<string>();
  await expect.poll(async () => {
    const state = await live.state();
    for (const job of [state.merchantCurrent, ...state.merchantQueue]) if (job?.reason === 'native stand funding') funding.add(String(job.id));
    return [state.merchantCurrent, ...state.merchantQueue].some((job: any) => String(job?.id || '').startsWith('mj15-'));
  }, { timeout: 420_000, intervals: [1_000] }).toBe(false);
  // The merchant's command target includes the stand's funding, so a job that runs before the stand
  // reports short of it withdraws the funding itself and the stand never queues the job (08-09 design
  // 3.7, "the funding job is queued once per change of the bids, not once per job"). The row
  // allows that one job or none, and the stand stays funded after the six jobs.
  const carried = await live.admin(`output=get_player(${JSON.stringify(merchant)}).gold`);
  await info.attach('mj15-stand-funding', { body: JSON.stringify({ funding: [...funding], carried, state: await live.state() }), contentType: 'application/json' });
  expect(funding.size).toBeLessThanOrEqual(1);
  expect(carried).toBeGreaterThanOrEqual(150000);
}

// A55 ('native WTB withdraws bank funding and reconciles replaced offers after reopening').
async function wtbFundingRound(live: LiveGame, info: TestInfo) {
  await catalog(live,'hpot0');
  await expect.poll(async ()=>(await live.state(true)).merchantCatalog?.allItems?.some((entry:{id:string})=>entry.id==='leather'),{timeout:120_000}).toBe(true);
  // Slot 10 holds round 2's stand0.
  await live.post('/command',{character:merchant,type:'bank'});
  await jobFinished(live);
  // The old test read the bootstrap's 1 000 000 bank seed plus the merchant's deposit. Round 4's six
  // bank exchanges leave the merchant carrying 150 000 and the bank 870 000 (liveb-step10-run3.log),
  // so the bank visit reports the gold the bid's 10 000 shortfall withdraws.
  await expect.poll(async ()=>(await live.state()).bank?.gold,{timeout:30_000}).toBeGreaterThan(10000);
  const before=await economy(live);
  const price=before.characters[merchant].gold+10000;
  expect(before.bankGold).toBeGreaterThan(10000);
  await live.post('/merchant/bid',{itemId:'leather',price,quantity:3,minimumQuality:0,useStandSlot:true});
  await expect.poll(async ()=>{
    const current=await live.clients[merchant].snapshot();
    return Object.values(current.slots).some((item:any)=>item?.b && item.name==='leather' && item.price===price);
  },{timeout:180_000,message:'Merchant must withdraw native stand funding and advertise the order'}).toBe(true);
  await jobFinished(live);
  const funded=await economy(live);
  expect(funded.characters[merchant].gold).toBeGreaterThanOrEqual(price);
  expect(totalGold(funded)).toBe(totalGold(before));
  const ledger=(await live.state()).nativeStand;
  const offer=Object.values(ledger.offers).find((entry:any)=>entry.itemId==='leather') as {slot:string;rid:string;token:string};
  expect(offer).toBeTruthy();
  // Real game mutations, no synthesized acknowledgements or heartbeat state.
  await live.clients[merchant].run(`(async()=>{await unequip(${JSON.stringify(offer.slot)});await wishlist(${JSON.stringify(offer.slot)},'leather',${price},0,3);await close_stand();await open_stand();})()`);
  await expect.poll(async ()=>{
    const state=await live.state(), offers=Object.values(state.nativeStand.offers) as any[];
    return offers.some(entry=>entry.itemId==='leather' && entry.phase==='live' && entry.rid!==offer.rid && !entry.problem);
  },{timeout:45_000,message:'Reopened native identity must reconcile without an inferred purchase'}).toBe(true);
  const after=await live.state();
  expect(after.standBids.leather.quantity).toBe(3);
  expect(Object.values((await live.clients[merchant].snapshot()).slots).filter((item:any)=>item?.b && item.name==='leather')).toHaveLength(1);
  await record(live,info,'native-wtb-funding-and-reconciliation',before,{funded,originalOffer:offer,after});
  await info.attach('native-wtb-reopened-stand',{body:await live.clients[merchant].page.screenshot(),contentType:'image/png'});
}
