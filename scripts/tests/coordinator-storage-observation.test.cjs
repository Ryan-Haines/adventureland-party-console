const test=require('node:test');
const assert=require('node:assert/strict');
const {createBankboiStorage}=require('../../runtime/items/coordinator/storage.ts');

// A BankBoi's reports through the observe (storage.ts createBankboiStorage), over the party state.
function fixture({transaction,bankbois,withdrawals={},commands={}}){
 const state={merchantCharacter:'M',merchantCurrent:null,headlessSlots:['B'],statuses:{},lifecycle:{},bankSnapshot:null,nextCommandId:1,
  bankboiTransaction:transaction,bankbois,bankboiQueue:[{id:'cargo'},{id:'other'}],withdrawals,commands},effects=[];
 const storage=createBankboiStorage(state,{},{now:()=>100,stop:async()=>{},persistRoster(){},persistBank:()=>effects.push('persist'),collect(){},log(){},merchantHeld:()=>false});
 return {state,effects,storage};
}
test('storage startup reports carry protected withdrawals and transition the transaction exactly once',()=>{
 const {state,effects,storage}=fixture({bankbois:{B:{name:'B'}},
  transaction:{bankboi:'B',mode:'retrieve',phase:'waiting-for-bankboi',requestIds:['cargo'],retrievals:[{item:{name:'coat'}}]},
  withdrawals:{M:[{pack:'bankboi:B',item:{name:'leather'}},{pack:'items1',slot:35},{pack:'bankboi:Other',item:{name:'sword'}}]}});
 const body={name:'B',items:[{slot:0,item:{name:'leather'}}],gold:10};storage.observe(body);
 const worker=state.bankbois.B,command=state.commands.B;
 assert.equal(worker.items,body.items);assert.equal(worker.seenAt,100);assert.equal(state.bankboiTransaction.phase,'processing');
 assert.deepEqual(command.requests,[{id:'cargo'}]);assert.deepEqual(command.protectedItems,[{name:'leather'}]);
 assert.deepEqual(command.reservedLocations,[{pack:'items1',slot:35}]);assert.equal(command.unload,true);
 storage.observe(body);assert.deepEqual(effects,['persist']);
});

test('pending worker commands and unrelated characters cannot start the storage handoff',()=>{
 const pending={id:9,type:'bankboi-service'};
 const {state,effects,storage}=fixture({bankbois:{B:{name:'B',items:[{slot:0,item:{name:'coat'}}]}},commands:{B:pending},
  transaction:{bankboi:'B',mode:'store',phase:'waiting-for-bankboi',requestIds:[]}});
 storage.observe({name:'P',items:[]});storage.observe({name:'B'});
 assert.equal(state.bankbois.B.items.length,1);assert.equal(state.bankboiTransaction.phase,'waiting-for-bankboi');
 assert.equal(state.commands.B,pending);assert.deepEqual(effects,[]);
});
