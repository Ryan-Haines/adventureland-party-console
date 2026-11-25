// The merchant's upgrade and compound scrolls (production.ts `prepareManualImprovementScrolls`, which
// answers the plan it stocked, and `merchantImprove`) over items-character.cjs productionHarness.
// The plan is every step's scroll at that step's grade and one per compound group.
// The scrolls a row starts with sit in the bag; a purchase adds to the bag's pile.
const { productionHarness, emptyCheckpoint } = require('./helpers/items-character.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');

function runtime(levels = [0, 0, 0, 0, 0], scrolls = {}) {
  const purchases = [];
  const items = [...levels.map(level => ({ name: 'wshoes', level })), ...Object.entries(scrolls).map(([name, q]) => ({ name, q })), ...Array(8).fill(null)];
  const character = { name: 'M', items, gold: 1e9, q: {} };
  const pile = name => items.findIndex(item => item?.name === name);
  // The bank holds no scrolls: its retrieval answers the bag's count.
  const onPlayer = name => items.reduce((sum, item) => sum + (item?.name === name ? item.q : 0), 0);
  const { production } = productionHarness({ character, bank: { retrieveFromBankUntil: async name => ({ onPlayer: onPlayer(name), inBank: 0 }) },
    G: { items: { wshoes: { upgrade: {} }, scroll0: { g: 1000 }, scroll1: { g: 40000 } }, skills: {} },
    ports: {
      request: emptyCheckpoint,
      // The game's upgrade: the scroll is used and the item gains a level.
      upgrade: async (slot, scroll) => {
        items[scroll] = items[scroll].q > 1 ? { ...items[scroll], q: items[scroll].q - 1 } : null;
        items[slot] = { ...items[slot], level: items[slot].level + 1 };
        return { success: true, num: slot };
      },
      grade: item => item.level >= 9 ? 2 : item.level >= 7 ? 1 : 0,
      buyConfirmed: async (name, quantity) => {
        purchases.push([name, quantity]);
        const at = pile(name);
        if (at >= 0) items[at] = { ...items[at], q: items[at].q + quantity }; else items[items.indexOf(null)] = { name, q: quantity };
      },
    } });
  return { production, character, items, purchases, command: { upgrades: levels.slice(0, 3).map(level => ({ item: { name: 'wshoes', level }, tiers: 8 - level })) } };
}

test('three requested +8 shoes stock 21 normal and three high, not all five inventory shoes', async () => {
  const { production, purchases, command } = runtime(undefined, { scroll0: 3 });
  await production.prepareManualImprovementScrolls(command, []);
  assert.deepEqual(purchases, [['scroll0', 18], ['scroll1', 3]]);
  await production.prepareManualImprovementScrolls(command, []);
  assert.equal(purchases.length, 2, 'existing stock prevents duplicate purchases');
});

test('an existing high scroll counts toward the plan', async () => {
  const { production, purchases, command } = runtime(undefined, { scroll1: 1 });
  await production.prepareManualImprovementScrolls(command, []);
  assert.deepEqual(purchases, [['scroll0', 21], ['scroll1', 2]]);
});

test('a refill plans the unfinished live levels, each crossing step included', async () => {
  const { production, items, command } = runtime([7, 0, 0]);
  const plan = await production.prepareManualImprovementScrolls(command, []);
  assert.equal(plan.scroll0, 14);
  assert.equal(plan.scroll1, 3);
  items[0] = null;
  const remaining = await production.prepareManualImprovementScrolls({ upgrades: command.upgrades.slice(1) }, []);
  assert.equal(remaining.scroll0, 14);
  assert.equal(remaining.scroll1, 2);
});

test('same starting grade is batched even when it is a high grade', async () => {
  const { production, command } = runtime([7, 7, 7]);
  const plan = await production.prepareManualImprovementScrolls(command, []);
  assert.equal(plan.scroll0, undefined);
  assert.equal(plan.scroll1, 3);
});

test('a partially upgraded marked item only budgets its remaining steps to the original target', async () => {
  const { production } = runtime([4]);
  const plan = await production.prepareManualImprovementScrolls({ upgrades: [
    { slot: 0, item: { name: 'wshoes', level: 0 }, tiers: 8 },
  ] }, []);
  assert.equal(plan.scroll0, 3);
  assert.equal(plan.scroll1, 1);
});

test('destroyed or missing queued ingredients do not inflate the budget', async () => {
  const { production, items, command } = runtime([0, 0, 0]);
  items[1] = null;
  items[2] = null;
  const plan = await production.prepareManualImprovementScrolls(command, []);
  assert.equal(plan.scroll0, 7);
  assert.equal(plan.scroll1, 1);
});

test('an unstocked upgrade loop buys every grade of the unfinished work in one purchase each', async () => {
  const { production, items, purchases, command } = runtime([0, 0, 0]);
  await production.merchantImprove(command, []);
  assert.deepEqual(purchases, [['scroll0', 21], ['scroll1', 3]]);
  assert.equal(items.find(item => item?.name === 'scroll0' || item?.name === 'scroll1'), undefined, 'no excess scrolls after an all-successful run');
  assert.ok(items.filter(item => item?.name === 'wshoes').every(item => item.level === 8));
});

// The queue scenario of the batch (the user's ask, 2026-11-15): five queued compounds, then a mixed
// upgrade queue, each run as its job runs it (`prepareManualImprovementScrolls`, then `merchantImprove`).
// Game data, G version 18285: the items' grades and the scrolls' prices; the main map's scrolls NPC at
// [-464,-96] and newupgrade at [-207,-220]; the bank door at [168,-149], the bank's spawn at [0,-37]
// and its first vault at [-64,-191]; the merchant class speed 55.
const GAME = { items: {
  wshoes: { upgrade: {}, grades: [7, 9, 10, 12] }, ringsj: { compound: {}, grades: [3, 5, 6, 7] },
  scroll0: { g: 1000, s: 9999 }, scroll1: { g: 40000, s: 9999 }, scroll2: { g: 1600000, s: 9999 },
  cscroll0: { g: 6400, s: 9999 }, cscroll1: { g: 240000, s: 9999 },
}, skills: {} };
// The game's item_grade: one grade per threshold the level reached.
const gradeOf = item => (GAME.items[item.name].grades || []).filter(level => (item.level || 0) >= level).length;
const PLACES = { scrolls: [-464, -96], newupgrade: [-207, -220] };
const BANK_DOOR = [168, -149], BANK_SPAWN = [0, -37], VAULT = [-64, -191], SPEED = 55;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const leg = (from, to) => from === to ? 0 : from === 'bank' ? leg(to, from)
  : to === 'bank' ? distance(PLACES[from], BANK_DOOR) + distance(BANK_SPAWN, VAULT) : distance(PLACES[from], PLACES[to]);
// The run's walk: its stops in order, the scroll seller's visits (each one a shopping trip) and the
// straight-line travel at the merchant's class speed, a lower bound on the real walk.
function walk(route) {
  const stops = route.filter((place, index) => place !== route[index - 1]);
  const seconds = stops.slice(1).reduce((total, place, index) => total + leg(stops[index], place), 0) / SPEED;
  return { stops, trips: stops.filter(place => place === 'scrolls').length, seconds: Math.round(seconds * 10) / 10 };
}

function queueRuntime(items, { gold = 1e9, free = 20, protectedSlots = 0 } = {}) {
  const route = [], purchases = [];
  const bag = [...items, ...Array(free).fill(null)];
  const character = { name: 'M', items: bag, gold, q: {} };
  const onPlayer = name => bag.reduce((sum, item) => sum + (item?.name === name ? item.q : 0), 0);
  const useScroll = slot => { bag[slot] = bag[slot].q > 1 ? { ...bag[slot], q: bag[slot].q - 1 } : null; };
  const { production } = productionHarness({ character, G: GAME,
    bank: {
      merchantVisitBank: async () => { route.push('bank'); },
      retrieveFromBankUntil: async name => ({ onPlayer: onPlayer(name), inBank: 0 }),
    },
    ports: {
      request: emptyCheckpoint, grade: gradeOf, findNpc: name => name, protectedSlots: () => protectedSlots,
      move: async place => { route.push(place); },
      // Every attempt succeeds: the plan is the whole queue's scrolls.
      upgrade: async (slot, scroll) => { useScroll(scroll); bag[slot] = { ...bag[slot], level: bag[slot].level + 1 }; return { success: true, num: slot }; },
      compound: async (a, b, c, scroll) => {
        useScroll(scroll);
        bag[a] = { ...bag[a], level: (bag[a].level || 0) + 1 }; bag[b] = null; bag[c] = null;
        return { success: true };
      },
      buyConfirmed: async (name, quantity) => {
        purchases.push([name, quantity]);
        const at = bag.findIndex(item => item?.name === name);
        if (at >= 0) bag[at] = { ...bag[at], q: bag[at].q + quantity }; else bag[bag.indexOf(null)] = { name, q: quantity };
      },
    } });
  const run = async command => { await production.prepareManualImprovementScrolls(command, []); await production.merchantImprove(command, []); };
  return { production, bag, route, purchases, run };
}

const rings = count => Array.from({ length: count }, () => ({ name: 'ringsj', level: 0 }));
const compoundQueue = () => ({ compounds: Array.from({ length: 5 }, (_, group) => ({ name: 'ringsj', items: rings(3).map(item => ({ item })), id: group })) });
// The mixed queue: +0 to +8 crosses into the high grade, +5 to +7 and +0 to +3 stay normal, +7 to
// +10 runs high and then rare.
const SHOES = [[0, 8], [5, 2], [7, 3], [0, 3]];
const upgradeQueue = () => ({ upgrades: SHOES.map(([level, tiers]) => ({ item: { name: 'wshoes', level }, tiers })) });

test('five queued compounds and a mixed upgrade queue each stock once and run in one trip', async t => {
  const compounds = queueRuntime(rings(15));
  await compounds.run(compoundQueue());
  const compoundWalk = walk(compounds.route);
  t.diagnostic('compounds: ' + JSON.stringify(compoundWalk));
  assert.deepEqual(compounds.purchases, [['cscroll0', 5]]);
  assert.equal(compounds.bag.filter(item => item?.name === 'ringsj' && item.level === 1).length, 5);
  assert.deepEqual(compoundWalk.stops, ['bank', 'scrolls', 'newupgrade']);

  const upgrades = queueRuntime(SHOES.map(([level]) => ({ name: 'wshoes', level })));
  await upgrades.run(upgradeQueue());
  const upgradeWalk = walk(upgrades.route);
  t.diagnostic('upgrades: ' + JSON.stringify(upgradeWalk));
  assert.deepEqual(upgrades.purchases, [['scroll0', 12], ['scroll1', 3], ['scroll2', 1]]);
  assert.deepEqual(upgrades.bag.slice(0, 4).map(item => item.level), [8, 7, 10, 3]);
  assert.deepEqual(upgradeWalk.stops, ['bank', 'scrolls', 'newupgrade']);
});

test('a plan whose new scroll piles would take a protected cell stops before any gold, walk or purchase', async () => {
  // The mixed queue buys three new piles; two free cells stay past the one protected cell.
  const { production, route, purchases } = queueRuntime(SHOES.map(([level]) => ({ name: 'wshoes', level })), { free: 3, protectedSlots: 1 });
  await assert.rejects(production.prepareManualImprovementScrolls(upgradeQueue(), []), error => error.code === 'inventory_full');
  assert.deepEqual([route, purchases], [[], []]);
});

// The live row (live-manual-upgrade.spec.ts at 21fe30a2b "withdrawn manual shield and inventory shield finish
// one mixed upgrade batch"): a withdraw command with upgradeTiers leaves a manual mark on a bank
// copy (coordinator production.ts `putBankUpgrade`) beside a bag mark on another +0 Spiked Shield.
// Both are queued before the job dispatches. The dispatcher builds the merchant's command, and the
// merchant runs it as merchantSelfImprove; the visit's errands withdraw the bank copy (bank.ts
// `merchantBankErrands`, planted here as its withdrawal and landing record). The live run on
// 367447e73 walked bank and scrolls twice with 4 scroll0 each. Game data, G version 18285: sshield
// grades [4,8,10,12], so +0 to +4 is four grade 0 steps.
test('a withdrawn manual mark and a bag mark queued together stock both in one trip', async t => {
  const { createCoordinatorMerchantDispatcher } = require('../../runtime/merchant-jobs/coordinator/dispatch.ts');
  const { publishTasks } = require('../../runtime/tasks/api.ts');
  const { publishEventAnswers } = require('../../runtime/events/api.ts');
  const { itemsDoor } = require('./helpers/coordinator-merchant.cjs');
  const { partyHooks } = require('../../runtime/hooks/index.ts');
  partyHooks().publish({ name: 'core:scroll-batch-reads', folder: 'core', author: 'test', summary: 'No Cave run owns a member and no job is ready.',
    hooks: { 'cave.state': () => ({ owned: false }), 'jobs.ready': () => [] } });
  publishTasks({ groupOf: name => 'party:' + name, live: () => null });
  publishEventAnswers({ deferredReturn: () => false });
  const shield = { name: 'sshield', level: 0 }, source = { pack: 'items0', slot: 0 };
  const state = { merchantQueue: [{ id: 'job', target: 'M', reason: 'manual upgrades' }], merchantCurrent: null,
    nextCommandId: 7, merchantCharacter: 'M', bankbois: {}, bankboiTransaction: null, commands: {}, gatheringModes: [], gatheringCooldowns: {},
    statuses: { M: { seenAt: 100, server: 'USII', items: Array(42).fill(null) } }, activeRealm: 'SR_USII', aldata: { key: 'fixture' }, threshold: 100,
    merchantCargo: {}, npcSaleMarks: [], standListings: [], marked: {}, purchases: {}, compounds: {}, autoCompounds: {},
    upgrades: { M: [
      { requestId: 'withdrawn', slot: -1, item: { ...shield }, tiers: 4, storage: { ...source } },
      { requestId: 'bag', slot: 9, item: { ...shield }, tiers: 4 },
    ] },
    withdrawals: { M: [{ ...source, item: { ...shield } }] }, statScrolls: {}, merchantDeliveries: {}, goldTargets: {}, standBids: {}, merchantMarked: {},
    production: { attempts: {} } };
  itemsDoor(state, { busy: () => false, start: async () => {} });
  createCoordinatorMerchantDispatcher(state, { now: () => 100, ensureHome: () => true, returningHome: () => false, routineNeedsHome: () => false,
    anniversary: () => ({}), routinePriority: () => 0, priority: () => 1, capacityBlocked: () => false, collectionReady: () => true,
    pick: () => state.merchantQueue.shift(), stamp: job => job, planPonty: () => null,
    restock: () => ({}), idle: () => {}, persist: () => {}, log() {} }).dispatch();
  const command = state.commands.M;
  assert.equal(command.type, 'merchant-self-improve');

  const route = [], purchases = [], bags = Array(20).fill(null);
  bags[9] = { ...shield };
  const character = { name: 'M', items: bags, gold: 1e9, q: {}, slots: {}, bank: { items0: [{ ...shield }] } };
  const onPlayer = name => bags.reduce((sum, item) => sum + (item?.name === name ? item.q : 0), 0);
  const { production } = productionHarness({ character, G: { items: { sshield: { upgrade: {}, grades: [4, 8, 10, 12] }, scroll0: { g: 1000, s: 9999 } }, skills: {} },
    bank: {
      merchantVisitBank: async visit => {
        route.push('bank');
        if (visit._merchantBankErrandsChecked) return;
        visit._merchantBankErrandsChecked = true;
        visit._merchantWithdrawalsCompleted = [];
        for (const withdrawal of visit.merchantWithdrawals || []) {
          const to = bags.indexOf(null);
          bags[to] = character.bank[withdrawal.pack][withdrawal.slot];
          character.bank[withdrawal.pack][withdrawal.slot] = null;
          (visit._merchantWithdrawalsLanded ||= []).push({ pack: withdrawal.pack, slot: withdrawal.slot, inventorySlot: to });
          visit._merchantWithdrawalsCompleted.push(withdrawal);
        }
      },
      retrieveFromBankUntil: async name => ({ onPlayer: onPlayer(name), inBank: 0 }),
    },
    ports: {
      request: async (route, options) => route === '/merchant/checkpoint' ? emptyCheckpoint(route, options) : {},
      grade: item => [4, 8, 10, 12].filter(level => (item.level || 0) >= level).length, findNpc: name => name, protectedSlots: () => 0,
      move: async place => { route.push(place); },
      upgrade: async (slot, scroll) => {
        bags[scroll] = bags[scroll].q > 1 ? { ...bags[scroll], q: bags[scroll].q - 1 } : null;
        bags[slot] = { ...bags[slot], level: bags[slot].level + 1 };
        return { success: true, num: slot };
      },
      buyConfirmed: async (name, quantity) => {
        purchases.push([name, quantity]);
        const at = bags.findIndex(item => item?.name === name);
        if (at >= 0) bags[at] = { ...bags[at], q: bags[at].q + quantity }; else bags[bags.indexOf(null)] = { name, q: quantity };
      },
    } });
  await production.merchantSelfImprove(command);
  const shieldWalk = walk(route);
  t.diagnostic('shields: ' + JSON.stringify(shieldWalk));
  assert.deepEqual(purchases, [['scroll0', 8]]);
  assert.equal(shieldWalk.trips, 1);
  assert.deepEqual(bags.filter(item => item?.name === 'sshield').map(item => item.level), [4, 4]);
});
