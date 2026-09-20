const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorBankActions}=require('../../runtime/coordinator/http/bank-actions.ts');
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

test('bank checkpoint and completion persist bank state and respond before restoring the merchant',()=>{
 const t=fixture();assert.equal(t.invoke(t.service.storage.checkpoint,{character:'M',bank:{packs:{items0:[]}}}).body.pending,true);
 assert.deepEqual(t.calls,['adopt','bank','plan','response']);assert.equal(t.state.bankSnapshot.character,'M');
 t.calls.length=0;const transaction={bankboi:'B',phase:'transfer'};t.state.bankboiTransaction=transaction;t.state.commands.B={id:1};
 assert.equal(t.invoke(t.service.storage.complete,{character:'B',items:[],relocated:[],completed:[]}).code,200);
 assert.equal(t.state.bankbois.B.unloadBlockedSignature,'signature');assert.equal(t.state.commands.B,undefined);
 assert.deepEqual(t.calls,['bank','response',['restore',transaction]]);
});

test('bank unlock allocates a current command ID while restock settings use settings persistence',()=>{
 const t=fixture();t.state.nextCommandId=80;t.state.merchantQueue=[];
 assert.equal(t.invoke(t.service.unlock,{pack:'items1'}).code,200);
 assert.equal(t.state.merchantQueue[0].id,'merchant-100000-80');assert.equal(t.state.merchantQueue[0].priority,50);
 assert.equal(t.state.nextCommandId,81);assert.deepEqual(t.calls,['settings','dispatch','response']);
 t.calls.length=0;t.state.restockPolicies={};
 assert.equal(t.invoke(t.service.restock,{character:'M',hp:{min:3,max:10},mp:{min:1,max:2}}).code,200);
 assert.deepEqual(t.state.restockPolicies.M,{hp:{item:'hpot1',min:3,max:10},mp:{item:'mpot1',min:1,max:2}});
 assert.deepEqual(t.calls,['settings','response']);
});

test('BankBoi completion retains empty slots and anniversary supplies find the remaining stack',()=>{
 const t=fixture(),items=[null,{slot:6,item:{name:'slice_citrus',q:2}},null];
 t.state.bankboiTransaction={bankboi:'B',phase:'processing'};
 assert.equal(t.invoke(t.service.storage.complete,{character:'B',items,completed:[],relocated:[]}).code,200);
 assert.equal(t.state.bankbois.B.items,items);
 const {createAnniversarySuppliesRoute}=require('../../runtime/coordinator/http/anniversary-supplies.ts');
 const supplies=createAnniversarySuppliesRoute(t.state,{counts:()=>({slice_citrus:2}),persist:()=>{},log:()=>{}});
 assert.deepEqual(t.invoke(supplies,{character:'M',missing:['slice_citrus']}).body,{ok:true,pending:['slice_citrus'],missing:[]});
 assert.deepEqual(t.state.withdrawals.M,[{pack:'bankboi:B',slot:6,item:{name:'slice_citrus',q:2}}]);
 assert.equal(t.state.bankbois.B.items,items);
});
