const test=require('node:test'),assert=require('node:assert/strict');
const {initialBankState}=require('../../runtime/coordinator/inventory/initial-bank.ts');
test('bank initialization retains saved storage work and refreshes only runtime data',()=>{
 const saved={bankSnapshot:{packs:{}},bankbois:{B:{}},bankboiQueue:[{id:1}],bankboiTransaction:{phase:'store'},bankboiReservedMigrated:true,withdrawals:{M:[]}},vaults=[{pack:'items1'}];let loads=0;
 const state=initialBankState(saved,()=>{loads++;return vaults;});
 for(const key of Object.keys(saved))assert.equal(state[key],saved[key]);assert.equal(state.bankVaults,vaults);assert.equal(state.bankObserver,null);assert.equal(loads,1);
});
test('bank initialization preserves strict migration flag and defaults invalid queues',()=>{
 const state=initialBankState({bankboiQueue:{},bankboiReservedMigrated:'true'},()=>[]);
 assert.deepEqual(state.bankboiQueue,[]);assert.equal(state.bankboiReservedMigrated,false);assert.equal(state.bankSnapshot,null);assert.equal(state.bankboiTransaction,null);
 assert.notEqual(state.withdrawals,initialBankState({},()=>[]).withdrawals);
});
