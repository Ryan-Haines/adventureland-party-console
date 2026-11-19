const test = require('node:test'), assert = require('node:assert/strict');
const {reconcileCoordinatorCompoundMarks: reconcile} = require('../../runtime/items/coordinator/production.ts');
const item = {name: 'ringsj', level: 0};
const group = (id, slots, identity = item) => ({id, items: slots.map(slot => ({slot, item: {...identity}}))});
const inventory = slots => ({items: slots.map(slot => ({slot, item: {...item}}))});

test('sorting preserves all three compound badges and group identity with one unchanged slot', () => {
  const original = group('group-1', [2, 8, 12]);
  const state = {compounds: {M: [original]}};
  assert.equal(reconcile(state, 'M', inventory([0, 1, 2])), true);
  assert.equal(state.compounds.M[0], original);
  assert.deepEqual(original.items.map(mark => mark.slot), [2, 0, 1]);
  assert.equal(reconcile(state, 'M', inventory([0, 1, 2])), false);
});

test('identical copies across groups each retain a distinct reservation', () => {
  const state = {compounds: {M: [group('a', [5, 8, 9]), group('b', [0, 11, 12])]}};
  assert.equal(reconcile(state, 'M', inventory([0, 1, 2, 3, 4, 5, 6])), true);
  const slots = state.compounds.M.flatMap(group => group.items.map(mark => mark.slot));
  assert.equal(new Set(slots).size, 6);
  assert.equal(state.compounds.M[1].items[0].slot, 0);
  assert.equal(state.compounds.M[0].items[0].slot, 5);
});

test('partial reports and consumed or different items do not corrupt pending groups', () => {
  const state = {compounds: {M: [group('a', [5, 8, 9])]}};
  const before = structuredClone(state);
  for (const report of [undefined, {}, {items: []}, inventory([0, 1]),
    {items: [0, 1, 2].map(slot => ({slot, item: {...item, level: 1}}))}]) {
    assert.equal(reconcile(state, 'M', report), false);
    assert.deepEqual(state, before);
  }
});

test('item variants retain their own identities after sorting', () => {
  const special = {...item, p: 'shiny'};
  const state = {compounds: {M: [group('a', [5, 8, 9], special)]}};
  const report = {items: [...inventory([0, 1, 2]).items,
    ...[3, 4, 5].map(slot => ({slot, item: {...special}}))]};
  assert.equal(reconcile(state, 'M', report), true);
  assert.deepEqual(state.compounds.M[0].items.map(mark => mark.slot), [5, 3, 4]);
});

test('ordinary marks cannot relocate onto decorated copies', () => {
  const state = {compounds: {M: [group('a', [5, 8, 9])]}};
  assert.equal(reconcile(state, 'M', {items: [0, 1, 2].map(slot => ({slot, item: {...item, p: 'shiny'}}))}), false);
  assert.deepEqual(state.compounds.M[0].items.map(mark => mark.slot), [5, 8, 9]);
});

// IT60: a manual compound may take its triplet from a
// BankBoi's stock; the selection names the BankBoi pack and the group keeps each copy's storage.
test('a manual compound selects its triplet from BankBoi stock', () => {
  const {createCompoundCommands} = require('../../runtime/items/coordinator/production.ts');
  const ring = {name: 'ring', level: 1};
  const state = {merchantCharacter: 'M', compounds: {}, autoCompounds: {}, autoUpgradeMarks: {}, upgrades: {}, merchantQueue: [], merchantCurrent: null,
    statuses: {M: {items: []}}, bankSnapshot: {packs: {}}, bankbois: {B: {name: 'B', items: [0, 1, 2, 3].map(slot => ({slot, item: {...ring}}))}},
    merchantCatalog: {allItems: [{id: 'ring', meta: {compoundable: true}}]}};
  const queued = [];
  const service = createCompoundCommands(state, {write: () => ({ok: true}), persist() {}, schedule() {}, log() {}, queue: (names, reason) => queued.push(reason)});
  service.handle({type: 'compound-mark', character: 'M', pack: 'bankboi:B', slot: 0, item: ring});
  assert.deepEqual(state.compounds.M?.[0]?.items.map(mark => mark.storage), [{pack: 'bankboi:B', slot: 0}, {pack: 'bankboi:B', slot: 1}, {pack: 'bankboi:B', slot: 2}]);
  assert.deepEqual(queued, ['manual compounds']);
  // v1.5 row 38: a cell with a pending withdrawal is left out of the next triplet.
  state.compounds.M = []; state.withdrawals = {M: [{pack: 'bankboi:B', slot: 1, item: ring, improvement: 'manual upgrades'}]};
  service.handle({type: 'compound-mark', character: 'M', pack: 'bankboi:B', slot: 0, item: ring});
  assert.deepEqual(state.compounds.M?.[0]?.items.map(mark => mark.storage.slot), [0, 2, 3]);
});
