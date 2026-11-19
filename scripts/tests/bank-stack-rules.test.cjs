// The bank stack plans (v1.5.0 runtime/bank-stacks.ts:21-56) in
// runtime/items/rules.ts. A locked pile is protected, an account-bound pile stays apart, and the
// game's `can_stack`, passed as `compatible`, merges what the pile key keeps apart.
const test = require('node:test'), assert = require('node:assert/strict');
const {stackProtected, stackDepositPlan, nextStackMerge} = require('../../runtime/items/rules.ts');
const none = {locations: [], items: []};
const at = (slot, item) => ({pack: 'items0', slot, item});

test('a locked bank pile is protected, an unlocked one is not', () => {
  assert.equal(stackProtected(at(0, {name: 'gem0', q: 5, l: 'l'}), none), true);
  assert.equal(stackProtected(at(0, {name: 'gem0', q: 5}), none), false);
});

test('an account-bound pile stays apart, and can_stack merges a stackable title', () => {
  const cells = [at(0, {name: 'spidersilk', q: 39}), at(1, {name: 'spidersilk', q: 26, acl: 1}), at(2, {name: 'spidersilk', q: 7, p: 'cavefound'})];
  assert.equal(nextStackMerge(cells.slice(0, 2), () => 9999), null);
  assert.deepEqual(stackDepositPlan({name: 'spidersilk', q: 5, acl: 1}, 9999, cells.slice(0, 2)).moves.map(move => move.slot), [1]);
  // The pinned client's can_stack lets a title G.titles marks stackable share an untitled pile.
  const native = (a, b) => a.name === b.name && !!a.acl === !!b.acl && (!a.p || a.p === 'cavefound') && (!b.p || b.p === 'cavefound');
  assert.equal(nextStackMerge([cells[0], cells[2]], () => 9999), null);
  const merge = nextStackMerge([cells[0], cells[2]], () => 9999, native);
  assert.deepEqual([merge.target.slot, merge.source.slot, merge.quantity], [0, 2, 7]);
  assert.deepEqual(stackDepositPlan({name: 'spidersilk', q: 5, p: 'cavefound'}, 9999, cells, native).moves.map(move => move.slot), [0]);
});
