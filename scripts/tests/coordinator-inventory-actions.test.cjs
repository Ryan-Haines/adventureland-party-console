const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorInventoryActions}=require('../../runtime/coordinator/http/inventory-actions.ts');
function fixture(){
 const state={merchantCharacter:'M',nextCommandId:40,statuses:{},commands:{},bankbois:{},bankSnapshot:{packs:{}},
  merchantCurrent:null,merchantQueue:[],autoNpcSales:{},autoStandMarks:{},npcSaleMarks:[],standListings:[],standBids:{},
  withdrawals:{},upgrades:{},purchases:{},compounds:{},statScrolls:{},marked:{},merchantMarked:{},autoItemMarks:{},autoCompounds:{},goldTargets:{},
  bankCurrent:null,bankStartedAt:0};
 const calls=[],merge={from:1,to:2,source:{name:'leather',q:3},target:{name:'leather',q:4}};
 const service=createCoordinatorInventoryActions(state,{
  now:()=>100000,key:item=>item.name,reconcile:status=>calls.push(['reconcile',status]),persist:()=>calls.push('persist'),
  publish:()=>calls.push('publish'),syncStand:()=>false,idle:()=>calls.push('idle'),persistBank:()=>calls.push('bank'),
  bankService:async()=>calls.push('bankboi'),stamp:job=>({...job,priority:50}),queue:(...args)=>calls.push(['queue',...args]),
  log:()=>calls.push('log'),owned:name=>name==='F',dispatchBank:()=>calls.push('dispatchBank'),sameItem:(a,b)=>a.name===b?.name,
  removeQueued:()=>{},observe:()=>{},ponty:()=>false,aldata:()=>{},dispatch:()=>{},anniversary:()=>({}),bankboiBusy:()=>false,
  plan:(current,status)=>{assert.equal(current,state);calls.push(['plan',status]);return merge;},identity:item=>item?.name,
 });
 function invoke(handler,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;}};handler({body},res);return res;}
 return {state,calls,merge,service,invoke};
}

test('inventory automation and stack merging read the current merchant and replaced status collection',()=>{
 const t=fixture();assert.deepEqual(t.calls,[]);
 t.state.merchantCharacter='New';const status={seenAt:100000,items:[]};t.state.statuses={New:status};
 assert.equal(t.invoke(t.service.automatic.npc,{item:{name:'leather'}}).code,200);
 assert.equal(t.calls.find(call=>call[0]==='reconcile')[1],status);
 assert.equal(t.invoke(t.service.merge,{character:'M',merge:t.merge}).body.allowed,false);
 assert.equal(t.calls.some(call=>call[0]==='plan'),false);
 assert.equal(t.invoke(t.service.merge,{character:'New',merge:t.merge}).body.allowed,true);
 assert.equal(t.calls.find(call=>call[0]==='plan')[1],status);
});

test('NPC sale and handoff commands share the live sequence without consuming IDs on rejected receipts',()=>{
 const t=fixture();t.state.statuses.M={items:[{slot:1,item:{name:'leather',q:3}}]};
 assert.equal(t.invoke(t.service.npc,{source:'merchant',slot:1,item:{name:'leather'},quantity:1}).body.mark.id,'npc-sale-100000-40');
 t.state.nextCommandId=80;t.state.merchantCurrent={id:'job',target:'F',reason:'service'};
 assert.equal(t.invoke(t.service.handoff.handoff,{target:'F',jobId:'job',capacity:5}).code,200);
 assert.equal(t.state.commands.F.id,80);assert.equal(t.state.nextCommandId,81);
 assert.equal(t.invoke(t.service.receipts.equipment,{character:'F',commandId:1}).code,409);
 assert.equal(t.state.commands.F.id,80);assert.equal(t.state.nextCommandId,81);
});

test('bank receipts persist matching withdrawals before releasing the bank and dispatching its next job',()=>{
 const t=fixture(),item={name:'leather'};t.state.withdrawals.F=[item,{...item}];
 t.state.bankCurrent={name:'F'};t.state.bankStartedAt=100;t.state.commands.F={id:1,type:'bank'};
 assert.equal(t.invoke(t.service.receipts.bank,{character:'Other',withdrawn:[item]}).code,409);
 assert.deepEqual(t.calls,[]);
 assert.equal(t.invoke(t.service.receipts.bank,{character:'F',withdrawn:[item]}).code,200);
 assert.deepEqual(t.state.withdrawals.F,[item]);assert.equal(t.state.bankCurrent,null);
 assert.equal(t.state.commands.F,undefined);assert.equal(t.state.bankStartedAt,0);
 assert.deepEqual(t.calls,['bank','dispatchBank']);
});
