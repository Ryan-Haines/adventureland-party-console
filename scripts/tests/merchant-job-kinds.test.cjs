// (separate: no live run meets every reason): J5's record answers each question the reason
// lists of v1.5.0 answered, for every reason of the saved defaults and the aliases. Each
// list is typed here as held it, so the table cannot drift from what the lists said; the list
// functions are gone.
const test = require('node:test'), assert = require('node:assert/strict');
const { merchantKind, defaultMerchantRoutinePriorities, HOLDS, ENDINGS, endingOf, interruptOf, ladderFrom, routineFor, merchantRoutinePriority } = require('../../runtime/merchant-jobs/rules.ts');

const reasons = [...new Set([...Object.keys(defaultMerchantRoutinePriorities()), 'exchange', 'bank collection', 'native stand funding',
  'Ponty purchases', 'stat scrolls', 'marked items', 'exchange pickup', 'inventory cleanout', 'merchant luck exchange', 'service', 'resumed service'])];
const lists = {
  home: r => !['ALData marketplace purchases', 'ALData marketplace sales', 'join giveaway', 'Ponty purchases', 'stand maintenance'].includes(r),
  listing: r => ['ALData marketplace purchases', 'ALData marketplace sales', 'join giveaway', 'Ponty purchases'].includes(r),
  buy: r => ['stand purchases', 'stand bid purchases', 'Ponty purchases', 'ALData marketplace purchases'].includes(r),
  bid: r => ['stand bid purchases', 'Ponty purchases', 'ALData marketplace purchases'].includes(r),
  market: r => ['ALData marketplace purchases', 'ALData marketplace sales', 'Ponty purchases'].includes(r),
  resumable: r => ['ALData marketplace purchases', 'Ponty purchases'].includes(r),
  processing: r => ['auto upgrade', 'auto compound', 'auto npc sales'].includes(r),
  separate: r => ['exchange pickup', 'deliveries', 'manual upgrades', 'auto upgrade', 'manual compounds', 'auto compound', 'manual buying',
    'npc sale pickup', 'auto npc sale pickup', 'npc sales', 'auto npc sales'].includes(r),
  bank: r => ['withdrawals', 'bank collection'].includes(r),
  pickupGroup: r => ['inventory cleanout', 'marked items'].includes(r),
  autoPickup: r => ['auto upgrade', 'auto compound', 'auto npc sale pickup', 'deconstruction pickup'].includes(r),
  collects: r => ['party collection', 'marked items', 'inventory cleanout', 'exchange pickup'].includes(r),
  threshold: r => ['marked items', 'exchange pickup', 'npc sale pickup', 'auto npc sale pickup'].includes(r),
  salePickup: r => ['npc sale pickup', 'auto npc sale pickup'].includes(r),
  staging: r => ['withdrawals', 'bank collection', 'manual bank exchange', 'upgrades and compounds', 'manual upgrades', 'auto upgrade',
    'manual compounds', 'auto compound'].includes(r),
  slots: r => ['marked items', 'inventory cleanout', 'exchange pickup'].includes(r),
  improvement: r => ['upgrades and compounds', 'manual upgrades', 'auto upgrade', 'manual compounds', 'auto compound'].includes(r),
  resource: r => ['upgrades and compounds', 'manual upgrades', 'auto upgrade', 'manual compounds', 'auto compound', 'merchant commerce'].includes(r),
  noReplay: r => r === 'npc sales',
  failsSales: r => ['npc sales', 'auto npc sales'].includes(r),
  never: r => r === 'ALData marketplace sales',
  luck: r => ['merchant luck', 'merchant luck exchange'].includes(r),
  recheck: r => ['stand bid purchases', 'ALData marketplace purchases', 'Ponty purchases'].includes(r),
};
const commandTypes = { 'bank unlock': 'merchant-bank-unlock', 'manual bank exchange': 'merchant-self-bank', withdrawals: 'merchant-self-bank',
  'bank collection': 'merchant-self-bank', 'native stand funding': 'merchant-self-bank', restock: 'merchant-self-restock',
  'merchant commerce': 'merchant-commerce', exchange: 'merchant-exchange', 'merchant donation': 'merchant-donate', 'stand search': 'merchant-stand-search',
  'join giveaway': 'merchant-join-giveaway', 'send mail': 'merchant-send-mail', 'collect mail': 'merchant-collect-mail',
  'Ponty purchases': 'merchant-ponty-buy', 'ALData marketplace purchases': 'merchant-aldata-buy', 'ALData marketplace sales': 'merchant-aldata-sell',
  'ALData authentication': 'merchant-aldata-auth', 'stand purchases': 'merchant-stand-buy', 'stand bid purchases': 'merchant-stand-buy',
  'npc sales': 'merchant-npc-sale', 'auto npc sales': 'merchant-npc-sale', deconstruction: 'merchant-deconstruct' };

test('J5 answers every reason list of for every saved reason and alias', () => {
  const disagreements = [];
  for (const reason of reasons) {
    const kind = merchantKind(reason);
    const answers = { home: kind.realm === 'home', listing: kind.realm === 'listing', buy: !!kind.purchase, bid: kind.purchase === 'bid',
      market: !!kind.market, resumable: !!kind.resumable, processing: !!kind.processing, separate: !!kind.separate,
      bank: kind.mergeGroup === 'bank', pickupGroup: kind.mergeGroup === 'pickup', autoPickup: !!kind.autoPickup, collects: !!kind.collects,
      threshold: !!kind.thresholdCollection, salePickup: !!kind.salePickup, staging: !!kind.releasesStaging, slots: !!kind.needs?.slots,
      improvement: !!kind.improvement, resource: !!kind.resourceHold, noReplay: kind.retry === 'never', failsSales: !!kind.failsSales,
      never: kind.interrupt === 'never', luck: !!kind.luck, recheck: kind.after === 'market-recheck' };
    for (const [list, answer] of Object.entries(lists)) if (answers[list] !== answer(reason)) disagreements.push(reason + ' ' + list);
    if ((kind.command || 'merchant-self-improve') !== (commandTypes[reason] || 'merchant-self-improve')) disagreements.push(reason + ' command');
  }
  assert.deepEqual(disagreements, []);
});

// The alias tables J5's records replaced, typed as held them (routines.ts:4, priority.ts:27-36), with 'auto
// npc withdrawals' row; 'bank collection' keeps the status owner's queue words.
test('J5 gives the routine and priority aliases of and the bank collection label', () => {
  const routineAliases = { 'exchange pickup': 'manual exchange', 'stand search': 'manual marketplace purchases', 'marked items': 'party collection',
    'npc sale pickup': 'npc sales', 'auto npc sale pickup': 'auto npc sales', 'auto npc withdrawals': 'auto npc sales', 'upgrades and compounds': 'manual upgrades' };
  const priorityAliases = { 'Ponty purchases': 'stand bid purchases', 'marked items': 'party collection' };
  const priorities = Object.fromEntries(Object.keys(defaultMerchantRoutinePriorities()).map((key, index) => [key, index]));
  for (const [reason, routine] of Object.entries(routineAliases)) assert.equal(routineFor({ reason }), routine, reason);
  assert.equal(routineFor({ reason: 'restock' }), 'restock');
  for (const reason of [...reasons, 'auto npc withdrawals']) {
    const key = priorityAliases[reason] ?? reason;
    assert.equal(merchantRoutinePriority(priorities, reason), key in priorities ? priorities[key] : 50, reason);
  }
  assert.equal(merchantKind('bank collection').label, 'Bank item collection');
});

test('J1, J3 and J4 rows give the dispatcher, checkpoint and classifier decisions of', () => {
  // J1: the rows sit in the order v1.5.0's dispatch tested them.
  assert.deepEqual(HOLDS.map(row => row.holder), ['lifecycle', 'party-switch', 'event', 'production', 'upgrade-bag', 'cast', 'realm-hold:visit',
    'realm-hold:home', 'merchant', 'job', 'no-merchant', 'manual', 'storage', 'anniversary:featured', 'anniversary', 'user:force-stand']);
  // J3: an atomic step never yields; an event yields; equal priority never preempts.
  const base = { cycleBoundary: true, reserved: false, kind: merchantKind('manual upgrades'), manualHeld: false, currentPriority: 70, waitingPriority: 70 };
  assert.equal(interruptOf({ ...base, cycleBoundary: false, reserved: true }).yields, false);
  assert.equal(interruptOf({ ...base, reserved: true }).yields, true);
  assert.equal(interruptOf(base), null);
  assert.equal(interruptOf({ ...base, waitingPriority: 71 }).yields, true);
  // J4: each ending keeps the id, place and wait the classifier gave.
  const facts = { movementOwned: false, movement: false, anniversaryYield: false, realm: false, rendezvous: false, storageYield: false,
    death: false, interrupted: false, interruptedOrder: false, commerce: false, kind: merchantKind('manual upgrades') };
  const pick = changes => { const row = endingOf({ ...facts, ...changes }); return row && [row.id, row.queuedAt, row.retryAt, row.counts]; };
  assert.deepEqual(pick({ movementOwned: true }), ['keep', 'keep', 'none', false]);
  assert.deepEqual(pick({ storageYield: true }), ['keep', 'now', 'none', false]);
  assert.deepEqual(pick({ rendezvous: true }), ['new', 'now', 'ten-seconds', false]);
  assert.deepEqual(pick({ interrupted: true, death: true }), ['new', 'now', 'ten-seconds', true]);
  assert.equal(pick({ interrupted: true, kind: merchantKind('npc sales') }), null);
  assert.equal(pick({}), null);
  // A failed buy-upgrade order waits the commerce delay at every row but a death, a movement failure
  // and a realm failure.
  const order = changes => pick({ interruptedOrder: true, ...changes })[2];
  for (const ending of ['movementOwned', 'anniversaryYield', 'rendezvous', 'storageYield']) assert.equal(order({ [ending]: true }), 'commerce', ending);
  assert.deepEqual([order({ death: true }), order({ movement: true }), order({ realm: true })], ['ten-seconds', 'movement-streak', 'realm']);
  // 08-1's cause 7 named row 8's ladder `realm-switch`.
  assert.equal(ENDINGS.every(row => row.ladder === null || ['job-interrupted', 'rendezvous-timeout', 'realm-switch'].includes(row.ladder)), true);
  // The rung a booked failure climbs from follows the job's own count.
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(ladderFrom), ['walk', 'alternative', 'regroup', 'safe-point', 'fall-back', 'fall-back']);
});

// A job that needs slots reads the items owner's free slots, which count neither the protected
// cells nor the lucky slot's held cell.
test("a job that needs slots is blocked when the lucky slot's hold takes the last free cell", () => {
  const { coordinatorMerchantTransferBlocked } = require('../../runtime/merchant-jobs/rules.ts');
  const items = Array(42).fill({ name: 'junk' }); for (const cell of [38, 39, 40, 41]) items[cell] = null;
  const state = { merchantCharacter: 'M', protectedFreeSlots: 3, statuses: { M: { items } }, luckySlotLocks: {} };
  const job = { target: 'F', reason: 'marked items' };
  assert.equal(coordinatorMerchantTransferBlocked(state, job), false, 'one cell past the three protected');
  state.luckySlotLocks.M = 41;
  assert.equal(coordinatorMerchantTransferBlocked(state, job), true, 'the lucky slot holds that cell');
  // The items owner's rule: a resume slot with no lock holds its cell too, as bagFull counts
  // it.
  delete state.luckySlotLocks.M; state.luckySlotResume = { M: { slot: 41 } };
  assert.equal(coordinatorMerchantTransferBlocked(state, job), true, 'the resume slot holds that cell');
});

// and: the visit's order handoff wait and the walk pause's deadline are named picks of the merchant
// job owner's rules (HANDOFF, MERCHANT_PAUSE_DEADLINE_MS) at v1.5.0's values, with no
// hidden declaration a saved state could set.
test('the handoff wait and the walk pause deadline are 08 rule picks, not hidden settings', () => {
  const rules = require('../../runtime/merchant-jobs/rules.ts');
  const { merchantJobsSavedFields } = require('../../runtime/merchant-jobs/coordinator/saved-fields.ts');
  assert.equal(rules.HANDOFF.playerWaitMs, 45_000);
  assert.equal(rules.MERCHANT_PAUSE_DEADLINE_MS, 60_000);
  for (const field of ['handoffPlayerWaitMs', 'merchantPauseDeadlineMs']) assert.equal(merchantJobsSavedFields.settings[field], undefined, field);
});

// The merchant job owner's kind table answers a job's whole label, which the card reads
// through runtime/merchant-jobs/api.ts; a bank collection job reads its own J5 words.
test('the merchant job owner answers every merchant job label, a bank collection job included', () => {
  const { merchantJobLabel } = require('../../runtime/merchant-jobs/api.ts');
  const catalog = [{ id: 'wcap', name: 'Wool Cap' }];
  assert.equal(merchantJobLabel({ reason: 'bank collection', target: 'P' }), 'Bank item collection');
  assert.equal(merchantJobLabel({ reason: 'party collection', target: 'P', operationStage: 'retrieving' }), 'Bank retrieval');
  assert.equal(merchantJobLabel({ reason: 'party collection', target: 'P', operationStage: 'storing' }), 'Bank storage');
  assert.equal(merchantJobLabel({ reason: 'join giveaway', target: 'M', seller: 'Host', expectedItem: { name: 'wcap', level: 2 } }, catalog),
    "Join Host's giveaway for Wool Cap +2");
  assert.equal(merchantJobLabel({ reason: 'merchant commerce', target: 'M', order: { buys: [{ desiredLevel: 3 }] } }), 'Buy and upgrade');
  assert.equal(merchantJobLabel({ reason: 'merchant commerce', target: 'M', order: { buys: [{}] } }), 'Buy');
  assert.match(merchantJobLabel({ reason: 'Ponty purchases', target: 'M', manual: true,
    listings: [{ item: { name: 'wcap', level: 0 }, quantity: 2, serverRegion: 'US', serverIdentifier: 'II' }] }, catalog),
  / · Ponty · 2 × Wool Cap \+0 · US II$/);
});

// The merchant job owner's routine table answers which routines have an automation switch a cancel
// turns off, the eleven of x, and their dialog words.
test('the merchant job owner answers which routines a cancel switches off', () => {
  const { automaticRoutine, ROUTINE_DIALOG_LABELS } = require('../../runtime/merchant-jobs/api.ts');
  const automatic = ['merchant luck', 'restock', 'gold threshold', 'inventory cleanout', 'auto compound', 'auto upgrade',
    'automatic exchange', 'stand bid purchases', 'party collection', 'auto npc sales', 'join giveaway'];
  assert.deepEqual(Object.keys(ROUTINE_DIALOG_LABELS).filter(automaticRoutine).sort(), [...automatic].sort());
  for (const routine of ['deliveries', 'withdrawals', 'manual compounds', 'fishing']) assert.equal(automaticRoutine(routine), false, routine);
});

// The dispatch and the completion read these facts from J5's record, not from the reason string:
// a giveaway expires, a Ponty purchase plans its listings, a cleanout repeats while the member's
// bag stays full, and deliveries and manual compounds need their target's saved work.
test('J5 answers the expiry, Ponty plan, cleanout repeat and saved work facts', () => {
  const facts = reason => { const k = merchantKind(reason); return [k.expires, k.plansPonty, k.repeatsCleanout, k.work]; };
  assert.deepEqual(facts('join giveaway'), [true, undefined, undefined, undefined]);
  assert.deepEqual(facts('Ponty purchases'), [undefined, true, undefined, undefined]);
  assert.deepEqual(facts('inventory cleanout'), [undefined, undefined, true, undefined]);
  assert.deepEqual(facts('deliveries'), [undefined, undefined, undefined, 'deliveries']);
  assert.deepEqual(facts('manual compounds'), [undefined, undefined, undefined, 'compounds']);
  assert.deepEqual(facts('restock'), [undefined, undefined, undefined, undefined]);
});

// The command and the card ask J5's `luck`, so the old saved 'merchant luck exchange' reason expands
// its luck cluster and casts like 'merchant luck'; the native stand's gold target rides its own
// record's details, and every other own job carries the working gold.
test('J5 fields answer the luck cluster and the native stand gold target', () => {
  const { partyMerchantCommand, ownMerchantCommand } = require('../../runtime/merchant-jobs/coordinator/commands.ts');
  const inputs = { merchant: 'M', work: () => ({ withdrawals: [], marked: [], goldTarget: 0 }), npcSales: [], statScrolls: {}, restock: () => ({}),
    gatheringModes: [], workingGold: 7, visitWithdrawals: () => [] };
  for (const reason of ['merchant luck', 'merchant luck exchange']) {
    const command = partyMerchantCommand(1, { id: 'j', target: 'A', reason }, { seenAt: 0, items: [] }, inputs);
    assert.deepEqual([command.expandLuckCluster, command.castMerchantLuck], [true, true], reason);
  }
  assert.equal(merchantKind('merchant luck exchange').luck, true);
  assert.equal(ownMerchantCommand(1, { id: 'n', target: 'M', reason: 'native stand funding', goldTarget: 42 }, inputs).goldTarget, 42);
  assert.equal(ownMerchantCommand(1, { id: 'b', target: 'M', reason: 'manual bank exchange', goldTarget: 42 }, inputs).goldTarget, 7);
});
