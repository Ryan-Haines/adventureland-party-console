import {expect, type LiveGame} from '../live-fixtures';
import type {Page, Request, Route} from '@playwright/test';
import {liveWindow, type LiveWorld} from '../windows';
import {location, party, quantity, observed} from '../game/hunt-lifecycle';
import {seedCargo, spawnGoo, totalLeather} from '../hunt-interruption-helpers';
import {waitForGameplay} from '../network-clock';
import {ITEMS_HOOKS_ADDON, type Heard} from '../fixtures/items-hooks-addon';
import {RESTOCK_DEFAULT} from '../../runtime/items/saved-fields.ts';

// W03 Goo farm with the merchant visiting the fighters (test-windows DESIGN.md 2.2 W03). One play:
// the merchant works one planted errand after another, the warrior and priest farm goo on Main
// from M03 on, and one coordinator restart at the end serves every "survives restart" read.
// The order: the start seeds the bank and A49's gloves, arms A49's held merchant inventory and
// writes the rules and A49's delivery in one historical settings write (a coordinator start);
// A49's failed equip reconciles and the retained gloves are delivered and equipped; A57's
// full-bag cleanout of the warrior carries A9's bank NPC sale of helmets; C14 gives a helmet;
// M59's stat scroll turns a dex helmet str and delivers it; the farm starts; M03's leather goes
// to the merchant while the warrior fights; one collection takes A58's twelve wbreeches for one
// +1 and A59's twelve dexrings for one compound; M29's claims, reads and collection; M05 restocks
// the warrior's stored Liquid Luck, M06 buys the priest's, M07 crafts the priest an Elixir of
// Fire Resistance; M29's WTB source, stand and mail; the restart.
// The farm starts after M59: C14 and M59 sum the gold of all three characters and the bank
// (live-game.spec.ts:333, live-stat-scroll-bank.spec.ts:61), which the fighters' loot would move.
// A57's cleanout comes before C14 and M59, so it never takes their helmets from the warrior's bag,
// and A9's sale runs before any other helmet reaches the merchant's stock. A58 and A59 use items
// no fighter carries and no goo or map table drops (G drops.monsters.goo, drops.maps), so their
// counts read only the seeded copies.
// Failure modes: C14, a give creates or loses a copy or adds a bank leg; A49, a failed equip
// loses or duplicates the retained stock; M59, the scroll is bought again or gold moves; M03, the
// handoff stops the fight or loses leather; A58 and A59, a copy stays behind or the finite rule
// runs twice; M29, an items hook is not asked or a notice not heard; A57, the Tracktrix leaves the
// final cell or a feather is lost; A9, the sale sells more than the excess; M05-M07, an elixir is
// bought, crafted or used more than once, or its policy is lost on the restart.
// Each check's assertions are its old test's, with their messages, so the coverage ledger matches
// them. A failed step records its message under its check and the play goes on.
// Every old spec this window cites is at 21fe30a2b.
const W = 'E2EWarrior', P = 'E2EPriest', M = 'E2EMerchant', merchant = M, names = [W, P, M];
type Item = {name: string; level?: number; q?: number; stat_type?: string; l?: string; b?: boolean};
type Items = (Item | null)[];
type Economy = {
  characters: Record<string, {map: string; gold: number; isize: number; items: Items; upgrading: boolean}>;
  bank: Record<string, Items>;
  savedBank: Record<string, Items>;
  bankGold: number;
};
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
const step = async (id: string, run: () => Promise<unknown>) => {
  try { await run(); } catch (error) { failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); }
};

// The old economy reads (live-economy.spec.ts).
const bankQuantity = (state: Economy, id: string) => Object.values(state.bank).reduce((total, items) => total + quantity(items, id), 0);
async function economy(live: LiveGame): Promise<Economy> {
  // A mounted bank is authoritative in server memory until native unmount saves it.
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
async function seed(live: LiveGame, items: Record<number, Item>) {
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
async function catalog(live: LiveGame, id: string) {
  await expect.poll(async () => (await live.state(true)).merchantCatalog?.buyable?.some((item: { id: string }) => item.id === id),
    { timeout: 120_000, message: `Native merchant must publish the ${id} NPC catalog entry` }).toBe(true);
}
async function jobFinished(live: LiveGame, id?: string, timeout = 150_000) {
  await expect.poll(async () => {
    const state = await live.state();
    const jobs = [state.merchantCurrent, ...(state.merchantQueue || [])].filter(Boolean);
    return id ? !jobs.some(job => job.id === id || job.commerceOrderId === id) : jobs.length === 0;
  }, { timeout, message: 'Requested merchant work must leave both active and queued state' }).toBe(true);
}
async function restartAndObserve(live: LiveGame) {
  const startedAt = Date.now();
  await live.restartCoordinator();
  await expect.poll(async () => (await live.state()).characters[merchant]?.seenAt,
    { timeout: 30_000, message: 'Replay assertions require a native heartbeat accepted after restart' }).toBeGreaterThan(startedAt);
  await jobFinished(live);
}

const bag = (live: LiveGame, name: string) => live.admin(`output=(p=>({items:p.items,slots:p.slots,isize:p.isize}))(get_player(${JSON.stringify(name)}))`) as Promise<{items: any[]; slots: Record<string, any>; isize: number}>;
const items = async (live: LiveGame, name: string) => await live.admin(`output=get_player(${JSON.stringify(name)}).items`) as any[];
// The first empty cells of a bag below its final cell, which A57's Tracktrix keeps.
const freeCells = async (live: LiveGame, name: string, count: number) => {
  const b = await bag(live, name), cells: number[] = [];
  for (let i = 0; i < b.isize - 1 && cells.length < count; i++) if (!b.items[i]) cells.push(i);
  if (cells.length < count) throw Error(`${name} needs ${count} free cells, has ${cells.length}`);
  return cells;
};
const put = (live: LiveGame, name: string, cells: Record<number, unknown>) => live.admin(`output=(()=>{const p=get_player(${JSON.stringify(name)}),cells=${JSON.stringify(cells)};
  for(const [slot,item] of Object.entries(cells)){if(item&&p.items[slot])throw Error('occupied cell '+slot);p.items[Number(slot)]=item;}cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
// An old test's fixed cell (M03's leather in cell 10, C14's helmet, M06's potion in cell 20) moves
// whatever the play left there to a free cell of the same bag, so every count stays whole.
const freeCell = (live: LiveGame, name: string, cell: number) => live.admin(`output=(()=>{const p=get_player(${JSON.stringify(name)});if(!p.items[${cell}])return true;
  const to=p.items.findIndex((i,n)=>!i&&n!==${cell}&&n<p.isize-1);if(to<0)throw Error('no free cell for '+${cell});p.items[to]=p.items[${cell}];p.items[${cell}]=null;cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
const reported = async (live: LiveGame, name: string, slot: number, wanted: string | null) =>
  await expect.poll(async () => ((await live.state()).characters?.[name]?.items?.[slot]?.item?.name ?? null), { timeout: 60_000, intervals: [500] }).toBe(wanted);
const routines = (live: LiveGame, enabled: Record<string, boolean>, priorities: Record<string, number> = {}) => live.post('/merchant/routine-priorities', {priorities, enabled});
const standing = (live: LiveGame, enabled: boolean) => live.post('/merchant/force-stand', {enabled});

// M29's fixture add-on (e2e/fixtures/items-hooks-addon.ts) on the coordinator.
const fixture = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-items-hooks', body);
const heard = async (live: LiveGame, since: number) => await fixture(live, {op: 'heard', since}) as Heard[];
const ask = async (live: LiveGame, hook: string, args: unknown[] = []) => (await fixture(live, {op: 'ask', hook, args}) as {answer: any}).answer;
const of = (list: Heard[], hook: string) => list.filter(h => h.hook === hook);
let since = 0;

// Each check's state that its restart reads need.
const A49_ID = 'interrupted-delivery-equip', GLOVES: Item = {name: 'gloves', level: 0};
const later: {
  a49?: {receipts: {character: string; results: {deliveryId?: string; success: boolean}[]}[]; countCargo: () => Promise<number>};
  a57?: Economy; a9?: () => Promise<unknown>; c14?: {completed: () => Promise<boolean>; total: number};
  finite?: {name: string; completed: unknown[]; count: () => Promise<Item[]>}[];
} = {};

// The start: the bank seeds, A49's held inventory, the rules, the delivery and the add-on.
// The merchant's own hp potions at its policy's max. M29's hpot1 bank mark banks the merchant's own
// stack with the collected ones (livea-w03-w21-w23-run1: "Banked hpot1 from merchant inventory" at
// M29's collection, then "Merchant dispatched to restock its potions" during M05), so the elixir
// errands top it up again.
async function ownPotions(live: LiveGame) {
  const own = (await live.state()).restockPolicies?.[M]?.hp ?? RESTOCK_DEFAULT.hp;
  const carried = quantity((await observed(live))[M].items, own.item);
  if (carried >= own.max) return;
  const [cell] = await freeCells(live, M, 1);
  await put(live, M, {[cell!]: {name: own.item, q: own.max - carried}});
}
async function start(live: LiveGame) {
  await party(live);
  since = Date.now();
  // The elixir receipts and uses (live-elixir-restock.spec.ts); each errand empties its arrays.
  await elixirLogs(live, merchant, W);
  await elixirLogs(live, merchant, P);
  live.undo('the elixir logs', async () => { for (const name of names) await live.clients[name].run(`(()=>{const s=parent.socket;for(const k of ['__e2eElixirreceipts','__e2eElixiruses'])if(s[k]){s.off('game_response',s[k]);delete s[k];}
    delete globalThis.__elixirReceipts;delete globalThis.__elixirUses;return true;})()`).catch(() => null); });
  // A9's helmets and smoke in the bank (live-bank-npc-sales.spec.ts) and the merchant's stand. The
  // bank visit sorts the bank, so A9's read of its cell 6 holds only when no other seed sits
  // beside them: M05's elixir and M59's scroll are seeded at their errands, as their old tests did.
  await live.admin(`output=(async()=>{const m=get_player('${M}');
    const bank={'info.items0.5':{name:'smoke',q:100},'info.items0.6':{name:'smoke',q:100}};
    for(let i=0;i<5;i++)bank['info.items0.'+i]={name:'helmet',level:0};
    await db.collection('user').updateOne({_id:m.owner},{$set:bank});return true;})()`);
  // The merchant's own restock queues when its carried hp potions fall to the policy's min
  // (merchant-jobs/coordinator/sources.ts:592 `needsSupply`), and its buy funds from the bank
  // (items/character/market.ts:195 `fund`). In step5-run1 that restock ran inside M05's errand and
  // C14's give. The merchant starts at its policy's max, so it restocks only for an errand.
  const [stand] = await freeCells(live, M, 1);
  await put(live, M, {[stand!]: {name: 'stand0'}});
  await ownPotions(live);
  await live.post('/command', {character: M, type: 'bank'});
  await expect.poll(async()=>(await live.state()).bank?.packs?.items0?.[6]?.item?.q,{timeout:90_000}).toBe(100);
  await expect.poll(async()=>(await live.state()).merchantCurrent,{timeout:90_000}).toBeNull();
  await standing(live, true);
  // A49 (live-economy.spec.ts, the retained variant): the merchant's inventory reports are held
  // across the failed equip, so its reconciliation reads stock the coordinator has not seen.
  const recipient = W, item = GLOVES, retained = true;
  let holdInventory = false, withheldReports = 0;
  const context = live.clients[recipient].page.context();
  const holdRoute = async (route: Route) => {
    const body = route.request().postDataJSON();
    if (holdInventory && body.name === merchant && Array.isArray(body.items)) {
      withheldReports++;
      return route.abort('connectionfailed');
    }
    return route.fallback();
  };
  await context.route('**/party-api/status', holdRoute);
  const receipts: {character: string; results: {deliveryId?: string; success: boolean; error?: string}[]}[] = [];
  live.clients[recipient].page.on('request', (request: Request) => {
    if (new URL(request.url()).pathname.endsWith('/equip-delivery-complete')) {
      const receipt = request.postDataJSON();
      receipts.push(receipt);
      if (receipt.results.some((result: {success: boolean}) => !result.success)) holdInventory = true;
    }
  });
  const [cell] = await freeCells(live, M, 1);
  await seed(live, {[cell!]: item});
  reads.A49 = {before: await economy(live).then(e => e.bankGold)};
  const cargo = () => live.admin(`output=${JSON.stringify(names)}.map(name=>{
        const p=get_player(name);return {name,items:p.items,slots:p.slots};
      })`);
  const countCargo = (players: {items: Items; slots: Record<string, Item | null>}[]) => players.reduce((sum, p) =>
    sum + [...p.items, ...Object.values(p.slots)].filter(value => value?.name === item.name && value.level === item.level).length, 0);
  await step('A49', async () => expect(countCargo(await cargo())).toBe(retained ? 1 : 0));
  holdInventory = true;
  live.holdMerchantStatus(true, {inventoryOnly:true});
  await live.post('/config', {itemCollectionThreshold: 10});
  // A58 and A59's rules and A49's interrupted delivery are historical intent; the native clients
  // make every transfer, equip and production.
  await live.restoreHistoricalSettings(() => ({
    autoItemMarks: {[M]: {'wbreeches@+0': 'merchant', 'dexring@+0': 'merchant'}},
    autoUpgradeMarks: {[M]: {'wbreeches@+0': {tiers: 1, quantity: 1}}},
    autoCompounds: {[M]: [{name: 'dexring', targetTier: 1, quantity: 1}]},
    merchantDeliveries: {[recipient]: [{id: A49_ID, item, slot: cell, equipOnDelivery: true, awaitingEquip: true}]},
  }));
  // The add-on joins the coordinator's registry in its process, so it registers after that start.
  expect(await fixture(live, {op: 'register'}), 'the items add-on registers').toEqual({ok: true});
  const before = (await live.state()).addons || {};
  await live.post('/settings', {changes: [{field: 'addons', value: {...before, [ITEMS_HOOKS_ADDON]: {enabled: true, settings: {}}}}]});
  live.undo('the items fixture add-on switch', () => live.post('/settings', {changes: [{field: 'addons', value: before}]}));
  live.undo("the items fixture's answers", () => fixture(live, {op: 'answers', claims: [], actions: {}, listings: []}).catch(() => null));

  await step('A49', async () => {
    const id = A49_ID;
    try {
      await expect.poll(() => receipts.some(receipt => receipt.character === recipient &&
        receipt.results.some(result => result.deliveryId === id && !result.success)),
      { timeout: 45_000, message: 'Native recipient must fail to equip the absent delivery' }).toBe(true);
      await expect.poll(async () => (await live.state()).merchantDeliveries?.[recipient]?.[0]?.equipFailedAt).toBeGreaterThan(0);
      await waitForGameplay(12_000);
      expect(withheldReports).toBeGreaterThan(0);
      expect((await live.state()).merchantDeliveries[recipient]).toMatchObject([{ id, awaitingEquip: true }]);
    } finally {
      live.holdMerchantStatus(false, {inventoryOnly:true});
      holdInventory = false;
      await context.unroute('**/party-api/status', holdRoute);
    }
    await expect.poll(async () => {
      const marks = (await live.state()).merchantDeliveries?.[recipient] || [];
      return retained ? marks.length === 1 && !marks[0].awaitingEquip && marks[0].id !== id : marks.length === 0;
    }, { timeout: 20_000, message: 'Failed equip must reconcile against merchant stock' }).toBe(true);
    await routines(live, {deliveries: true});
    await standing(live, false);
    await expect.poll(async () => (await cargo()).find((p: { name: string }) => p.name === recipient)?.slots.gloves,
      { timeout: 150_000, message: 'Retained cargo must be delivered and equipped by native clients' }).toMatchObject(item);
    await expect.poll(async () => (await live.state()).merchantDeliveries?.[recipient] || [], { timeout: 30_000 }).toEqual([]);
    await jobFinished(live);
  });
  later.a49 = {receipts, countCargo: async () => countCargo(await cargo())};
}

// A57's full-bag cleanout of the warrior (live-economy.spec.ts), which A9's bank NPC sale rides
// (live-bank-npc-sales.spec.ts).
async function cleanout(live: LiveGame) {
  const target = W, samples: any[] = [];
  await standing(live, true);
  let before: Economy | undefined;
  await step('A57', async () => {
    const seeded = await live.admin(`output=(()=>{
    const w=get_player('E2EWarrior'),m=get_player('E2EMerchant');
    if(w.items[w.isize-1]||m.items[m.isize-1])throw Error('Tracker seed slots occupied');
    w.items[w.isize-1]={name:'tracker'};m.items[m.isize-1]={name:'tracker'};
    for(let i=0;i<w.isize;i++)if(!w.items[i])w.items[i]={name:'feather0',q:1};
    for(const p of [w,m]){cache_player_items(p);calculate_player_stats(p);resend(p,'reopen+cid');}
    return {warrior:w.items,merchant:m.items};
  })()`);
    await expect.poll(async () => {
      const current=await economy(live);
      return ['E2EWarrior',merchant].every(name=>current.characters[name].items[current.characters[name].isize-1]?.name==='tracker');
    }, {timeout:30_000}).toBe(true);
    before = later.a57 = await economy(live);
    expect(quantity(before.characters.E2EWarrior.items,'tracker')).toBe(1);
    // The old `expect(before.characters.E2EWarrior.items.filter(Boolean)).toHaveLength(43)` read a
    // 43-cell bag; this fixture's warrior carries 42 (isize), so the full bag reads isize.
    expect(before.characters.E2EWarrior.items.filter(Boolean)).toHaveLength(before.characters.E2EWarrior.isize);
    expect(quantity(before.characters.E2EWarrior.items,'feather0')).toBe(quantity(seeded.warrior,'feather0'));
  });
  await live.post('/merchant/auto-npc-sale',{item:{name:'helmet',level:0},keep:2});
  await live.post('/merchant/auto-npc-sale',{item:{name:'smoke'},keep:150});
  // The sale routine stays off until a real cleanout visit owns the merchant.
  await live.post('/merchant/routine-priorities',{priorities:{'auto npc sales':98,'inventory cleanout':95,withdrawals:10},enabled:{'inventory cleanout':true,withdrawals:true,'auto npc sales':false}});
  await live.post('/merchant/cleanout', {character: target});
  await standing(live, false);
  await step('A9', async () => {
    await expect.poll(async()=>(await live.state()).merchantCurrent?.reason,{timeout:120_000}).toBe('inventory cleanout');
    // Enable while a real party visit owns the merchant. Its bank-sale
    // prerequisite must become visible before that visit finishes.
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':true}});
    await expect.poll(async()=>{
      const state=await live.state();
      samples.push({at:Date.now(),current:state.merchantCurrent,queue:state.merchantQueue,withdrawals:state.withdrawals[merchant]});
      return state.merchantQueue.some((job:any)=>job.reason==='withdrawals'&&job.target===merchant&&job.priority===98)&&
        state.withdrawals[merchant].filter((mark:any)=>mark.autoNpcRuleKey).length===4;
    },{timeout:15_000}).toBe(true);
  });
  reads.A9 = {samples: samples.slice(-5)};
  await step('A57', async () => {
    await expect.poll(async () => quantity((await economy(live)).characters.E2EWarrior.items,'feather0'),
      {timeout:150_000}).toBeLessThan(quantity(before!.characters.E2EWarrior.items,'feather0'));
  });
  const native=()=>live.admin(`output=(async()=>{const p=get_player('${merchant}'),u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;const items=[...p.items,...Object.entries(u).filter(([k,v])=>/^items\\d+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v)].filter(Boolean);return {helmets:items.filter(i=>i.name==='helmet').length,smoke:items.filter(i=>i.name==='smoke').reduce((n,i)=>n+(i.q||1),0)}})()`);
  later.a9 = native;
  await step('A9', async () => {
    await expect.poll(native,{timeout:240_000}).toEqual({helmets:2,smoke:150});
    await expect.poll(async()=>{
      const receipts=(await live.clients[merchant].events()).filter(entry=>entry.event==='game_response'&&entry.data?.place==='sell'&&entry.data.success===true);
      return {helmets:receipts.filter(entry=>entry.data.item?.name==='helmet').length,smoke:receipts.filter(entry=>entry.data.item?.name==='smoke').reduce((n,entry)=>n+Number(entry.data.item.q||1),0)};
    },{timeout:30_000}).toEqual({helmets:3,smoke:50});
  });
  await step('M29', async () => {
    await expect.poll(async () => of(await heard(live, since), 'items.sold').length, { timeout: 300_000, intervals: [1000] }).toBeGreaterThan(0);
  });
  await step('A57', () => jobFinished(live));
  // The sale is done; C14's and M59's helmets reach the merchant's stock later, which the keep-2
  // rule would sell. A withdrawal left after the sale brought a kept helmet into the merchant's bag
  // during C14's give (w03-run5: C14 counted 2 helmets for its 1), so both routines go off.
  reads.A9.withdrawals = (await live.state()).withdrawals?.[merchant] ?? null;
  await routines(live, {'auto npc sales': false, withdrawals: false});
  // A carried copy the keep-2 rule keeps queues the merchant's bank exchange to bank it
  // (items/coordinator/market.ts:2511 `keptCopiesCarried`), whether or not the sale routine is on.
  // C14's planted helmet is such a copy (livea-w03-w21-w23-run1: an "Entered bank" 4 s after C14's
  // delivery). The helmet rule goes until the restart, whose A9 read needs both rules back.
  await live.post('/merchant/auto-npc-sale',{item:{name:'helmet',level:0},action:'remove'});
}

// C14 (live-game.spec.ts): one helmet given from the merchant's cell 10.
async function c14(live: LiveGame) {
  await step('C14', async () => {
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { deliveries: true } });
    // Zero gold targets would add a full bank deposit after the item transfer.
    const initialGold=await observed(live);
    for(const name of [W,M])await live.post('/command',{character:name,type:'gold-target',amount:initialGold[name].gold});
    await freeCell(live, M, 10);
    await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(M)});p.items[10]={name:'helmet',level:0};cache_player_items(p);resend(p,'u+cid+reopen');return p.items[10]})()`);
    await expect.poll(async () => (await live.state()).characters[M]?.items?.some((entry: any) => entry?.slot===10 && entry.item?.name==='helmet'), { timeout: 20_000 }).toBe(true);
    const before=await observed(live), total=names.reduce((sum,name)=>sum+quantity(before[name].items,'helmet'),0);
    const serviceStartedAt=Date.now(),gold=names.reduce((sum,name)=>sum+before[name].gold,0);
    await live.post('/command', { character:M,type:'give',target:W,slot:10,item:{name:'helmet',level:0} });
    await expect.poll(async()=>quantity((await observed(live))[W].items,'helmet'),{timeout:120_000}).toBe(quantity(before[W].items,'helmet')+1);
    const after=await observed(live);
    expect(names.reduce((sum,name)=>sum+quantity(after[name].items,'helmet'),0)).toBe(total);
    const completed = async () => { const state = await live.state(); return !state.merchantCurrent && !state.merchantQueue?.length && !state.merchantDeliveries?.[W]?.length; };
    await expect.poll(completed, { timeout: 30_000, message: 'The actual delivery must complete its durable job' }).toBe(true);
    expect((await live.state()).merchantActivity.some((entry:any)=>entry.at>=serviceStartedAt&&entry.message==='Entered bank'),
      'An item-only delivery with no bank cargo or surplus gold must not add a bank return leg').toBe(false);
    expect(names.reduce((sum,name)=>sum+after[name].gold,0)).toBe(gold);
    later.c14 = {completed, total};
  });
}

// M59 (live-stat-scroll-bank.spec.ts, the delivery variant): the banked STR scroll turns the
// merchant's dex helmet str before its higher priority delivery to the warrior.
async function m59(live: LiveGame) {
  const native = (live: LiveGame, scroll='strscroll') => live.admin(`output=(async()=>{const p=get_player('${merchant}');
  const u=p.user||(await db.collection('user').findOne({_id:p.owner})).info;
  const scrolls=list=>(list||[]).filter(i=>i&&i.name===${JSON.stringify(scroll)}).reduce((n,i)=>n+(i.q||1),0);
  const goldByCharacter=Object.fromEntries(['E2EWarrior','E2EPriest','${merchant}'].map(name=>[name,get_player(name).gold]));
  const bankGold=Number(u.gold)||0;
  return {helmet:p.items[20],gold:Object.values(goldByCharacter).reduce((sum,gold)=>sum+gold,bankGold),goldByCharacter,bankGold,carried:scrolls(p.items),
    bank:Object.entries(u).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).reduce((n,[,v])=>n+scrolls(v),0)};})()`);
  const deliver = true, stat = 'str', scroll = stat + 'scroll', completions: any[] = [], observations: any[] = [];
  reads.M59 = {observations};
  const observe = (request: Request) => { if (new URL(request.url()).pathname.endsWith('/merchant/complete')) completions.push(request.postDataJSON()); };
  live.clients[merchant].page.on('request', observe);
  await step('M59', async () => {
    try {
      await expect.poll(async () => Date.now() - ((await live.state()).characters[merchant]?.seenAt || 0), { timeout: 90_000 }).toBeLessThan(3_000);
      await freeCell(live, M, 20);
      const seeded = await live.admin(`output=(()=>{const p=get_player('${merchant}');p.items[20]={name:'helmet',level:0,stat_type:'dex'};cache_player_items(p);resend(p,'reopen+cid');return {item:p.items[20]};})()`);
      await expect.poll(async () => (await live.state()).characters[merchant]?.items?.find((entry: any) => entry?.slot === 20)?.item, { timeout: 30_000 })
        .toEqual({ name: 'helmet', level: 0, stat_type: 'dex' });
      // The one STR scroll goes in the bank's first free items0 cell (the old test's seed).
      await live.admin(`output=(async()=>{const p=get_player('${merchant}');
      if(p.items.some(i=>i&&i.name===${JSON.stringify(scroll)})) throw Error('Fixture requires no carried STR scrolls');
      const seed=info=>{const pack=info.items0||(info.items0=[]);const slot=pack.findIndex(i=>!i);
        if(slot<0&&pack.length>=42) throw Error('Fixture requires a free items0 slot');pack[slot<0?pack.length:slot]={name:${JSON.stringify(scroll)},q:1};};
      if(p.user) seed(p.user); else {const u=await db.collection('user').findOne({_id:p.owner});
        if(Object.values(u.info).some(v=>Array.isArray(v)&&v.some(i=>i&&i.name===${JSON.stringify(scroll)}))) throw Error('Fixture requires no banked STR scrolls');
        seed(u.info);await db.collection('user').replaceOne({_id:u._id},u);}
      return true;})()`);
      await live.post('/command',{character:merchant,type:'bank'});
      await expect.poll(async()=>Object.values((await live.state()).bank?.packs||{}).flat().some((entry:any)=>entry?.item?.name===scroll),{timeout:90_000}).toBe(true);
      await jobFinished(live);
      const before = await native(live,scroll);
      expect(before).toMatchObject({ carried: 0, bank: 1 });
      await standing(live, true);
      await live.post('/command', { character: merchant, type: 'stat-scroll-mark', slot: 20, item: { name: 'helmet', level: 0, stat_type: 'dex' }, statType: stat });
      await live.post('/merchant/routine-priorities',{priorities:{deliveries:100,'manual upgrades':1},enabled:{deliveries:true}});
      await live.post('/command',{character:merchant,type:'give',slot:20,item:seeded.item,target:'E2EWarrior'});
      expect((await live.state()).statScrolls[merchant]).toHaveLength(1);
      await expect.poll(async()=>{const state=await live.state();return state.merchantAutomations.deliveries===true && state.merchantDeliveries.E2EWarrior?.length===1 && state.statScrolls[merchant]?.length===1 && state.merchantRoutinePriorities.deliveries>state.merchantRoutinePriorities['manual upgrades'];},{timeout:30_000,message:'Both enabled intents and the delivery priority must persist before release'}).toBe(true);
      await standing(live, false);
      await expect.poll(async () => { const n = await native(live,scroll); observations.push({ at: Date.now(), n }); return deliver ? await live.admin(`output=get_player('E2EWarrior').items.find(i=>i&&i.name==='helmet'&&i.stat_type==='str')?.stat_type`) : n.helmet?.stat_type; },
        { timeout: 240_000, intervals: [500, 1000] }).toBe(stat);
      await expect.poll(()=>completions.flatMap(body=>body.statScrollsApplied||[]).filter((receipt:any)=>receipt.mark.statType===stat).length,{timeout:30_000}).toBe(1);
      expect(completions.flatMap(body=>body.statScrollsApplied||[])[0].item.stat_type).toBe(stat);
      const after = await native(live,scroll);
      // The banked scroll was used and nothing was bought; all three party balances plus the bank
      // hold exact conservation.
      expect(after).toMatchObject({ carried: 0, bank: 0 });
      expect(after.gold).toBe(before.gold);
      await jobFinished(live);
    } finally { live.clients[merchant].page.off('request', observe); await standing(live, false); }
  });
  observations.splice(0, Math.max(0, observations.length - 5));
}

async function farm(live: LiveGame) {
  const spot = await location(live, 'goo');
  await live.post('/navigate-to-monster', {monsterId: 'goo', location: spot});
  await live.post('/focus', {monsterFocus: ['goo'], monsterPriorities: {}, monsterSearchRadius: 400});
  await expect.poll(async () => { const c = (await live.state()).characters[W]; return !!c && Math.hypot(c.x - spot.x, c.y - spot.y) < 400 && c.map === spot.map; },
    {timeout: 120_000, message: 'the warrior reaches the goo field'}).toBe(true);
}

// M03 (live-combat-handoff.spec.ts): the warrior's marked leather goes to the merchant while it fights.
async function m03(live: LiveGame) {
  await step('M03', async () => { try {
    await live.post('/merchant/force-stand',{enabled:true});
    await live.post('/formation',{leader:W});
    await freeCell(live, W, 10);
    await seedCargo(live);
    const total=await totalLeather(live),monster=await spawnGoo(live,W,300,0,(await live.state()).farmingProfiles?.[W]?.location?.boundary);
    await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:400});
    // The farm gives the warrior other goos beside the planted one (w03-run5 heard no hit on the
    // planted goo in 45 s), so the warrior's hits on any monster read its fight.
    const hits=async()=> (await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&event.data?.hid===W&&event.data?.damage>0);
    reads.M03 = {monster: monster.id};
    await expect.poll(async()=>(await hits()).length,{timeout:45000}).toBeGreaterThan(0);
    const initialHits=(await hits()).length;
    await live.post('/bank-party',{group:W});
    await live.post('/merchant/force-stand',{enabled:false});
    await expect.poll(async()=>live.admin(`output=get_player(${JSON.stringify(M)})?.items.some(i=>i?.name==='leather'&&i.q>=7)`),{timeout:90000}).toBe(true);
    // The farm's goos die fast, so the read waits for the warrior's next target inside the old
    // 15 s hit window (w03-w05-w09-run4 read the warrior between two goos, target unset).
    let during:any;
    await expect.poll(async()=>(during=await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)}),m=p.target&&instances[p.in].monsters[p.target];return {monster:m&&{id:m.id,hp:m.hp},fighter:{x:p.x,y:p.y,hp:p.hp}}})()`)).monster?.id??null,{timeout:15000}).not.toBeNull();
    Object.assign(reads.M03, {during, initialHits});
    expect(during.monster?.hp).toBeGreaterThan(0);
    await expect.poll(async()=>(await hits()).length,{timeout:15000}).toBeGreaterThan(initialHits);
    expect(await totalLeather(live)).toBe(total);
    await expect.poll(async()=>(await live.state()).merchantMarked?.[W]?.length??0,{timeout:30000}).toBe(0);
    await jobFinished(live);
  // A failed step leaves the stand forced, which held every later errand (w03-run5, 05:47-06:08).
  } finally { await live.post('/merchant/force-stand',{enabled:false}); } });
}

// A58 and A59 (live-economy.spec.ts, the finite upgrade and compound rows) in one collection from the priest.
async function collection(live: LiveGame) {
  const owner = P, kinds = ['upgrade', 'compound'] as const;
  const of12 = {} as Record<string, number[]>;
  const finite = kinds.map(kind => {
    const name=kind==='upgrade'?'wbreeches':'dexring';
    // Every copy on the account, carried or banked: the merchant banks what it collects.
    const count=async()=>{const all=await economy(live);return [...Object.values(all.characters).flatMap(c=>c.items),...Object.values(all.bank).flat()].filter((i): i is Item=>i?.name===name)};
    return {kind, name, id: kind === 'upgrade' ? 'A58' : 'A59', count, completed: [] as Item[]};
  });
  later.finite = finite;
  await step('A58', () => catalog(live,'helmet')); // Catalog readiness; dexring is loot-only stock.
  // Failure inventory: the native promise resolves before its final player inventory arrives;
  // the hold delays only this compound's terminal inventory by 750 ms.
  await live.clients[merchant].run(`(()=>{
    globalThis.__e2eCompoundOutcomes=[];
    const socket=parent.socket,onevent=socket.onevent,pending=[];
    const fault=globalThis.__e2eCompoundPublication={heldAt:null,releasedAt:null,frames:0};
    let timer;
    fault.release=()=>{if(fault.releasedAt!==null)return;clearTimeout(timer);fault.releasedAt=Date.now();for(const packet of pending.splice(0))onevent.call(socket,packet);};
    socket.onevent=function(packet){
      const [event,data]=packet.data||[];
      if(event==='player'&&fault.releasedAt===null){
        if(fault.heldAt===null&&Array.isArray(data?.items)&&!data.q?.compound&&data.items.some(item=>item?.name==='dexring'&&item.level===1)){
          fault.heldAt=Date.now();timer=setTimeout(fault.release,750);
        }
        if(fault.heldAt!==null){pending.push(packet);fault.frames++;return;}
      }
      return onevent.call(socket,packet);
    };
    fault.restore=()=>{fault.release();if(socket.onevent!==onevent)socket.onevent=onevent;};
    parent.socket.on('game_response',data=>{
      const response=typeof data==='string'?data:data&&data.response;
      if(response==='compound_success'||response==='compound_fail')
        globalThis.__e2eCompoundOutcomes.push({at:Date.now(),response,data});
    });return true;
  })()`);
  live.undo('the compound publication hold', () => live.clients[merchant].run('(globalThis.__e2eCompoundPublication?.restore?.(),true)'));
  const cells = await freeCells(live, owner, 24);
  for (const [n, f] of finite.entries()) of12[f.name] = cells.slice(12 * n, 12 * n + 12);
  await live.admin(`output=(()=>{const p=get_player('${owner}'),plan=${JSON.stringify(of12)};for(const [name,slots] of Object.entries(plan))for(const i of slots){if(p.items[i])throw Error('cell '+i+' is occupied');p.items[i]={name,level:0};}cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
  for (const {id, name} of finite) await step(id, async () => {
    await expect.poll(async()=>(await live.clients[owner].snapshot()).items.filter((i:Item|null)=>i?.name===name).length).toBe(12);
    await expect.poll(async()=>(await live.state()).autoItemMarks?.[merchant]?.[name+'@+0']).toBe('merchant');
    await expect.poll(async()=>{
      const state=await live.state();
      const slots=(state.characters[owner]?.items||[]).filter((entry:any)=>entry?.item?.name===name&&entry.item.level===0).map((entry:any)=>entry.slot).sort((a:number,b:number)=>a-b);
      const marks=(state.merchantMarked[owner]||[]).filter((mark:any)=>mark?.item?.name===name&&mark.item.level===0).map((mark:any)=>mark.slot).sort((a:number,b:number)=>a-b);
      return {slots,marks};
    },{timeout:30_000,message:'Native ingredient inventory and all collection marks must publish before dispatch'}).toEqual({slots:of12[name],marks:of12[name]});
  });
  await routines(live, {'party collection': true, 'auto upgrade': true, 'auto compound': true});
  for (const {id, kind, name, count} of finite) await step(id, async () => {
    await expect.poll(async()=>(await live.clients[owner].snapshot()).items.filter((i:Item|null)=>i?.name===name).length,
      {timeout:180_000,message:'Every copy must reach the merchant through native collection'}).toBe(0);
    await expect.poll(async()=> {
      if((await count()).filter(i=>i?.level===1).length!==1)return false;
      if(kind!=='compound')return true;
      const outcomes=await live.clients[merchant].run('globalThis.__e2eCompoundOutcomes');
      return outcomes.some((event:any)=>event.response==='compound_success');
    },{timeout:kind==='upgrade'?180_000:90_000,message:kind==='compound'
      ?'Native inventory and the actual compound response must both confirm the result'
      :'Native inventory must confirm exactly one finite upgrade result after collection and return travel'}).toBe(true);
    const completed=await count();
    finite.find(f => f.name === name)!.completed = completed;
    if(kind==='compound') {
      const publication=await live.clients[merchant].run('({heldAt:__e2eCompoundPublication.heldAt,releasedAt:__e2eCompoundPublication.releasedAt,frames:__e2eCompoundPublication.frames})');
      reads.A59 = {publication};
      expect(publication.heldAt).not.toBeNull();
      expect(publication.releasedAt-publication.heldAt).toBeGreaterThanOrEqual(750);
      expect(publication.frames).toBeGreaterThan(0);
      const outcomes=await live.clients[merchant].run('globalThis.__e2eCompoundOutcomes');
      const successes=outcomes.filter((event:any)=>event.response==='compound_success').length;
      const failures=outcomes.filter((event:any)=>event.response==='compound_fail').length;
      expect(successes).toBe(1);
      expect(completed.length).toBe(12-2*successes-3*failures);
      expect(completed.every(item=>item?.level===0||item?.level===1)).toBe(true);
      await expect.poll(async()=>(await live.state()).autoCompounds?.[merchant]?.find((rule:any)=>rule.name===name)?.quantity).toBe(0);
    } else expect(completed.length).toBe(12);
  });
  await live.clients[merchant].run('(globalThis.__e2eCompoundPublication?.restore?.(),true)');
  await routines(live, {'party collection': false});
  // The start's threshold of 10 holds these twelve copies for one visit (live-economy.spec.ts:1355).
  // M29's one bank-marked hpot1 stack never reaches it (w03-w05-w09-run3: no visit to the priest in
  // M29's 300 s), so the threshold goes back to its default of 1 (items/saved-fields.ts:68).
  await live.post('/config', {itemCollectionThreshold: 1});
  await jobFinished(live).catch(() => {});
}

// M29 (live-items-hooks.spec.ts): the fate, claim, stock and bank reads and notices on the
// priest's cells 30-33, with its own collection.
async function itemsHooks(live: LiveGame) {
  const F = P, rows: Record<string, any> = {};
  reads.M29 = rows;
  for (const cell of [30, 31, 32, 33]) await freeCell(live, F, cell);
  await step('M29', async () => {
    await put(live, F, {30: {name: 'leather', q: 3}});
    await reported(live, F, 30, 'leather');
    expect(await ask(live, 'items.fate', [F, 30]), 'an unmarked copy with no rule stays (F7)').toEqual({fate: 'keep', row: 'F7', by: 'default'});
    await live.post('/command', {character: F, type: 'merchant-mark', slot: 30, item: {name: 'leather', q: 3}});
    expect(await ask(live, 'items.fate', [F, 30]), "the player's mark decides (F3)").toEqual({fate: 'merchant', row: 'F3', by: 'player'});
    await live.post('/command', {character: F, type: 'merchant-mark', slot: 30, item: {name: 'leather', q: 3}});
    await fixture(live, {op: 'answers', actions: {leather: 'bank'}, claims: [{item: {name: 'hpot1'}, quantity: {count: 1}, place: `carried:${F}`, reason: 'fixture'}]});
    await put(live, F, {31: {name: 'hpot1', q: 1}});
    await reported(live, F, 31, 'hpot1');
    rows.action = await ask(live, 'items.fate', [F, 30]);
    expect(rows.action, "the add-on's action takes the unclaimed copy (F6)").toEqual({fate: 'bank', row: 'F6', by: `addon:${ITEMS_HOOKS_ADDON}`});
    expect(of(await heard(live, since), 'items.action').some(h => h.payload.slot === 31), 'the claimed copy is not offered').toBe(false);
    await fixture(live, {op: 'answers', actions: {}, claims: []});
    // items.claim: two stacks of hpot1 claimed through the collection below; 31 and 32 stay, 33 goes.
    await fixture(live, {op: 'answers', claims: [{item: {name: 'hpot1'}, quantity: {stacks: 2}, place: `carried:${F}`, reason: 'fixture'}]});
    await put(live, F, {31: null, 32: {name: 'hpot1', q: 9999}, 33: {name: 'hpot1', q: 9999}});
    await put(live, F, {31: {name: 'hpot1', q: 9999}});
    await reported(live, F, 33, 'hpot1');
    expect((await ask(live, 'items.fate', [F, 32])).by, 'the claim holds the second stack').toBe(`addon:${ITEMS_HOOKS_ADDON}`);
    await live.post('/command', { character: F, type: 'auto-item-mark', mode: 'bank', action: 'set', item: { name: 'hpot1', level: 0 } });
    live.undo(`the hpot1 bank mark on ${F}`, () => live.post('/command', { character: F, type: 'remove-auto-item-mark', mode: 'bank', ruleKey: 'hpot1@+0' }));
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'party collection': true } });
    try {
      await expect.poll(async () => { const bag = await items(live, F); return [31, 32, 33].map(slot => bag[slot]?.name ?? null); },
        { timeout: 300_000, intervals: [1000] }).toEqual(['hpot1', 'hpot1', null]);
      await reported(live, F, 33, null);
    } finally { await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'party collection': false } }); }
  });
  await step('M29', async () => {
    expect(await ask(live, 'items.stock', [F, 'hpot1']), 'both stacks are claimed').toBe(0);
    await fixture(live, {op: 'answers', claims: []});
    expect(await ask(live, 'items.stock', [F, 'hpot1']), 'with no claim the restock range keeps its max').toBeGreaterThan(0);
    await fixture(live, {op: 'answers', claims: [{item: {name: 'hpot1'}, quantity: {stacks: 3}, place: `carried:${F}`, reason: 'fixture'}]});
    await expect.poll(async () => of(await heard(live, since), 'items.claimShort').filter(h => h.payload.subject === F).length, { timeout: 60_000, intervals: [500] }).toBeGreaterThan(0);
    const short = of(await heard(live, since), 'items.claimShort').find(h => h.payload.subject === F)!;
    rows.short = short;
    expect([short.payload.item, short.payload.by]).toEqual(['hpot1', `addon:${ITEMS_HOOKS_ADDON}`]);
    await fixture(live, {op: 'answers', claims: []});
    await put(live, F, {30: null, 31: null, 32: null});
    await live.post('/command', { character: M, type: 'auto-item-mark', mode: 'bank', action: 'set', item: { name: 'mpot1', level: 0 } });
    live.undo(`the mpot1 bank mark on ${M}`, () => live.post('/command', { character: M, type: 'remove-auto-item-mark', mode: 'bank', ruleKey: 'mpot1@+0' }));
    await expect.poll(async () => of(await heard(live, since), 'items.fateChanged').length, { timeout: 30_000, intervals: [250] }).toBeGreaterThan(0);
    const free = await ask(live, 'items.freeSlots', [M]), cells = (await items(live, M)).filter(item => !item).length;
    rows.free = {free, cells};
    expect(free).toBeLessThanOrEqual(cells);
    const needs = await ask(live, 'items.needs', [{ id: 'fixture', reason: 'mail', target: M }]);
    expect(Object.keys(needs).sort()).toEqual(expect.arrayContaining(['gold', 'postage', 'slots', 'withdrawals']));
    // The public state carries the coordinator's bankSnapshot as `bank` (M06 reads its packs there);
    // no state read names `bankSnapshot`, so w03-w05-w09-run4 compared the hook's snapshot with null.
    // The state's cells add the item catalog's meta (w03-w09-run5), so both sides compare as each
    // pack's cells (slot, name, level, q) under the merchant's name.
    const cellsOf = (snapshot: any) => snapshot && {character: snapshot.character, packs: Object.fromEntries(Object.entries(snapshot.packs ?? {})
      .map(([pack, cells]) => [pack, (cells as any[]).map(c => c && {slot: c.slot, name: c.item?.name, level: c.item?.level ?? null, q: c.item?.q ?? null})]))};
    expect(cellsOf(await ask(live, 'items.bank')), 'the snapshot after a bank visit').toEqual(cellsOf((await live.state()).bank ?? null));
    // The merchant banks the collected rest on its next job's bank visit (character/bank.ts `merchantBankErrands`).
    await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'party collection': true } });
    try {
      await expect.poll(async () => of(await heard(live, since), 'items.banked').length, { timeout: 300_000, intervals: [1000] }).toBeGreaterThan(0);
    } finally { await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'party collection': false } }); }
    const changes = of(await heard(live, since), 'items.bankChanged');
    rows.bankChanged = changes.length;
    // One report is one write in one clock window, so two of its notices would share both the `at`
    // and the snapshot they announced (e2e/fixtures/items-hooks-addon.ts `snapshotKey`).
    const sent = changes.map(h => `${h.at}:${h.payload.snapshot}`);
    rows.bankChangedSent = sent;
    expect(changes.every(h => h.payload.snapshot), 'each notice follows a written snapshot').toBe(true);
    expect(new Set(sent).size, 'no report sends two').toBe(changes.length);
  });
  await jobFinished(live).catch(() => {});
}

// M05-M07 (live-elixir-restock.spec.ts): stored on the warrior, then bought and crafted for the
// priest, since each character holds one elixir slot.
// The receipts and uses listen on the page's socket, which outlives the code frame: a CODE reload
// gives the frame a new globalThis while the socket keeps the old frame's listener. In
// w03-w09-run5 the merchant's native observer heard `buy_success` elixirluck q 2 on the socket
// the errand read, while the frame's receipts stayed empty. So each errand replaces the listener
// with one that writes to the current frame, and the undo takes it off.
const listen = (kind: 'receipts' | 'uses') => kind === 'receipts'
  ? `data=>{if(['buy_success','craft','crafted'].includes(data?.response)||data?.place==='craft')globalThis.__elixirReceipts?.push({at:Date.now(),data})}`
  : `data=>{if(data?.response==='elixir')globalThis.__elixirUses?.push({at:Date.now(),data})}`;
const relisten = (kind: 'receipts' | 'uses') => `(()=>{const s=parent.socket,key='__e2eElixir${kind}';globalThis.__elixir${kind === 'receipts' ? 'Receipts' : 'Uses'}=[];
  if(s[key])s.off('game_response',s[key]);s[key]=${listen(kind)};s.on('game_response',s[key]);return s.id})()`;
const elixirLogs = async (live: LiveGame, buyer: string, target: string) => ({
  buyer: await live.clients[buyer].run(relisten('receipts')),
  target: await live.clients[target].run(relisten('uses')),
});
const elixirAt = {} as Record<string, number>;
// A character's running consumable cost: the largest total its metrics hold over the last two
// minutes, or 0 when it has none.
async function consumableCost(page: Page, live: LiveGame, name: string): Promise<number> {
  const data = await (await page.request.get(live.url + '/party-api/metrics?from=' + (Date.now() - 120000) + '&to=' + Date.now())).json();
  return Math.max(0, ...data.points.flatMap((p: any) => p.values).filter((r: any) => r.character === name).map((r: any) => Number(r.last?.consumableCost) || 0));
}
async function elixirRestock(live: LiveGame, page: Page, mode: 'stored' | 'buy' | 'craft') {
  const id = {stored: 'M05', buy: 'M06', craft: 'M07'}[mode], target = mode === 'stored' ? W : P;
  const item=mode==='craft'?'elixirfires':'elixirluck',max=mode==='craft'?1:2;
  const policy=(item:string,autoAcquire:boolean,autoConsume=true,max=2)=>({character:target,hp:{min:0,max:0},mp:{min:0,max:0},elixir:{item,min:max===1?0:1,max,autoConsume,autoAcquire}});
  const samples: any[] = [];
  reads[id] = {samples};
  await step(id, async () => {
    elixirAt[id] = Date.now();
    // The priest drinks its own potions on the farm, and each adds its price to the running total
    // (status/character/telemetry.ts `consumable`), so the total never read the start plus 240020
    // in livea-run4 and livea-run5. M06 holds the priest's potion stacks for the step, so the
    // elixir and the hpot0 are its only consumption, and reads the start after the priest's next
    // report carries any potion drunk before the hold. The priest's policy drops its potions first:
    // under the farm policy the empty bag queued an hpot1 buy inside the errand (livea-run6).
    if (mode === 'buy') {
      await live.post('/restock', policy(item, false, false, max));
      await live.admin(`output=(()=>{const p=get_player('${target}'),held=globalThis.__e2eM06Potions=[];
        p.items.forEach((i,n)=>{if(i&&/^(hpot|mpot)/.test(i.name)){held.push([n,i]);p.items[n]=null;}});
        cache_player_items(p);resend(p,'reopen+cid');return held.length;})()`);
      const seen = (await live.clients[target].snapshot()).statusAt;
      await expect.poll(async () => (await live.clients[target].snapshot()).statusAt).toBeGreaterThan(seen);
    }
    const costAtStart = mode === 'craft' ? 0 : await consumableCost(page, live, target);
    reads[id].costAtStart = costAtStart;
    // M07's priest still wears M06's Liquid Luck and carries M06's second copy. The priest drinks a
    // bag copy whenever its slot is empty under M06's policy, and keeps an active elixir over the
    // crafted one (w03-w05-w09-run3: the slot held elixirluck again and the crafted elixirfires
    // stayed in cell 8). The plant takes the slot and every Liquid Luck copy in one call.
    if (mode === 'craft') await live.admin(`output=(()=>{const p=get_player('${target}');p.slots.elixir=null;
      p.items.forEach((i,n)=>{if(i&&i.name==='elixirluck')p.items[n]=null;});cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
    const [shell, pots] = mode === 'craft' ? await freeCells(live, merchant, 2) : [];
    // The stored seed's one bank read and write lands between mounts, never inside one.
    if (mode === 'stored') await expect.poll(async () => await live.admin(`output=(m=>!(m.mounting||m.unmounting||m.mount_call||m.unmount_call))(get_player('${merchant}'))`),
      {message: 'the merchant bank is not mid-mount'}).toBe(true);
    await live.admin(`output=(async()=>{const m=get_player('${merchant}'),p=get_player('${target}');
      if(p.slots.elixir||p.items.some(i=>i&&i.name==='${item}'))throw Error('Elixir fixture must start without selected stock');
      // The merchant carries its working gold: a bank visit deposits what is above it
      // (items/character/bank.ts:898-903) and a buy takes its shortfall from the bank
      // (items/character/market.ts:195-202). The buy's gold goes in the bank, so no visit deposits a
      // carried surplus inside an errand. It is the game's price for the policy's max
      // (G.items[item].g); the craft costs no gold (G.craft.elixirfires.cost 0).
      if('${mode}'==='buy'){const need=G.items['${item}'].g*${max};
        if(m.user)m.user.gold=Math.max(Number(m.user.gold)||0,need);
        else await db.collection('user').updateOne({_id:m.owner,'info.gold':{$lt:need}},{$set:{'info.gold':need}});}
      // The client's bank is m.cuser, the server's cached copy (server.js player_to_client sends
      // data.user = player.cuser), which init_bank (server_functions.js:4414) builds from m.user. A
      // seed in m.user alone never reached the client while the bank stayed mounted, and a second
      // bank command does not remount, so it read the same bank (livea-w03-w21-w23-run2). A mounted
      // seed rebuilds cuser. An unmount copies m.user's packs over the owner's db row and a mount
      // copies that row into m.user (server.js unmount_call and mount_user), so the seed refuses a
      // bank that is mounting or unmounting.
      if('${mode}'==='stored'){const seed=info=>{const pack=info.items0||(info.items0=[]),slot=pack.findIndex(i=>!i);
          if(slot<0&&pack.length>=42)throw Error('Fixture requires a free items0 slot');pack[slot<0?pack.length:slot]={name:'${item}',q:2};};
        const moving=()=>!!(m.mounting||m.unmounting||m.mount_call||m.unmount_call);
        if(moving())throw Error('The elixir seed met the bank mid-mount');
        if(m.user){seed(m.user);init_bank(m);}
        else{const u=await db.collection('user').findOne({_id:m.owner});seed(u.info);await db.collection('user').replaceOne({_id:u._id},u);
          if(moving()||m.user)throw Error('A bank mount began during the elixir seed');}}
      if('${mode}'==='craft'){m.items[${shell ?? -1}]={name:'cshell',q:1};m.items[${pots ?? -1}]={name:'hpot0',q:2000};}
      cache_player_items(m);resend(m,'reopen+cid');return true;})()`);
    reads[id].socket = await elixirLogs(live, merchant, target);
    await live.post('/command',{character:merchant,type:'bank'});
    await expect.poll(async()=>!!(await live.state()).bank?.packs,{timeout:90000}).toBe(true);
    await expect.poll(async()=>(await live.state()).merchantCurrent,{timeout:90000}).toBeNull();
    // The stored errand needs the coordinator's bank snapshot to hold the seed. In w03-w09-run5 the
    // bank command joined M29's visit, whose sort ran before the seed, so the snapshot lacked it and
    // the restock waited for the next bank visit 180 s later. A snapshot without the seed gets one
    // more bank visit, now that the merchant is idle; the bank read's own 90 s holds it.
    const banked=async()=>Object.values((await live.state()).bank?.packs??{}).flat().some((c:any)=>c?.item?.name===item);
    if(mode==='stored'&&!await banked()) {
      await live.post('/command',{character:merchant,type:'bank'});
      await expect.poll(banked,{timeout:90000,message:'The bank snapshot holds the stored elixir'}).toBe(true);
    }
    await live.post('/restock',policy(item,false,mode!=='buy',max));
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{restock:true}});
    if(mode!=='stored') {
      const before=(await live.clients[target].snapshot()).statusAt;
      await expect.poll(async()=>(await live.clients[target].snapshot()).statusAt,{timeout:30000}).toBeGreaterThan(before+10000);
      expect(await live.clients[merchant].run('globalThis.__elixirReceipts')).toEqual([]);
      await live.post('/restock',policy(item,true,mode!=='buy',max));
    }
    if(mode==='buy') {
      await expect.poll(async()=>(await live.clients[target].snapshot()).items.filter((i:any)=>i?.name===item).reduce((n:number,i:any)=>n+(i.q||1),0),{timeout:180000}).toBe(2);
      // A point inside scenery can pass a zero-length native collision check while remaining
      // unreachable; retried jobs must not conceal that behind delivery from bought stock.
      const navigation=(await live.state()).combatLogs?.[merchant]?.filter((entry:any)=>entry.type==='navigation'&&(entry.at??0)>=elixirAt[id]!)||[];
      reads[id].navigation = navigation.slice(-20);
      expect(navigation.filter((entry:any)=>entry.details?.failureContext?.code==='route-failed'),
        'Ordinary elixir acquisition must use a reachable Winter Inn return route').toEqual([]);
      const unconsumed=await live.admin(`output=!!get_player('${target}').slots.elixir`);
      expect(unconsumed).toBe(false);
      await live.post('/restock',policy(item,false,true,max));
    }
    // M07's craft reached the priest's bag in w03-run3 but filled its slot only after the restart:
    // each sample reads the slot, the elixir cells and the command the priest's reply carries.
    let sampling = true;
    const sampler = (async () => { while (sampling) {
      samples.push(await Promise.all([
        live.clients[target].run(`({at:Date.now(),slot:character.slots.elixir||null,cells:character.items.map((i,n)=>i&&i.name==='${item}'?{n,l:i.l||null,b:i.b||null}:null).filter(Boolean),rip:!!character.rip})`),
        live.state().then(s => ({command: s.pendingCommands?.[target] ?? s.commands?.[target] ?? null, policy: s.restockPolicies?.[target]?.elixir ?? null, current: s.merchantCurrent?.reason ?? null})),
      ]).catch(error => String(error)));
      if (samples.length > 40) samples.splice(0, 1);
      await waitForGameplay(5_000);
    } })();
    try {
      await expect.poll(async()=>await live.admin(`output=get_player('${target}').slots.elixir?.name||null`),{timeout:180000}).toBe(item);
    } finally { sampling = false; await sampler; }
    await expect.poll(async()=>{const c=(await live.state()).characters[target];return {item:c?.slots?.elixir?.item?.name,status:c?.conditions?.some((s:any)=>s.id==='elixir:'+item)};},{timeout:30000}).toEqual({item,status:true});
    const uses=await live.clients[target].run('globalThis.__elixirUses');
    expect(uses).toHaveLength(1);
    if(mode==='stored') expect(await live.clients[merchant].run('globalThis.__elixirReceipts')).toEqual([]);
    // The buyer's socket at the read beside the one the errand listened on, and the buy answers
    // the native client's own observer heard, so empty receipts name their side.
    if(mode==='buy') reads[id].receipts = {socket: await live.clients[merchant].run('parent.socket.id'), receipts: await live.clients[merchant].run('globalThis.__elixirReceipts'),
      heard: (await live.clients[merchant].events()).filter(e=>e.event==='game_response'&&(e.data as any)?.response==='buy_success').slice(-5)};
    if(mode==='buy') expect((await live.clients[merchant].run('globalThis.__elixirReceipts')).filter((r:any)=>r.data.response==='buy_success'&&r.data.name===item).reduce((n:number,r:any)=>n+r.data.q,0)).toBe(2);
    if(mode==='craft') {
      const ingredients=await live.admin(`output=get_player('${merchant}').items.filter(i=>i&&['cshell','hpot0'].includes(i.name))`);
      expect(ingredients).toEqual([]);
    }
    await page.goto(live.url);
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:target,exact:true})});
    await expect(card.getByText(mode==='craft'?'Elixir of Fire Resistance':'Liquid Luck',{exact:true}).first()).toBeVisible();
    await expect(card.locator('[data-status-row]').getByRole('button',{name:mode==='craft'?/^Elixir of Fire Resistance/:/^Liquid Luck/})).toBeVisible();
    const equipped=card.getByLabel('Equipped elixir');
    await expect(equipped).toHaveCount(1);
    await expect(equipped).toContainText(/\d+[hms]/);
    if(mode==='buy') {
      // A potion's native consumption cost; full pools keep regeneration off the cooldown.
      await freeCell(live, target, 20);
      await live.admin(`output=(()=>{const p=get_player('${target}');if(p.items[20])throw Error('Potion fixture requires empty slot 20');p.items[20]={name:'hpot0',q:1};p.hp=p.max_hp;p.mp=p.max_mp;cache_player_items(p);resend(p,'reopen+cid');return true;})()`);
      await expect.poll(async()=>(await live.clients[target].snapshot()).items[20]?.name).toBe('hpot0');
      // The priest fights the farm, and its own regen shares the potion cooldown, so every consume
      // in livea-run3's 15 s answered not_ready. The console's Pause holds every console action,
      // regen included, while the native consume runs, and Play returns before the cost read.
      await live.post('/console-control/pause', {});
      try {
      await expect.poll(async()=>{
        const result=await live.clients[target].run(`(async()=>{if(!character.items[20])return {done:true};try{await consume(20);return {done:true};}catch(error){return {reason:error?.reason||error?.response||String(error)};}})()`);
        if(result.reason && result.reason!=='not_ready') throw Error('Native potion use failed: '+JSON.stringify(result));
        return result.done===true;
      },{timeout:15000,intervals:[100,250]}).toBe(true);
      } finally { await live.post('/console-control/play', {}); }
      await expect.poll(async()=>(await live.clients[target].snapshot()).items[20]).toBeNull();
    }
    // M07's priest carries M06's costs, and M07's watches name no consumableCost (DESIGN.md 2.2 W03).
    // The cost is the character's running total, so the read adds the errand's cost to the total at
    // its start.
    if(mode!=='craft') await expect.poll(async()=>{const data=await (await page.request.get(live.url+'/party-api/metrics?from='+(Date.now()-120000)+'&to='+Date.now())).json();return data.points.flatMap((p:any)=>p.values).filter((r:any)=>r.character===target).some((r:any)=>r.last.consumableCost === costAtStart+(mode==='buy'?240020:240000));},{timeout:30000}).toBe(true);
    await jobFinished(live);
  // The restock fills a bag to the policy's max (items/coordinator/needs.ts
  // `restockInventorySatisfied`), so the warrior's max of 2 would take one of the priest's bought
  // copies once the merchant holds them (w03-run3: 3 bought, one sent to the warrior). The
  // warrior's policy keeps its item and asks for the one copy it carries. It runs after the step
  // whether it passed or failed (w03-w05-w09-run4: M05 failed and M06 counted 1 of its 2).
  // M06's held potions go back to their cells, or to the first free cell when one was filled.
  }).finally(async () => {
    if (mode === 'stored') await live.post('/restock',policy(item,false,true,1));
    if (mode === 'buy') await live.admin(`output=(()=>{const p=get_player('${target}'),held=globalThis.__e2eM06Potions||[];
      for(const [n,i] of held){const cell=p.items[n]?p.items.findIndex(x=>!x):n;if(cell<0)throw Error('No free cell for a held potion');p.items[cell]=i;}
      delete globalThis.__e2eM06Potions;cache_player_items(p);resend(p,'reopen+cid');return held.length;})()`);
  });
}
async function elixirAfterRestart(live: LiveGame, id: string, target: string, item: string) {
  await step(id, async () => {
    await expect.poll(async()=>(await live.state()).restockPolicies[target].elixir.item).toBe(item);
    expect(await live.clients[target].run('globalThis.__elixirUses')).toHaveLength(1);
  });
}

// M29's market rows: the WTB source, the stand's offer and the mail.
async function market(live: LiveGame) {
  const F = P;
  await step('M29', async () => {
    await fixture(live, {op: 'answers', listings: [{item: {name: 'leather'}, seller: 'items-hooks-seller', map: 'main', x: 0, y: 0,
      price: 1, quantity: 1, serverRegion: 'US', serverIdentifier: 'I', key: 'items-hooks-fixture-leather', seenAt: Date.now()}]});
    await routines(live, {'stand bid purchases': true});
    try {
      await live.post('/merchant/bid', {itemId: 'leather', price: 10, quantity: 1, minimumQuality: 0, useStandSlot: false});
      await expect.poll(async () => of(await heard(live, since), 'items.source').length, { timeout: 120_000, intervals: [1000] }).toBeGreaterThan(0);
    } finally {
      await live.post('/merchant/bid', {itemId: 'leather', clear: true});
      await fixture(live, {op: 'answers', listings: []});
      await routines(live, {'stand bid purchases': false});
    }
  });
  await step('M29', async () => {
    const leather = async (hook: string) => of(await heard(live, since), hook).filter(h => h.payload.item === 'leather');
    await standing(live, true);
    try {
      await expect.poll(async () => await live.clients[M].run('!!character.stand'), { timeout: 90_000, intervals: [1000] }).toBe(true);
      // The stand places an offer only while the merchant carries its price (market.ts
      // `placementProblem`, "Waiting for merchant to withdraw bank gold"). The play's gold target of 0
      // banks every carried coin, and livea-run3's merchant stood at the market with 0 gold, so it
      // carries the one offer's price, 1 x 1.
      await live.admin(`output=(()=>{const m=get_player(${JSON.stringify(M)});m.gold=Math.max(Number(m.gold)||0,1);resend(m,'reopen+nc');return true;})()`);
      await live.post('/merchant/bid', {itemId: 'leather', price: 1, quantity: 1, minimumQuality: 0, useStandSlot: true});
      await expect.poll(async () => (await leather('items.listed')).length, { timeout: 120_000, intervals: [1000] }).toBeGreaterThan(0);
      const offer = Object.values((await live.state()).nativeStand.offers).find((e: any) => e.itemId === 'leather') as {slot: string};
      await live.clients[M].run(`unequip(${JSON.stringify(offer.slot)})`);
      await expect.poll(async () => (await leather('items.unlisted')).some(h => h.payload.by === 'N4'), { timeout: 120_000, intervals: [1000] }).toBe(true);
      await expect.poll(async () => (await leather('items.listed')).length, { timeout: 120_000, intervals: [1000] }).toBeGreaterThan(1);
    } finally {
      await live.post('/merchant/bid', {itemId: 'leather', clear: true});
      await standing(live, false);
    }
  });
  await step('M29', async () => {
    const order = await live.post('/merchant/send-mail', {recipient: F, subject: 'items hooks postage', message: 'items.mailed fixture'});
    live.undo('the items fixture letter in the outbox', () => live.post('/mail/outbox-delete', {id: order.jobId}));
    await expect.poll(async () => of(await heard(live, since), 'items.mailed').length, { timeout: 120_000, intervals: [1000] }).toBeGreaterThan(0);
    await freeCell(live, F, 30);
    await put(live, F, {30: {name: 'hpot1', q: 1}});
    await reported(live, F, 30, 'hpot1');
    // A claim takes the bag's copies in cell order, and the priest carries its own hpot1 stack in a
    // lower cell: in livea-run3 the claim of one copy took that stack, so cell 30 fell to the
    // merchant's hpot1 rule (F5, `rule:E2EMerchant`). The claim takes every hpot1 stack the priest
    // carries.
    const stacks = (await items(live, F)).filter(item => item?.name === 'hpot1').length;
    await fixture(live, {op: 'answers', claims: [{item: {name: 'hpot1'}, quantity: {stacks}, place: `carried:${F}`, reason: 'fixture'}]});
    expect((await ask(live, 'items.fate', [F, 30])).by, "the claim names the add-on, as the item's rules show it").toBe(`addon:${ITEMS_HOOKS_ADDON}`);
    await fixture(live, {op: 'answers', claims: []});
    await put(live, F, {30: null});
  });
  await jobFinished(live).catch(() => {});
}

// The play's one restart, and every read across it.
async function restart(live: LiveGame, page: Page) {
  await live.post('/merchant/auto-npc-sale',{item:{name:'helmet',level:0},keep:2});
  await restartAndObserve(live);
  await step('C14', async () => {
    const {completed, total} = later.c14!;
    await expect.poll(completed, { timeout: 30_000 }).toBe(true);
    // M59 delivers its scrolled helmet to the warrior after C14's count (w03-w05-w09-run3 read 2
    // for C14's 1), and only that helmet carries a stat type, so C14 counts the others.
    const restored=Object.fromEntries(Object.entries(await observed(live)).map(([name,p]:[string,any])=>[name,{...p,items:p.items.map((i:any)=>i?.name==='helmet'&&i.stat_type?null:i)}]));
    expect(names.reduce((sum,name)=>sum+quantity(restored[name].items,'helmet'),0)).toBe(total);
  });
  for (const {name, completed, count} of later.finite ?? []) await step(name === 'dexring' ? 'A59' : 'A58', async () => {
    await expect.poll(async()=>(await live.state()).characters[merchant]?.items?.some((e:any)=>e?.item?.name===name&&e.item.level===1)).toBe(true);
    const afterRestart=await count();
    expect(afterRestart.length).toBe(completed.length);
    expect(afterRestart.filter(item=>item?.level===1).length).toBe(1);
  });
  await step('A9', async () => {
    const native = later.a9!;
    expect(await native()).toEqual({helmets:2,smoke:150});
    await expect.poll(async()=>{
      const state=await live.state();
      return Object.values(state.autoNpcSales).map((rule:any)=>({name:rule.item.name,keep:rule.keep})).sort((a:any,b:any)=>a.name.localeCompare(b.name));
    }).toEqual([{name:'helmet',keep:2},{name:'smoke',keep:150}]);
  });
  await elixirAfterRestart(live, 'M05', W, 'elixirluck');
  await elixirAfterRestart(live, 'M07', P, 'elixirfires');
  await step('A57', async () => {
    const before = later.a57!, after=await economy(live);
    for(const name of ['E2EWarrior',merchant]) {
      expect(after.characters[name].items[after.characters[name].isize-1]?.name).toBe('tracker');
      expect(quantity(after.characters[name].items,'tracker')).toBe(1);
    }
    const totalFeathers=(value:Economy)=>bankQuantity(value,'feather0')+Object.values(value.characters).reduce((sum,c)=>sum+quantity(c.items,'feather0'),0);
    expect(totalFeathers(after)).toBe(totalFeathers(before));
    await page.goto(live.url);
    const card=page.locator('article').filter({has:page.getByRole('heading',{name:'E2EWarrior',exact:true})});
    await expect(card.getByRole('heading',{name:'E2EWarrior',exact:true})).toBeVisible();
    const inventory=card.getByRole('button',{name:/^Inventory/});
    await expect(inventory).toBeVisible();
    if (await inventory.getAttribute('aria-expanded') === 'false') await inventory.click();
    const tracker=card.getByLabel(/^(Tracktrix|tracker)$/);
    await expect(tracker).toBeVisible();
  });
  // A49: no failed equip replays after the restart.
  await step('A49', async () => {
    const {receipts, countCargo} = later.a49!, retained = true, recipient = W;
    const failures = receipts.filter(receipt => receipt.results.some(result => !result.success)).length;
    await waitForGameplay(35_000);
    expect(receipts.filter(receipt => receipt.results.some(result => !result.success)).length).toBe(failures);
    expect((await live.state()).merchantDeliveries?.[recipient] || []).toEqual([]);
    expect(await countCargo()).toBe(retained ? 1 : 0);
  });
}

async function merchantVisitsPlay(live: LiveGame, page: Page) {
  await start(live);
  await cleanout(live);
  await c14(live);
  await m59(live);
  await farm(live);
  await m03(live);
  await collection(live);
  await itemsHooks(live);
  await ownPotions(live);
  for (const mode of ['stored', 'buy', 'craft'] as const) await elixirRestock(live, page, mode);
  await market(live);
  await restart(live, page);
}

const own = (id: string) => ({
  owner: id.startsWith('M') ? 'merchant' : 'items', behaviours: [], start() {}, reads: () => ({failed: failed[id] ?? null, reads: reads[id] ?? null}),
  verdict() { expect(failed[id], `${id}: every step of the play passes`).toBeUndefined(); },
});

liveWindow({
  id: 'W03', name: 'Goo farm with the merchant visiting the fighters',
  // The old tests' bounds summed: 240 s (C14) + 420 (A9) + 240 (A49) + 240 (A57) + 450 (A58) + 300
  // (A59) + 240 (M03) + 3 x 360 (M05-M07) + 900 (M29) + 300 (M59) = 4,410 s.
  timeoutMs: 4_410_000,
  // The dashboard page belongs to Playwright's base context, so it closes before the native fixture.
  async play({live, page}: LiveWorld) { try { await merchantVisitsPlay(live, page); } finally { await page.close(); } },
  observers: [
    {id: 'C14', ...own('C14')}, {id: 'A9', ...own('A9')}, {id: 'A49', ...own('A49')}, {id: 'A57', ...own('A57')}, {id: 'A58', ...own('A58')}, {id: 'A59', ...own('A59')},
    {id: 'M03', ...own('M03')}, {id: 'M05', ...own('M05')}, {id: 'M06', ...own('M06')}, {id: 'M07', ...own('M07')}, {id: 'M29', ...own('M29')}, {id: 'M59', ...own('M59')},
  ],
});
