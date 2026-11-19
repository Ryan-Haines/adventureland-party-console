import { test, expect, type LiveGame } from './live-fixtures';
import { party } from './game/hunt-lifecycle';
import { ITEMS_HOOKS_ADDON, type Heard } from './fixtures/items-hooks-addon';

// The items owner's hooks table. One fixture add-on answers the items owner's add-on hooks and hears every 10 notice; each step
// is one hook, notice, read or slot whose `fixture` names this spec, on one shared run of the
// merchant setup (the default party, its merchant at its stand on the home realm). Each step's title
// is that `fixture` (runtime/hooks/rows/10-items.ts). The rows whose fixture names
// scripts/tests/hook-registry.test.cjs are unit rows there.
const M = 'E2EMerchant', F = 'E2EPriest';
const fixture = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-items-hooks', body);
const heard = async (live: LiveGame, since: number) => await fixture(live, { op: 'heard', since }) as Heard[];
const ask = async (live: LiveGame, hook: string, args: unknown[] = []) => (await fixture(live, { op: 'ask', hook, args }) as { answer: any }).answer;
const of = (list: Heard[], hook: string) => list.filter(h => h.hook === hook);
const seed = async (live: LiveGame, name: string, cells: Record<number, Record<string, unknown> | null>) =>
  await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(name)}),cells=${JSON.stringify(cells)};
    for(const [slot,item] of Object.entries(cells))p.items[Number(slot)]=item;cache_player_items(p);resend(p,'reopen+cid');return true})()`);
const items = async (live: LiveGame, name: string) => await live.admin(`output=get_player(${JSON.stringify(name)}).items`) as any[];
const reported = async (live: LiveGame, name: string, slot: number, wanted: string | null) =>
  await expect.poll(async () => ((await live.state()).characters?.[name]?.items?.[slot]?.item?.name ?? null), { timeout: 60_000, intervals: [500] }).toBe(wanted);

test('items hooks: one fixture add-on registers every hook and event', async ({ live }, info) => {
  test.setTimeout(900_000);
  await party(live);
  expect(await fixture(live, { op: 'register' }), 'the add-on registers').toEqual({ ok: true });
  const addons = { ...((await live.state()).addons || {}), [ITEMS_HOOKS_ADDON]: { enabled: true, settings: {} } };
  const before = (await live.state()).addons || {};
  await live.post('/settings', { changes: [{ field: 'addons', value: addons }] });
  live.undo('the items fixture add-on switch', () => live.post('/settings', { changes: [{ field: 'addons', value: before }] }));
  live.undo("the items fixture's answers", () => fixture(live, { op: 'answers', claims: [], actions: {}, listings: [] }));
  const since = Date.now(), rows: Record<string, unknown> = {};
  try {
    await test.step('items.fate: the fate read names its row and by', async () => {
      await seed(live, F, { 30: { name: 'leather', q: 3 } });
      await reported(live, F, 30, 'leather');
      expect(await ask(live, 'items.fate', [F, 30]), 'an unmarked copy with no rule stays (F7)').toEqual({ fate: 'keep', row: 'F7', by: 'default' });
      await live.post('/command', { character: F, type: 'merchant-mark', slot: 30, item: { name: 'leather', q: 3 } });
      expect(await ask(live, 'items.fate', [F, 30]), "the player's mark decides (F3)").toEqual({ fate: 'merchant', row: 'F3', by: 'player' });
      await live.post('/command', { character: F, type: 'merchant-mark', slot: 30, item: { name: 'leather', q: 3 } });
    });
    await test.step('items.action: an add-on action takes an unclaimed copy; a claimed copy is not offered', async () => {
      await fixture(live, { op: 'answers', actions: { leather: 'bank' }, claims: [{ item: { name: 'hpot1' }, quantity: { count: 1 }, place: `carried:${F}`, reason: 'fixture' }] });
      await seed(live, F, { 31: { name: 'hpot1', q: 1 } });
      await reported(live, F, 31, 'hpot1');
      const leather = await ask(live, 'items.fate', [F, 30]);
      rows.action = leather;
      expect(leather, "the add-on's action takes the unclaimed copy (F6)").toEqual({ fate: 'bank', row: 'F6', by: `addon:${ITEMS_HOOKS_ADDON}` });
      expect(of(await heard(live, since), 'items.action').some(h => h.payload.slot === 31), 'the claimed copy is not offered').toBe(false);
      await fixture(live, { op: 'answers', actions: {}, claims: [] });
    });
    await test.step('items.claim: an add-on claim of 2 stacks of hpot1 keeps them through a bank visit', async () => {
      await fixture(live, { op: 'answers', claims: [{ item: { name: 'hpot1' }, quantity: { stacks: 2 }, place: `carried:${F}`, reason: 'fixture' }] });
      await seed(live, F, { 31: { name: 'hpot1', q: 9999 }, 32: { name: 'hpot1', q: 9999 }, 33: { name: 'hpot1', q: 9999 } });
      await reported(live, F, 33, 'hpot1');
      expect((await ask(live, 'items.fate', [F, 32])).by, 'the claim holds the second stack').toBe(`addon:${ITEMS_HOOKS_ADDON}`);
      await live.post('/command', { character: F, type: 'auto-item-mark', mode: 'bank', action: 'set', item: { name: 'hpot1', level: 0 } });
      live.undo(`the hpot1 bank mark on ${F}`, () => live.post('/command', { character: F, type: 'remove-auto-item-mark', mode: 'bank', ruleKey: 'hpot1@+0' }));
      // The merchant's party collection takes the bank-marked copy; the fixture starts with every
      // merchant automation off. Slot 0's own hpot1 stack stays under the restock range (core:restock),
      // so the seeded slots show the claim: 31 and 32 stay, 33 goes.
      await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'party collection': true } });
      await expect.poll(async () => { const bag = await items(live, F); return [31, 32, 33].map(slot => bag[slot]?.name ?? null); },
        { timeout: 300_000, intervals: [1000] }).toEqual(['hpot1', 'hpot1', null]);
      // The poll above reads the game; the stock read below reads the priest's report, which shows
      // the collected slot one report later.
      await reported(live, F, 33, null);
      await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'party collection': false } });
    });
    await test.step('items.stock: the stock read leaves out claimed copies', async () => {
      expect(await ask(live, 'items.stock', [F, 'hpot1']), 'both stacks are claimed').toBe(0);
      await fixture(live, { op: 'answers', claims: [] });
      expect(await ask(live, 'items.stock', [F, 'hpot1']), 'with no claim the restock range keeps its max').toBeGreaterThan(0);
    });
    await test.step('items.claimShort: a claim larger than the bag holds names its shortfall', async () => {
      await fixture(live, { op: 'answers', claims: [{ item: { name: 'hpot1' }, quantity: { stacks: 3 }, place: `carried:${F}`, reason: 'fixture' }] });
      await expect.poll(async () => of(await heard(live, since), 'items.claimShort').filter(h => h.payload.subject === F).length,
        { timeout: 60_000, intervals: [500] }).toBeGreaterThan(0);
      const short = of(await heard(live, since), 'items.claimShort').find(h => h.payload.subject === F)!;
      rows.short = short;
      expect([short.payload.item, short.payload.by]).toEqual(['hpot1', `addon:${ITEMS_HOOKS_ADDON}`]);
      await fixture(live, { op: 'answers', claims: [] });
      await seed(live, F, { 30: null, 31: null, 32: null, 33: null });
    });
    await test.step("items.fateChanged: the exchange reward's fate is the merchant's restock claim", async () => {
      await live.post('/command', { character: M, type: 'auto-item-mark', mode: 'bank', action: 'set', item: { name: 'mpot1', level: 0 } });
      live.undo(`the mpot1 bank mark on ${M}`, () => live.post('/command', { character: M, type: 'remove-auto-item-mark', mode: 'bank', ruleKey: 'mpot1@+0' }));
      await expect.poll(async () => of(await heard(live, since), 'items.fateChanged').length, { timeout: 30_000, intervals: [250] }).toBeGreaterThan(0);
    });
    await test.step("items.freeSlots: the lucky slot's hold is counted", async () => {
      const free = await ask(live, 'items.freeSlots', [M]), cells = (await items(live, M)).filter(item => !item).length;
      rows.free = { free, cells };
      expect(free).toBeLessThanOrEqual(cells);
    });
    await test.step("items.needs: a job's needs name gold and withdrawals", async () => {
      const needs = await ask(live, 'items.needs', [{ id: 'fixture', reason: 'mail', target: M }]);
      expect(Object.keys(needs).sort()).toEqual(expect.arrayContaining(['gold', 'postage', 'slots', 'withdrawals']));
    });
    await test.step('items.bank: the snapshot read', async () => {
      expect(await ask(live, 'items.bank'), 'the snapshot after a bank visit').toEqual((await live.state()).bankSnapshot ?? null);
    });
    await test.step('items.bankChanged: the snapshot changes once per changed report', async () => {
      const changes = of(await heard(live, since), 'items.bankChanged');
      rows.bankChanged = changes.length;
      expect(new Set(changes.map(h => h.at)).size, 'no report sends two').toBe(changes.length);
    });
    // The merchant banks the collected copy on its next job's bank visit (character/bank.ts
    // `merchantBankErrands`), and its routines are off since the claim row, so the row lets the
    // party collection run again until the copy banks.
    await test.step('items.banked, .withdrawn: a bank visit banks the unclaimed rest', async () => {
      await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'party collection': true } });
      try {
        await expect.poll(async () => of(await heard(live, since), 'items.banked').length, { timeout: 300_000, intervals: [1000] }).toBeGreaterThan(0);
      } finally { await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'party collection': false } }); }
    });
    await test.step("items.source: an add-on source's listing is bought after the core sources", async () => {
      // The ALData pass (items/coordinator/market.ts `queueMarket`) asks the hook only for a WTB
      // order with the stand bid purchases routine on, and the fixture starts with every routine off.
      // The bid write runs that pass at once. The listing passes `acceptable`: a seller outside the
      // party, a non-PVP realm, and a price under the bid.
      const bid = { itemId: 'leather', price: 10, quantity: 1, minimumQuality: 0, useStandSlot: false };
      await fixture(live, { op: 'answers', listings: [{ item: { name: 'leather' }, seller: 'items-hooks-seller', map: 'main', x: 0, y: 0,
        price: 1, quantity: 1, serverRegion: 'US', serverIdentifier: 'I', key: 'items-hooks-fixture-leather', seenAt: Date.now() }] });
      await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'stand bid purchases': true } });
      try {
        await live.post('/merchant/bid', bid);
        await expect.poll(async () => of(await heard(live, since), 'items.source').length, { timeout: 120_000, intervals: [1000] }).toBeGreaterThan(0);
      } finally {
        await live.post('/merchant/bid', { itemId: 'leather', clear: true });
        await fixture(live, { op: 'answers', listings: [] });
        await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'stand bid purchases': false } });
      }
    });
    await test.step('items.bought, .sold: a stand purchase and an NPC sale', async () => {
      await seed(live, M, { 40: { name: 'seashell', q: 2 } });
      // The NPC sale rule has its own route; /command never took an auto-npc-sale type (runtime/lifecycle/coordinator/routes.ts).
      await live.post('/merchant/auto-npc-sale', { action: 'set', item: { name: 'seashell', level: 0 } });
      live.undo('the seashell NPC sale rule', () => live.post('/merchant/auto-npc-sale', { action: 'remove', item: { name: 'seashell', level: 0 } }));
      // The fixture starts with every merchant automation off, and markAutomaticNpc marks nothing
      // while 'auto npc sales' is off (runtime/items/coordinator/market.ts).
      await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'auto npc sales': true } });
      try {
        await expect.poll(async () => of(await heard(live, since), 'items.sold').length, { timeout: 300_000, intervals: [1000] }).toBeGreaterThan(0);
      } finally {
        await live.post('/merchant/routine-priorities', { priorities: {}, enabled: { 'auto npc sales': false } });
      }
    });
    await test.step('items.listed, .unlisted: an offer replaced after its slot empties', async () => {
      // The native stand (items/coordinator/market.ts `createNativeStand`) places an offer only for a
      // stand bid with useStandSlot on an open stand, and the source row's bid has it off. Force
      // stand opens the stand. Emptying the offer's slot with no receipt is N4, which unlists the
      // offer, and the next stand sync places it again.
      const leather = async (hook: string) => of(await heard(live, since), hook).filter(h => h.payload.item === 'leather');
      // The fixture merchant carries no stand item, and a merchant without one reaches the market but
      // opens nothing ("At the market with no stand to open").
      await seed(live, M, { 41: { name: 'stand0' } });
      await reported(live, M, 41, 'stand0');
      await live.post('/merchant/force-stand', { enabled: true });
      try {
        await expect.poll(async () => await live.clients[M].run('!!character.stand'), { timeout: 90_000, intervals: [1000] }).toBe(true);
        await live.post('/merchant/bid', { itemId: 'leather', price: 1, quantity: 1, minimumQuality: 0, useStandSlot: true });
        await expect.poll(async () => (await leather('items.listed')).length, { timeout: 120_000, intervals: [1000] }).toBeGreaterThan(0);
        const offer = Object.values((await live.state()).nativeStand.offers).find((entry: any) => entry.itemId === 'leather') as { slot: string };
        await live.clients[M].run(`unequip(${JSON.stringify(offer.slot)})`);
        await expect.poll(async () => (await leather('items.unlisted')).some(h => h.payload.by === 'N4'), { timeout: 120_000, intervals: [1000] }).toBe(true);
        await expect.poll(async () => (await leather('items.listed')).length, { timeout: 120_000, intervals: [1000] }).toBeGreaterThan(1);
      } finally {
        await live.post('/merchant/bid', { itemId: 'leather', clear: true });
        await live.post('/merchant/force-stand', { enabled: false });
        await seed(live, M, { 41: null });
      }
    });
    await test.step('items.mailed: a mail sent with postage', async () => {
      // A read sends no notice; a collect or a send does (the executor sends the postage). The
      // fixture's inbox starts empty, so the merchant sends a letter. Send mail is a manual routine,
      // so it runs with the merchant automations off.
      const order = await live.post('/merchant/send-mail', { recipient: F, subject: 'items hooks postage', message: 'items.mailed fixture' });
      live.undo('the items fixture letter in the outbox', () => live.post('/mail/outbox-delete', { id: order.jobId }));
      await expect.poll(async () => of(await heard(live, since), 'items.mailed').length, { timeout: 120_000, intervals: [1000] }).toBeGreaterThan(0);
    });
    await test.step("item-rules: the add-on's claim shows on the item's rules with its name", async () => {
      await fixture(live, { op: 'answers', claims: [{ item: { name: 'hpot1' }, quantity: { count: 1 }, place: `carried:${F}`, reason: 'fixture' }] });
      await seed(live, F, { 31: { name: 'hpot1', q: 1 } });
      await reported(live, F, 31, 'hpot1');
      expect((await ask(live, 'items.fate', [F, 31])).by, "the claim names the add-on, as the item's rules show it").toBe(`addon:${ITEMS_HOOKS_ADDON}`);
      await seed(live, F, { 31: null });
    });
  } finally {
    await info.attach('items-hooks-rows', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
  }
});
