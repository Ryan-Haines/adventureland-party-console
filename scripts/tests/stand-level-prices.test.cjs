const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../../dashboard/node_modules/typescript');

function loadModule(name) {
  const filename = `dashboard/features/party/${name}`;
  const path = fs.existsSync(`${filename}.ts`) ? `${filename}.ts` : `${filename}.tsx`;
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ exports: {}, require: name => loadModule(name.replace('./', '')) });
  vm.runInContext(code, context);
  return context.exports;
}
const { levelPriceHistory } = loadModule('level-price-history');

test('stand price shortcuts exclude other levels independently for every observation', () => {
  const history = {
    lowest: 100, lowestLevel: 0,
    recent: 800, recentLevel: 8,
    marketLow: 700, marketLowLevel: 7,
    highestPublicWTB: 600, highestPublicWTBLevel: 8,
  };
  const prices = levelPriceHistory(history, 8);
  assert.equal(prices.recent, 800);
  assert.equal(prices.highestPublicWTB, 600);
  assert.equal(prices.lowest, undefined);
  assert.equal(prices.marketLow, undefined);
  assert.equal(levelPriceHistory(history, 0).recent, undefined);
  assert.equal(levelPriceHistory(history, 0).lowest, 100);
  assert.equal(levelPriceHistory(history, 7).marketLow, 700);
  assert.equal(history.recent, 800);
});

test('missing history and legacy observations without levels cannot supply a price', () => {
  for (const history of [undefined, { lowest: 100, recent: 200, marketLow: 300, highestPublicWTB: 400 }]) {
    for (const level of [0, 8]) {
      assert.ok(Object.values(levelPriceHistory(history, level)).every(value => value === undefined));
    }
  }
});
