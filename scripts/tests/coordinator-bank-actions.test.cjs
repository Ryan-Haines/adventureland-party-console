const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorBankActions}=require('../../runtime/items/coordinator/routes/storage.ts');
function fixture(){
 const state={merchantCharacter:'M',bankbois:{B:{name:'B',items:[]}},bankSnapshot:null,bankboiQueue:[],bankboiTransaction:null,commands:{},
  standListings:[],npcSaleMarks:[],merchantQueue:[],withdrawals:{},bankVaults:[{pack:'items1',floor:'bank',gold:100}],statuses:{},merchantCurrent:null,
  nextCommandId:40,restockPolicies:{}};
 const calls=[];
 const service=createCoordinatorBankActions(state,{
  now:()=>100000,identity:item=>item?.name||'',log:()=>{},signature:(current,entry)=>{assert.equal(current,state);assert.equal(entry,state.bankbois.B);return 'signature';},
  adopt:()=>calls.push('adopt'),persistBank:()=>calls.push('bank'),plan:current=>{assert.equal(current,state);calls.push('plan');return {};},
  restore:async transaction=>calls.push(['restore',transaction]),stamp:job=>({...job,priority:50}),publicJob:job=>job,
  persist:()=>calls.push('settings'),dispatch:()=>calls.push('dispatch'),owned:name=>name==='M',
 });
 function invoke(handler,body){const res={code:200,status(code){this.code=code;return this;},json(body){calls.push('response');this.body=body;return this;}};handler({body},res);return res;}
 return {state,calls,service,invoke};
}

test('BankBoi completion retains empty slots and anniversary supplies find the remaining stack',()=>{
 const t=fixture(),items=[null,{slot:6,item:{name:'slice_citrus',q:2}},null];
 t.state.bankboiTransaction={bankboi:'B',phase:'processing'};
 assert.equal(t.invoke(t.service.storage.complete,{character:'B',items,completed:[],relocated:[]}).code,200);
 assert.equal(t.state.bankbois.B.items,items);
 const {createAnniversarySuppliesRoute}=require('../../runtime/events/coordinator/routes.ts');
 const supplies=createAnniversarySuppliesRoute(t.state,{counts:()=>({slice_citrus:2}),persist:()=>{},log:()=>{}});
 assert.deepEqual(t.invoke(supplies,{character:'M',missing:['slice_citrus']}).body,{ok:true,pending:['slice_citrus'],missing:[]});
 assert.deepEqual(t.state.withdrawals.M,[{pack:'bankboi:B',slot:6,item:{name:'slice_citrus',q:2}}]);
 assert.equal(t.state.bankbois.B.items,items);
});
