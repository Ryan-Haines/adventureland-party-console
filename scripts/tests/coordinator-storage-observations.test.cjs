const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorStorageObservations}=require('../../runtime/coordinator/status/storage-composition.ts');
const {consumeBankReport}=require('../../runtime/coordinator/status/bank.ts');
function fixture(){
 const state={bankbois:{},bankboiTransaction:null,bankboiQueue:[],nextCommandId:10,commands:{},withdrawals:{},bankSnapshot:null,bankObserver:null,standListings:[]};
 const calls=[];
 const service=createCoordinatorStorageObservations(state,{
  now:()=>100,adoptReservedCargo:()=>calls.push(['adopt',state.bankSnapshot]),persistBank:()=>calls.push('bank'),
  persist:()=>calls.push('settings'),log:message=>calls.push(['log',message]),publish:()=>calls.push('publish'),
  stackHomes:(bank,bankbois)=>({bank,bankbois}),
 });
 return {state,calls,service};
}
test('bank observations update shared state before adoption and subsequent BankBoi dispatch uses that snapshot',()=>{
 const {state,calls,service}=fixture();state.bankSnapshot={items0:[]};state.bankObserver='old';
 const report={name:'M',bank:{items1:[{item:{name:'leather'}}]}};
 consumeBankReport(report,service.bankState,service.bankPorts);
 assert.deepEqual(state.bankSnapshot,{items1:[{item:{name:'leather'}}],character:'M',seenAt:100});
 assert.equal(calls[0][1],state.bankSnapshot);assert.deepEqual(calls.map(call=>Array.isArray(call)?call[0]:call),['adopt','bank']);
 assert.equal(state.bankObserver,'M');assert.equal(Object.hasOwn(report,'bank'),false);
 state.bankbois={B:{}};state.bankboiTransaction={bankboi:'B',phase:'waiting-for-bankboi',requestIds:['q']};
 state.bankboiQueue=[{id:'q'}];state.nextCommandId=50;calls.length=0;
 service.bankboi.observe({name:'B',items:[]});
 const command=state.commands.B;
 assert.equal(command.id,50);assert.equal(state.nextCommandId,51);assert.equal(command.stackHomes.bank,state.bankSnapshot);
 assert.equal(command.stackHomes.bankbois,state.bankbois);assert.deepEqual(command.requests,[{id:'q'}]);
 assert.equal(state.bankboiTransaction.phase,'processing');assert.deepEqual(calls,['bank']);
});
test('merchant observations reconcile replaced listings and persist settings before market publication',()=>{
 const {state,calls,service}=fixture(),old=state.standListings;
 state.standListings=[{tradeSlot:'trade1',item:{name:'leather',q:5},quantity:5}];
 service.merchant.observe({standOpen:true,gold:120,slots:{trade1:{item:{name:'leather',q:3}}}},
  {standOpen:true,gold:100,slots:{trade1:{item:{name:'leather',q:5}}}});
 assert.deepEqual(old,[]);assert.equal(state.standListings[0].quantity,3);assert.equal(state.standListings[0].item.q,3);
 assert.deepEqual(calls.map(call=>Array.isArray(call)?call[0]:call),['log','settings','publish']);
 assert.match(calls[0][1],/Sold leather × 2/);
});
