const test = require('node:test'), assert = require('node:assert/strict');
const {reconcileCoordinatorCompoundMarks: reconcile} = require('../../runtime/coordinator/inventory/compound-marks.ts');
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
