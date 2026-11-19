// The bag holder on the character. A separate file: it asks the holder alone, with
// no game or shared.js context, and no live run plants two operations on one tick. Red on an
// earlier build: no holder.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBag } = require('../../runtime/items/character/owner.ts');
const { createBank } = require('../../runtime/items/character/bank.ts');

test('one operation holds the bag and the facts read the holder record', async () => {
  const bag = createBag();
  bag.connect({ freeCells: () => 7, lucky: () => false, map: () => 'main' });
  bag.queueReply({ bankQueued: true });
  assert.equal(bag.take('banking'), 'taken');
  assert.equal(bag.take('stocking'), 'held:banking', 'a second operation is told the holder');
  assert.deepEqual([bag.facts().banking, bag.facts().stocking, bag.facts().bankQueued, bag.facts().freeCells], [true, false, true, 7]);
  assert.equal(await bag.acquire('banking'), false, 'the holding operation never runs twice');
  const upgrade = bag.acquire('upgrading');
  bag.release('banking');
  assert.equal(await upgrade, true, 'the waiting operation takes the bag at the release');
  assert.equal(bag.facts().upgrading, true);
  bag.release('upgrading');
  assert.equal(bag.busy(), false);
});

test('a preview reads as upgrading, and an inventory command runs beside the holder', async () => {
  const bag = createBag();
  // Row 8 (review-round1): a read before shared.js connects the reads is an order bug, never a full bag.
  assert.throws(() => bag.facts(), /before shared.js connects/);
  bag.connect({ freeCells: () => 7, lucky: () => false });
  assert.equal(bag.take('previewing'), 'taken');
  assert.deepEqual([bag.facts().previewing, bag.facts().upgrading], [true, true]);
  let inside;
  await bag.command(async () => { inside = bag.facts().inventoryCommand; });
  assert.equal(inside, true);
  assert.equal(bag.facts().inventoryCommand, false);
});

// busy() reads the holder alone. Every reply command runs in the command
// band, a convoy walk among them, so a running command holds neither the drain nor the Steam restore
// (live-game "a lost native follower reconnects" was refused with "the bag is held").
test('a running reply command leaves the bag free for the drain', async () => {
  const bag = createBag();
  bag.connect({ freeCells: () => 7, lucky: () => false, map: () => 'main' });
  let during;
  await bag.command(async () => { during = bag.busy(); });
  assert.equal(during, false);
  assert.equal(bag.take('tidying'), 'taken');
  assert.equal(bag.busy(), true);
});

// A one-fact read and a reader's errand row read the holder record and scan no bag cell; the
// formation spread step's row is banking, the bank queue and the stock-up.
test('one fact and an errand row read no free-cell count', () => {
  const bag = createBag();
  let scans = 0;
  bag.connect({ freeCells: () => { scans++; return 7; }, lucky: () => false, map: () => 'main' });
  bag.queueReply({ bankQueued: true });
  assert.deepEqual([bag.fact('bankQueued'), bag.fact('banking'), bag.errandFor('formation')], [true, false, true]);
  bag.queueReply({ bankQueued: false });
  assert.equal(bag.take('upgrading'), 'taken');
  assert.equal(bag.errandFor('formation'), false, 'an upgrade does not hold the spread step');
  assert.equal(scans, 0);
});

// A character-side failure carries its code beside its text, so a reader takes the class, not the
// text (red on an earlier build: the throw carried text only).
test('a failure names its I7 code and keeps its text', () => {
  const { itemFailure, failureClass } = require('../../runtime/items/rules.ts');
  const error = itemFailure('short_gold', 'Insufficient bank gold for donation');
  assert.deepEqual([error.code, error.reason, failureClass(error.code)], ['short_gold', 'Insufficient bank gold for donation', 'gold']);
  assert.equal(itemFailure('interrupted').reason, 'interrupted');
});

// Row "each fact follows the holder": every holder kind is taken and released in turn, and every
// fact is read after each step. A planted write to a fact's name on the bag object changes no
// answer, since facts() computes from the holder record. Red on an earlier build: no holder.
test('each fact follows the holder', () => {
  const bag = createBag();
  let cells = 5, lucky = false;
  bag.connect({ freeCells: () => cells, lucky: () => lucky, map: () => 'main' });
  const kinds = ['banking', 'stocking', 'upgrading', 'previewing', 'producing', 'purchasing', 'pinning', 'tidying', 'merging'];
  const idle = { banking: false, bankQueued: false, stocking: false, upgrading: false, previewing: false, tidying: false,
    lucky: false, holder: null, freeCells: 5, inventoryCommand: false, inventoryCommands: 0, label: null };
  assert.deepEqual(bag.facts(), idle);
  for (const kind of kinds) {
    assert.equal(bag.take(kind), 'taken', kind);
    const facts = bag.facts();
    assert.equal(facts.holder, kind);
    assert.equal(facts.banking, kind === 'banking', `${kind} banking`);
    assert.equal(facts.stocking, kind === 'stocking', `${kind} stocking`);
    assert.equal(facts.upgrading, kind === 'upgrading' || kind === 'previewing', `${kind} upgrading`);
    assert.equal(facts.previewing, kind === 'previewing', `${kind} previewing`);
    assert.equal(facts.tidying, kind === 'tidying', `${kind} tidying`);
    assert.equal(facts.label, kind === 'banking' || kind === 'stocking' ? 'Travelling to bank' : null, `${kind} label`);
    assert.equal(bag.busy(), true);
    bag.release(kind);
    assert.deepEqual(bag.facts(), idle, `${kind} released`);
  }
  // The two reads added follow the character, not a stored copy; the queued visit is the last reply's.
  cells = 2; lucky = true; bag.queueReply({ bankQueued: true });
  assert.deepEqual([bag.facts().freeCells, bag.facts().bankQueued, bag.facts().lucky], [2, true, true]);
  // A planted write to a fact's name, as today's flags took, changes no answer.
  Object.assign(bag, { banking: true, tidying: true, inventoryCommand: true, holder: 'banking' });
  assert.deepEqual([bag.facts().banking, bag.facts().tidying, bag.facts().inventoryCommand, bag.facts().holder], [false, false, false, null]);
  assert.equal(bag.busy(), false);
});

// (fighter half): every walk of a fighter's bank run carries the bag holder's errand identity
// `items:banking:<id>`, which movement's request reads (owner.ts `itemsErrand`). Red on an
// earlier build: the walk went out as a bare `errand`.
test('a fighter bank run walks under its items errand', async () => {
  const { bankHarness } = require('./helpers/items-character.cjs');
  const character = { name: 'Fighter', ctype: 'warrior', map: 'main', x: 0, y: 0, items: [null, null], bank: { items0: Array(42).fill(null) }, gold: 0 };
  const requests = [];
  const harness = bankHarness({ character, ports: {
    errand: () => harness.bag.errand(),
    move: async (destination, _callback, options) => { requests.push(options?.request); character.map = typeof destination === 'string' ? destination : destination.map; },
  } });
  await harness.bank.goBank([], [], 0);
  assert.ok(requests.length >= 2, 'the walk there and the walk back');
  assert.ok(requests.every(request => /^items:banking:\d+$/.test(request)), JSON.stringify(requests));
  assert.equal(harness.bag.busy(), false);
});

// The merchant's bag merge runs only beside its own job's command, and a merge a call ends keeps
// the call's reason and fails no job. Red on an earlier build: the merge planned beside a second
// command, and the swap's error rethrew out of mergeBag.
test('a merge skips beside another inventory command and keeps its failure', async () => {
  const bag = createBag();
  bag.connect({ freeCells: () => 0, lucky: () => false, map: () => 'main' });
  const character = { ctype: 'merchant', name: 'Merchant', items: [{ name: 'hpot0', q: 5 }, { name: 'hpot0', q: 5 }] };
  let planned = 0;
  const bank = createBank({ character: () => character, G: () => ({ items: { hpot0: { s: 9999 } } }), bankPacks: () => ({}),
    margin: () => 1, sleep: async () => {}, now: () => 0, current: () => true, bag, reads: {}, saved: () => null, save() {},
    request: async () => { planned += 1; return { merge: { from: 1, to: 0, quantity: 5, target: { name: 'hpot0', q: 5 }, source: { name: 'hpot0', q: 5 } } }; },
    canStack: () => true, split: async () => {}, swap: async () => { throw Error('refused'); } });
  await bag.command(() => bag.command(async () => assert.equal(await bank.mergeBag(), 0)));
  assert.equal(planned, 0, 'no merge plans beside another command');
  await bag.command(async () => assert.equal(await bank.mergeBag(), 0));
  assert.equal(planned, 1);
  assert.equal(bank.stackError(), 'refused');
  assert.equal(bag.facts().holder, null, 'the merge released the bag');
});
