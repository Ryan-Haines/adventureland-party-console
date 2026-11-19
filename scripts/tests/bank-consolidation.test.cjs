// bank.ts's stack service (helpers/bank-stacks.cjs `bankRuntime`): the piles compact as the merchant
// leaves the bank, and a deposit lets the game merge into the pack's pile.
const {bankRuntime} = require('./helpers/bank-stacks.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
function runtime(bank, fullInventory = false) {
  const items = Array(42).fill(null);
  if (fullInventory) items.fill({ name: 'sword' });
  return bankRuntime(bank, items, { drapes: 9999 });
}
const drapes = q => ({ name: 'drapes', q });
test('seven drapes stacks consolidate to 663 with no inventory space', async () => {
  const r = runtime({ items1: [451, 120, 34, 24, 7, 20, 7].map(drapes) }, true);
  await r.leave();
  assert.deepEqual(r.character.bank.items1.filter(Boolean), [drapes(663)]);
});
test('cross-pane consolidation conserves items and returns both buffers', async () => {
  const r = runtime({ items0: [drapes(451)], items1: [drapes(212)] });
  await r.leave();
  assert.deepEqual(Object.values(r.character.bank).flat().filter(Boolean), [drapes(663)]);
  assert.ok(r.character.items.every(x => !x));
});
test('reserved transfers, incompatible properties and stack limits are preserved', async () => {
  const pack = [drapes(9990), drapes(20), { ...drapes(5), l: 'l' }];
  pack[35] = drapes(1);
  const r = runtime({ items1: pack });
  await r.leave();
  assert.equal(pack.filter(Boolean).length, 4);
  assert.equal(pack[35].q, 1);
});
test('unconfirmed cross-pane transfer preserves all stock for journal recovery', async () => {
  const r = runtime({ items0: [drapes(451)], items1: [drapes(212)] });
  const retrieve = r.game.bank_retrieve;
  r.game.bank_retrieve = async (pack, slot, inv) => { if (pack === 'items1') throw Error('interrupted'); return retrieve(pack, slot, inv); };
  await assert.rejects(r.leave(), /interrupted/);
  assert.equal(r.character.bank.items0[0]?.q || r.character.items.find(x=>x?.q===451)?.q, 451);
  assert.equal(r.character.bank.items1[0].q, 212);
  assert.equal(r.total(), 663);
});

for (const earlier of [false, true]) test('gem deposit preserves bank stock '+(earlier?'and an unmarked inventory stack':'with no other carried stack'),async()=>{
 const items=[earlier?{name:'gem0',q:10}:null,{name:'gem0',q:3}];const bank={items0:[{name:'gem0',q:20}]};let stores=0;
 const r=bankRuntime(bank,items,{gem0:9999},{character:{isize:42}});
 r.game.bank_retrieve=async()=>{throw new Error('deposit must not retrieve bank stock');};
 r.game.bank_store=async(inv,pack,index)=>{assert.equal(index,undefined);bank[pack][0].q+=items[inv].q;items[inv]=null;stores++;};
 await r.bank.bankStoreFully(1);assert.equal(bank.items0[0].q,23);assert.equal(items[0]?.q,earlier?10:undefined);assert.equal(items[1],null);assert.equal(stores,1);assert.equal([...items,...bank.items0].filter(Boolean).reduce((n,x)=>n+x.q,0),earlier?33:23);
});
