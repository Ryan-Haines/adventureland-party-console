const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../../dashboard/node_modules/typescript');

// Exercise the projection used by the dialog, including its stat and set deltas.
const source = require('./helpers/dashboard-source.cjs')();
const projection = ts.transpileModule(source.slice(source.indexOf('  const strArmor ='),
  source.indexOf('  const currentPreview = project(')), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function frequency(oldProps, newProps, oldSets = {}, newSets = {}) {
  const context = vm.createContext({
    character: { ctype: 'mage', primaryStat: 'int', level: 70, frequency: 1.485,
      str: 19, int: 198, dex: 22, vit: 32, max_hp: 3956, max_mp: 4000 },
    actualEquipment: [], actualOldProps: oldProps, currentSets: { totals: oldSets },
    prop: (properties, key) => Number(properties[key] || 0), newProps, newSets,
  });
  return vm.runInContext(projection + '\nproject(newProps, newSets).frequency', context);
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
 const context=vm.createContext({character:{ctype:'merchant',speed:10,unrestrictedSpeed:75,standOpen:true,level:46,str:6,dex:99},
   actualEquipment:[],actualOldProps:{dex:4},currentSets:{totals:{}},prop:(p,k)=>Number(p[k]||0)});
 const speed=vm.runInContext(projection+'\nproject({dex:36},{}).speed',context);
 assert.equal(speed,76);
});
test('removing frequency gear subtracts its converted bonus', () => {
  assert.ok(Math.abs(frequency({ frequency: 3 }, {}) - 1.455) < 1e-12);
});
test('frequency upgrade and set deltas use the same units', () => {
  assert.ok(Math.abs(frequency({ frequency: 3 }, { frequency: 3.625 },
    { frequency: 2 }, { frequency: 5 }) - 1.52125) < 1e-12);
});
