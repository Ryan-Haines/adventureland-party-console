const test = require('node:test'), assert = require('node:assert/strict');
const {coordinatorMerchantPriority: priority, coordinatorPrioritizedBids: bids,
  coordinatorMerchantTransferBlocked: blocked, coordinatorMerchantCapacitySignature: signature} = require('../../runtime/merchant-jobs/rules.ts');

function state() {
  return {bankbois: {B:{name:'B'}}, merchantCharacter: 'M', merchantRoutinePriorities: {'manual bank exchange': 20, 'stand bid purchases': 40},
    standBids: {first: {priorityOverride: 80}, second: {priorityOverride: 80}, last: {}},
    withdrawals: {M: [{pack: 'items1', slot: 35}]}, bankSnapshot: {packs: {items1: {35: {name: 'leather'}}}},
    statuses: {M: {items: [{name: 'occupied'}, null, null, null]}, P: {items: []}}};
}

test('priority follows occupied outbound staging while stable bid ties retain their identities', () => {
  const s = state(), job = {target: 'M', reason: 'manual bank exchange', priorityOverride: 99};
  assert.equal(priority(s, job), 101);
  s.bankSnapshot = {packs: {items1: {}}}; assert.equal(priority(s, job), 99);
  s.bankSnapshot.packs.items1[34] = {name: 'leather'}; s.withdrawals.M[0].slot = 34;
  assert.equal(priority(s, job), 99);
  const result = bids(s, 'stand bid purchases'); assert.deepEqual(result.map(([name]) => name), ['first', 'second', 'last']);
  assert.equal(result[0][1], s.standBids.first);
});

test('transfer capacity reserves three free slots only for incoming collection jobs', () => {
  const s = state(), job = {target: 'P', reason: 'marked items'};
  assert.equal(blocked(s, job), true);
  assert.equal(blocked(s, {...job, target: 'M'}), false);
  assert.equal(blocked(s, {...job, reason: 'manual bank exchange'}), false);
  s.statuses.M.items.push(null); assert.equal(blocked(s, job), false);
  s.statuses.M.items = {}; assert.equal(blocked(s, job), false);
  assert.equal(blocked(s, null), false);
});
test('incomplete withdrawal slots never acquire outbound handoff priority', () => {
  const s = state(), job = {target: 'M', reason: 'manual bank exchange'};
  for (const slot of [undefined, null, NaN, 34]) {
    s.withdrawals.M = [{pack: 'items1', slot}];
    assert.equal(priority(s, job), 20);
  }
  s.withdrawals.M = [{pack: 'items1', slot: 35}];
  assert.equal(priority(s, job), 101);
});

test('capacity signatures ignore travel and gold but track inventory and bank changes', () => {
  const s = state(), initial = signature(s, 'P');
  Object.assign(s.statuses.M, {gold: 200000, x: 100, seenAt: 900});
  assert.equal(signature(s, 'P'), initial);
  s.statuses.P = {items: [{item: {name: 'leather', q: 1}}]};
  const inventoryChanged = signature(s, 'P'); assert.notEqual(inventoryChanged, initial);
  s.bankSnapshot.packs.items2 = {}; assert.notEqual(signature(s, 'P'), inventoryChanged);
});

// v1.5 row 15 (e2e/merchant-sale-scheduling-failures.md item 4): a merchant bank job that carries
// auto NPC stock runs at the sale's priority; its own gates stay, and nothing else is lifted.
test('a bank job carrying auto NPC stock lends the sale its priority, and only that job', () => {
  const s = {merchantCharacter: 'M', bankbois: {}, merchantRoutinePriorities: {withdrawals: 30, 'bank collection': 30, 'auto npc sales': 80, 'manual bank exchange': 20},
    withdrawals: {M: [{pack: 'items0', slot: 3, autoNpcRuleKey: 'leather'}]}, merchantAutomations: {}};
  for (const reason of ['withdrawals', 'bank collection']) assert.equal(priority(s, {target: 'M', reason}), 80, reason);
  assert.equal(priority(s, {target: 'M', reason: 'manual bank exchange'}), 20);
  assert.equal(priority(s, {target: 'P', reason: 'withdrawals'}), 30);
  s.merchantAutomations['auto npc sales'] = false; assert.equal(priority(s, {target: 'M', reason: 'withdrawals'}), 30);
  s.merchantAutomations = {}; s.withdrawals.M = [{pack: 'items0', slot: 3}]; assert.equal(priority(s, {target: 'M', reason: 'withdrawals'}), 30);
  // A sale priority below the job's own leaves the job's.
  s.withdrawals.M[0].autoNpcRuleKey = 'leather'; s.merchantRoutinePriorities['auto npc sales'] = 10;
  assert.equal(priority(s, {target: 'M', reason: 'withdrawals'}), 30);
});
