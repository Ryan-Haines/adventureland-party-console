const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('characters/shared.js', 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  function cleanoutRespectsAutoItemLevel('),
  source.indexOf('  async function withMerchantHandoffRecovery(')), context);

test('cleanout cannot bypass a +0 merchant rule to collect delivered +8 breeches', () => {
  const check = context.cleanoutRespectsAutoItemLevel;
  for (const rules of [{ 'wbreeches@+0': 'merchant' }, { wbreeches: 'merchant' }, { 'wbreeches@+0': 'bank' }]) {
    assert.equal(check({ name: 'wbreeches', level: 8, stat_type: 'str' }, rules), false);
    assert.equal(check({ name: 'wbreeches', level: 0 }, rules), true);
    assert.equal(check({ name: 'wbreeches' }, rules), true);
    assert.equal(check({ name: 'unrelated', level: 8 }, rules), true);
  }
  assert.equal(check({ name: 'wbreeches', level: 8 }, { 'wbreeches@+8': 'merchant' }), true);
  assert.equal(check({ name: 'wbreeches', level: 8 }, {}), true);
  assert.match(source, /if \(!cleanoutRespectsAutoItemLevel\(item, command.autoItemMarks\)\) return;/);
});
