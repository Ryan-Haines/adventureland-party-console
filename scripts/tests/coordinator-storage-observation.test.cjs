const test=require('node:test');
const assert=require('node:assert/strict');
const {createBankboiObservation}=require('../../runtime/coordinator/status/bankboi.ts');

test('storage startup reports carry protected withdrawals and transition the transaction exactly once',()=>{
 const state={workers:{B:{}},transaction:{bankboi:'B',mode:'retrieve',phase:'waiting-for-bankboi',requestIds:['cargo'],retrievals:[{item:{name:'coat'}}]},
  requests:[{id:'cargo'},{id:'other'}]},commands={},effects=[];
 const withdrawals=[{pack:'bankboi:B',item:{name:'leather'}},{pack:'items1',slot:35},{pack:'bankboi:Other',item:{name:'sword'}}];
 const observer=createBankboiObservation(state,{now:()=>100,nextCommand:()=>1,hasCommand:name=>!!commands[name],command:(name,command)=>{commands[name]=command;},
  withdrawals:()=>withdrawals,stackHomes:()=>({leather:{owner:'bank'}}),persist:()=>effects.push('persist')});
 const body={name:'B',items:[{slot:0,item:{name:'leather'}}],gold:10};observer.observe(body);
 assert.equal(state.workers.B.items,body.items);assert.equal(state.workers.B.seenAt,100);assert.equal(state.transaction.phase,'processing');
 assert.deepEqual(commands.B.requests,[{id:'cargo'}]);assert.deepEqual(commands.B.protectedItems,[{name:'leather'}]);
 assert.deepEqual(commands.B.reservedLocations,[{pack:'items1',slot:35}]);assert.equal(commands.B.unload,true);
 observer.observe(body);assert.deepEqual(effects,['persist']);
});

test('pending worker commands and unrelated characters cannot start the storage handoff',()=>{
 const state={workers:{B:{items:[{slot:0,item:{name:'coat'}}]}},transaction:{bankboi:'B',mode:'store',phase:'waiting-for-bankboi',requestIds:[]},requests:[]};
 const observer=createBankboiObservation(state,{now:()=>100,nextCommand:()=>1,hasCommand:()=>true,command(){assert.fail('must not overwrite a command');},
  withdrawals:()=>[],stackHomes:()=>({}),persist(){assert.fail('no dispatch');}});
 observer.observe({name:'P',items:[]});observer.observe({name:'B'});
 assert.equal(state.workers.B.items.length,1);assert.equal(state.transaction.phase,'waiting-for-bankboi');
});
