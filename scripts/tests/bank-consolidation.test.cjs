const {installBankStacks}=require('./helpers/bank-stacks.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('characters/shared.js', 'utf8');
function runtime(bank, fullInventory = false) {
  const items = Array(42).fill(null);
  if (fullInventory) items.fill({ name: 'sword' });
  const r = vm.createContext({ character: { bank, items, map: 'bank' }, parent: {},
    G: { items: { drapes: { s: 9999 } } }, sleep: async () => {},
    bank_swap: async (pack, a, b) => { bank[pack][b].q += bank[pack][a].q; bank[pack][a] = null; },
    bank_retrieve: async (pack, slot, inv) => { [items[inv], bank[pack][slot]] = [bank[pack][slot], items[inv]]; },
    bank_store: async (inv, pack, slot) => { [items[inv], bank[pack][slot]] = [bank[pack][slot], items[inv]]; },
    swap: async (a, b) => { items[a].q += items[b].q; items[b] = null; },
    split: async (slot, q) => { const to=items.findIndex(x=>!x); items[to]={...items[slot],q};items[slot]={...items[slot],q:items[slot].q-q}; },
  });
  vm.runInContext(source.slice(source.indexOf('  function bankStackIdentity('), source.indexOf('  async function bankStoreFully(')), r);
  vm.runInContext(source.slice(source.indexOf('  function bankPacksOnCurrentFloor('), source.indexOf('  async function sortCurrentBankFloor(')), r);
  const engine=installBankStacks(r).service;
  r.consolidateCurrentBankFloor=()=>engine.compact();
  return r;
}
const drapes = q => ({ name: 'drapes', q });
test('seven drapes stacks consolidate to 663 with no inventory space', async () => {
  const r = runtime({ items1: [451, 120, 34, 24, 7, 20, 7].map(drapes) }, true);
  await r.consolidateCurrentBankFloor([]);
  assert.deepEqual(r.character.bank.items1.filter(Boolean), [drapes(663)]);
});
test('cross-pane consolidation conserves items and returns both buffers', async () => {
  const r = runtime({ items0: [drapes(451)], items1: [drapes(212)] });
  await r.consolidateCurrentBankFloor([]);
  assert.deepEqual(Object.values(r.character.bank).flat().filter(Boolean), [drapes(663)]);
  assert.ok(r.character.items.every(x => !x));
});
test('reserved transfers, incompatible properties and stack limits are preserved', async () => {
  const pack = [drapes(9990), drapes(20), { ...drapes(5), l: 'l' }];
  pack[35] = drapes(1);
  const r = runtime({ items1: pack });
  await r.consolidateCurrentBankFloor([]);
  assert.equal(pack.filter(Boolean).length, 4);
  assert.equal(pack[35].q, 1);
});
test('unconfirmed cross-pane transfer preserves all stock for journal recovery', async () => {
  const r = runtime({ items0: [drapes(451)], items1: [drapes(212)] });
  const retrieve = r.bank_retrieve;
  r.bank_retrieve = async (pack, slot, inv) => { if (pack === 'items1') throw Error('interrupted'); return retrieve(pack, slot, inv); };
  await assert.rejects(r.consolidateCurrentBankFloor([]), /interrupted/);
  assert.equal(r.character.bank.items0[0]?.q || r.character.items.find(x=>x?.q===451)?.q, 451);
  assert.equal(r.character.bank.items1[0].q, 212);
  assert.equal([...Object.values(r.character.bank).flat(),...r.character.items].filter(Boolean).reduce((sum,x)=>sum+x.q,0),663);
});

for (const earlier of [false, true]) test('gem deposit preserves bank stock '+(earlier?'and an unmarked inventory stack':'with no other carried stack'),async()=>{
 const items=[earlier?{name:'gem0',q:10}:null,{name:'gem0',q:3}];const bank={items0:[{name:'gem0',q:20}]};let stores=0;
 const r=vm.createContext({character:{items,bank,map:'bank',isize:42},parent:{},G:{items:{gem0:{s:9999}}},bankStackHomes:{},fingerprint:x=>x,sleep:async()=>{},bankboiCheckpoint:async()=>{},
 bank_retrieve:async()=>{throw new Error('deposit must not retrieve bank stock');},
 bank_store:async(inv,pack,index)=>{assert.equal(index,undefined);bank[pack][0].q+=items[inv].q;items[inv]=null;stores++;}});
 vm.runInContext(source.slice(source.indexOf('  function bankStackIdentity('),source.indexOf('  async function bankboiCheckpoint(')),r);
 installBankStacks(r);
 await r.bankStoreFully(1);assert.equal(bank.items0[0].q,23);assert.equal(items[0]?.q,earlier?10:undefined);assert.equal(items[1],null);assert.equal(stores,1);assert.equal([...items,...bank.items0].filter(Boolean).reduce((n,x)=>n+x.q,0),earlier?33:23);
});
