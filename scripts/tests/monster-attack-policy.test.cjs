const test = require('node:test');
const assert = require('node:assert/strict');
const { monsterAttackBlock: block } = require('../../runtime/characters/roles/monster-attack-policy.ts');

test('Porcupine physical attacks require a finite range stat of at least 75', () => {
  for (const range of [0, 30, 74.99, NaN, Infinity]) assert.ok(block('porcupine', 'physical', range));
  for (const range of [75, 120, 300]) assert.equal(block('porcupine', 'physical', range), null);
  assert.equal(block('porcupine', 'magical', 30), null);
  assert.equal(block('porcupine', 'pure', 30), null);
});

test('high reflection monsters block magic regardless of range, allowing physical and pure damage', () => {
  for (const monster of ['slenderman', 'tiger', 'goblin']) {
    for (const range of [30, 75, 300]) {
      assert.ok(block(monster, 'magical', range));
      assert.equal(block(monster, 'physical', range), null);
      assert.equal(block(monster, 'pure', range), null);
    }
  }
});

test('unknown attack stats fail closed only for requested dangerous monsters', () => {
  assert.ok(block('porcupine', undefined, NaN));
  assert.ok(block('tiger', undefined, 120));
  for (const monster of ['goo', 'crab', 'armadillo', 'greenjr', undefined])
    assert.equal(block(monster, undefined, NaN), null);
});
