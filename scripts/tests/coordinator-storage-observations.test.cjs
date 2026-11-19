const test=require('node:test'),assert=require('node:assert/strict');
const {createBankboiStorage,consumeBankReport,homes}=require('../../runtime/items/coordinator/storage.ts');
const {createMerchantObservation}=require('../../runtime/items/coordinator/market.ts');
// The bank report writer, the BankBoi observe and the merchant's stand sales over one party state.
function fixture(){
 const state={merchantCharacter:'M',merchantCurrent:null,headlessSlots:['M'],statuses:{},lifecycle:{},bankbois:{},bankboiTransaction:null,
  bankboiQueue:[],nextCommandId:10,commands:{},withdrawals:{},bankSnapshot:null,bankObserver:null,standListings:[]};
 const calls=[];
 const bankPorts={now:()=>100,adoptReservedCargo:()=>calls.push(['adopt',state.bankSnapshot]),persist:()=>calls.push('bank')};
 const bankboi=createBankboiStorage(state,{},{now:()=>100,stop:async()=>{},persistRoster(){},persistBank:()=>calls.push('bank'),collect(){},log(){},merchantHeld:()=>false});
 const merchant=createMerchantObservation(state,{log:message=>calls.push(['log',message]),persist:()=>calls.push('settings'),publish:()=>calls.push('publish')});
 return {state,calls,bankPorts,bankboi,merchant};
}
test('bank observations update shared state before adoption and subsequent BankBoi dispatch uses that snapshot',()=>{
 const {state,calls,bankPorts,bankboi}=fixture();state.bankSnapshot={packs:{items0:[]}};state.bankObserver='old';
 const leather={item:{name:'leather',q:5},meta:{definition:{s:9999}}},report={name:'M',bank:{packs:{items1:[leather]}}};
 consumeBankReport(report,state,bankPorts);
 assert.deepEqual(state.bankSnapshot,{packs:{items1:[leather]},character:'M',seenAt:100});
 assert.equal(calls[0][1],state.bankSnapshot);assert.deepEqual(calls.map(call=>Array.isArray(call)?call[0]:call),['adopt','bank']);
 assert.equal(state.bankObserver,'M');assert.equal(Object.hasOwn(report,'bank'),false);
 state.bankbois={B:{name:'B'}};state.bankboiTransaction={bankboi:'B',phase:'waiting-for-bankboi',requestIds:['q']};
 state.bankboiQueue=[{id:'q'}];state.nextCommandId=50;calls.length=0;
 bankboi.observe({name:'B',items:[]});
 const command=state.commands.B;
 assert.equal(command.id,50);assert.equal(state.nextCommandId,51);
 assert.deepEqual(command.stackHomes,homes(state.bankSnapshot,state.bankbois));assert.equal(Object.values(command.stackHomes)[0].owner,'bank');
 assert.deepEqual(command.requests,[{id:'q'}]);
 assert.equal(state.bankboiTransaction.phase,'processing');assert.deepEqual(calls,['bank']);
});
test('merchant observations reconcile replaced listings and persist settings before market publication',()=>{
 const {state,calls,merchant}=fixture(),old=state.standListings;
 state.standListings=[{tradeSlot:'trade1',item:{name:'leather',q:5},quantity:5}];
 merchant.observe({standOpen:true,gold:120,slots:{trade1:{item:{name:'leather',q:3}}}},
  {standOpen:true,gold:100,slots:{trade1:{item:{name:'leather',q:5}}}});
 assert.deepEqual(old,[]);assert.equal(state.standListings[0].quantity,3);assert.equal(state.standListings[0].item.q,3);
 assert.deepEqual(calls.map(call=>Array.isArray(call)?call[0]:call),['log','settings','publish']);
 assert.match(calls[0][1],/Sold leather × 2/);
});
