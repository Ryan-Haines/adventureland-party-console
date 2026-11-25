const test=require('node:test'),assert=require('node:assert/strict');
const {createReservedBankboiCargo}=require('../../runtime/items/coordinator/storage.ts');
const {stackKey}=require('../../runtime/items/identity.ts');
function fixture(){const slots=Array(42).fill(null),state={bankbois:{B:{name:"B"}},bankSnapshot:{packs:{items1:slots}},bankboiQueue:[],bankboiReservedMigrated:false,withdrawals:{}};let saves=0;
 const service=createReservedBankboiCargo(state,{now:()=>100,persist:()=>saves++});
 return {state,slots,service,saves:()=>saves};}
test('last worker removal prunes reserved cargo without a bank observation and preserves ordinary requests',()=>{
 const f=fixture();f.slots[35]={item:{name:'sword'}};f.service.reconcile();
 f.state.bankboiQueue.push({id:'ordinary',pack:'items0',slot:0,item:{name:'helmet'}});
 f.state.bankbois={};f.state.bankSnapshot=null;f.service.reconcile();
 assert.deepEqual(f.state.bankboiQueue.map(r=>r.id),['ordinary']);
});
test('reserved cargo adopts the staging row once and refreshes stack quantities',()=>{
 const f=fixture();f.slots[34]={item:{name:'normal'}};f.slots[35]={item:{name:'leather',q:2}};f.slots[41]={item:{name:'drapes'}};
 assert.equal(f.service.reconcile(),true);assert.equal(f.state.bankboiQueue.length,2);assert.equal(f.state.bankboiQueue[0].bootstrap,true);
 assert.equal(f.state.bankboiQueue[0].queuedAt,100);assert.equal(f.service.reconcile(),false);assert.equal(f.saves(),1);
 const request=f.state.bankboiQueue[0];f.slots[35].item={name:'leather',q:8};f.service.reconcile();
 assert.equal(f.state.bankboiQueue[0],request);assert.equal(request.item.q,8);
 f.slots[36]={item:{name:'new'}};f.service.reconcile();assert.equal(f.state.bankboiQueue[2].bootstrap,false);
});
test('merchant retrieval cancels overflow intent and cannot be immediately recaptured',()=>{
 const f=fixture();f.slots[35]={item:{name:'leather'}};f.service.reconcile();
 f.state.withdrawals.M=[{pack:'items1',slot:35}];assert.equal(f.service.reconcile(),true);assert.deepEqual(f.state.bankboiQueue,[]);
 assert.equal(f.service.reconcile(),false);f.state.withdrawals.M=[];f.service.reconcile();assert.equal(f.state.bankboiQueue.length,1);
});
test('stale staging requests are removed while ordinary bank requests survive',()=>{
 const f=fixture();f.state.bankboiQueue=[{id:'old',pack:'items1',slot:35,item:{name:'old'}},{id:'normal',pack:'items1',slot:1,item:{name:'normal'}},{id:'other',pack:'items2',slot:35,item:{name:'other'}}];
 f.slots[35]={item:{name:'new'}};f.service.reconcile();assert.deepEqual(f.state.bankboiQueue.map(x=>x.id),['normal','other','items1:35:'+stackKey({name:'new'})]);
 f.slots[35]=null;f.service.reconcile();assert.equal(f.state.bankboiQueue.length,2);
});
test('missing bank snapshot does not finalize migration; an empty known pane does',()=>{
 const f=fixture();f.state.bankSnapshot=null;assert.equal(f.service.reconcile(),false);assert.equal(f.state.bankboiReservedMigrated,false);assert.equal(f.saves(),0);
 f.state.bankSnapshot={packs:{items1:[]}};assert.equal(f.service.reconcile(),true);assert.equal(f.state.bankboiReservedMigrated,true);assert.equal(f.saves(),1);
});
