const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('characters/shared.js', 'utf8');
const start = source.indexOf('  function abtestingEnemySpawn(');
const end = source.indexOf('\n  function ownedCharacterNames(', start);
assert.ok(start >= 0 && end > start, 'could not extract abtestingEnemySpawn');
const context = vm.createContext({});
vm.runInContext(source.slice(start, end) + '\nthis.route = abtestingEnemySpawn;', context);

test('team A searches toward team B on the left', () => {
  assert.deepEqual({ ...context.route('A') }, { x: -832, y: 0 });
});

test('team B feeder searches toward team A on the right', () => {
  assert.deepEqual({ ...context.route('B') }, { x: 832, y: 0 });
});
