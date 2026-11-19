const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');

// Exercise the projection the dialog uses, including its stat and set deltas. P: the projection is
// dashboard/lib/gear-projection.ts, loaded whole as the dialog imports it, with the game's stat
// lines from dashboard/lib/game-formulas.ts.
const file = path.resolve(__dirname, '../../dashboard/lib/gear-projection.ts');
const { gearProjection } = (() => {
  const loaded = new Module(file, module);
  loaded.filename = file; loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(buildSync({ entryPoints: [file], bundle: true, packages: 'external', platform: 'node', format: 'cjs', write: false })
    .outputFiles[0].text, file);
  return loaded.exports;
})();
// One equipped entry carries the planted totals.
const equipment = properties => [['ring1', { meta: { properties } }]];
function frequency(oldProps, newProps, oldSets = {}, newSets = {}) {
  const character = { ctype: 'mage', primaryStat: 'int', level: 70, frequency: 1.485,
    str: 19, int: 198, dex: 22, vit: 32, max_hp: 3956, max_mp: 4000 };
  return gearProjection(character, equipment(oldProps), oldSets)(equipment(newProps), newSets).frequency;
}
test('Winged Boots +0 adds 0.03 attacks/sec while removing 12 INT', () => {
  const result = frequency({ int: 12 }, { frequency: 3 });
  assert.ok(Math.abs(result - 1.5073809523809523) < 1e-12);
  assert.equal(result.toFixed(3), '1.507');
});
test('unchanged gear preserves reported attack speed', () => {
  assert.equal(frequency({ frequency: 3 }, { frequency: 3 }), 1.485);
});
test('merchant gear comparison projects DEX from unrestricted speed, not stand speed 10',()=>{
 const character={ctype:'merchant',speed:10,unrestrictedSpeed:75,standOpen:true,level:46,str:6,dex:99};
 assert.equal(gearProjection(character,equipment({dex:4}),{})(equipment({dex:36}),{}).speed,76);
});
test('removing frequency gear subtracts its converted bonus', () => {
  assert.ok(Math.abs(frequency({ frequency: 3 }, {}) - 1.455) < 1e-12);
});
test('frequency upgrade and set deltas use the same units', () => {
  assert.ok(Math.abs(frequency({ frequency: 3 }, { frequency: 3.625 },
    { frequency: 2 }, { frequency: 5 }) - 1.52125) < 1e-12);
});
