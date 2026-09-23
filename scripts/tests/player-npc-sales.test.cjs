const test = require('node:test');
const assert = require('node:assert/strict');
const {createNpcSaleRoute} = require('../../runtime/coordinator/http/npc-sale.ts');
const {createAutomaticSaleRoutes} = require('../../runtime/coordinator/http/automatic-sales.ts');
const {createAutomaticMerchantSales} = require('../../runtime/coordinator/merchant/automatic-sales.ts');
const {receivePlayerSales, npcSaleRuleKey} = require('../../runtime/coordinator/merchant/player-npc-sales.ts');
const {readyNpcSales} = require('../../runtime/coordinator/merchant/npc-sales.ts');
const {reconcileNpcSales} = require('../../runtime/coordinator/merchant/npc-sales.ts');
const {automaticCommerceRuleKey} = require('../../runtime/coordinator/inventory/item-identity.ts');
const item = {name:'ring',level:2,stat_type:'int',q:5};
test('stale deconstruction slots cannot suppress NPC pickups for replacement items',()=>{
 const {reconcilePlayerSales,playerSaleReserved}=require('../../runtime/coordinator/merchant/player-npc-sales.ts');
 const f=fixture(),s=f.state;
 s.autoNpcSales[npcSaleRuleKey(item,'P')]={item,createdAt:1};
 s.deconstructionMarks=[{owner:'P',slot:1,item:{name:'firebow',level:0},state:'blocked'}];
 reconcilePlayerSales(s,s.statuses.P,{now:()=>20000,nextCommand:()=>1,queue(){}});
 assert.equal(s.npcSaleMarks.length,1);assert.equal(s.npcSaleMarks[0].state,'collecting');
 assert.equal(s.merchantMarked.P.length,1);
 assert.equal(playerSaleReserved(s,'P',1,{name:'firebow',level:0}),true,'matching deconstruction still protects its item');
});
function fixture() {
  let id=0, now=20000;
  const state={merchantCharacter:'M',statuses:{P:{name:'P',items:[{slot:1,item:{...item}}]},M:{name:'M',items:[]}},
    bankbois:{},bankSnapshot:{packs:{}},withdrawals:{},autoNpcSales:{},autoStandMarks:{},npcSaleMarks:[],
    standListings:[],merchantMarked:{},marked:{},merchantCurrent:null,merchantQueue:[]};
  const queues=[];
  const ports={now:()=>now,nextCommand:()=>++id,queue:(names,reason)=>queues.push({names,reason}),
    persist(){},publish(){},syncStand:()=>false,idle(){},persistBank(){},bankService(){},stamp:job=>job,log(){}};
  const sales=createAutomaticMerchantSales(state,ports);
  const route=createNpcSaleRoute(state,ports);
  const auto=createAutomaticSaleRoutes(state,{...ports,key:automaticCommerceRuleKey,
    reconcile:()=>Object.values(state.statuses).forEach(status=>sales.reconcile(status))});
  const invoke=(handler,body)=>{const res={code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}};handler({body},res);return res;};
  const mark=()=>invoke(route,{source:'character',character:'P',slot:1,item,quantity:2,acknowledged:true});
  return {state,ports,queues,sales,route,auto,invoke,mark,advance:ms=>now+=ms};
}
test('player sale waits for its receipt, preserves quantity, then queues merchant sale',()=>{
  const f=fixture();assert.equal(f.mark().code,200);f.mark();
  assert.equal(f.state.npcSaleMarks.length,1);
  const mark=f.state.npcSaleMarks[0];assert.equal(mark.state,'collecting');
  assert.equal(f.state.merchantMarked.P[0].quantity,2);
  assert.equal(f.queues[0].reason,'npc sale pickup');
  f.state.statuses.M.items=[{slot:8,item}];f.sales.reconcile(f.state.statuses.M);
  assert.equal(readyNpcSales(f.state.npcSaleMarks,20000).length,0);
  receivePlayerSales(f.state,'Other',[{npcSaleId:mark.id,quantity:2}],20000);
  assert.equal(mark.source,'character');
  receivePlayerSales(f.state,'P',[{npcSaleId:mark.id,quantity:2}],20000);
  receivePlayerSales(f.state,'P',[{npcSaleId:mark.id,quantity:5}],20000);
  assert.equal(mark.quantity,2);assert.deepEqual(f.state.merchantMarked.P,[]);
  f.sales.reconcile(f.state.statuses.M);
  assert.equal(f.state.npcSaleMarks[0].slot,8);
  assert.equal(f.queues.at(-1).reason,'npc sales');
});
test('automatic player rules are scoped, exact, sort-safe, and suppress stale pickup reports',()=>{
  const f=fixture();assert.equal(f.invoke(f.auto.npc,{character:'P',item}).code,200);
  assert.ok(f.state.autoNpcSales[npcSaleRuleKey(item,'P')]);
  f.state.statuses.P.items.push({slot:2,item:{...item,level:1}},{slot:3,item:{...item,stat_type:'str'}});
  f.state.statuses.M.items=[{slot:1,item}];f.sales.reconcile(f.state.statuses.M);
  f.state.statuses.P.items[0].slot=7;f.sales.reconcile(f.state.statuses.P);
  assert.equal(f.state.npcSaleMarks.length,1);assert.equal(f.state.merchantMarked.P[0].slot,7);
  const mark=f.state.npcSaleMarks[0];receivePlayerSales(f.state,'P',[{npcSaleId:mark.id,quantity:5}],20000);
  f.sales.reconcile(f.state.statuses.P);assert.equal(f.state.npcSaleMarks.length,1);
  f.advance(11000);f.state.statuses.P.items=[{slot:9,item}];f.sales.reconcile(f.state.statuses.P);
  assert.equal(f.state.npcSaleMarks.length,2);
});
test('missing, locked and competing items never become sale pickup work',()=>{
  for (const kind of ['missing','locked','bank','deconstruction']) {
    const f=fixture();
    if(kind==='missing') f.state.statuses.P.items=[];
    if(kind==='locked') {f.state.statuses.P.items[0].item.l=true;}
    if(kind==='bank') f.state.marked.P=[{slot:1,item}];
    if(kind==='deconstruction') f.state.deconstructionMarks=[{owner:'P',slot:1,item,state:'ready'}];
    assert.notEqual(f.mark().code,200,kind);
    assert.equal(f.state.npcSaleMarks.length,0,kind);
  }
});
test('player rule removal releases only its own reservations and leaves other characters enabled',()=>{
  const f=fixture();f.state.statuses.Q={name:'Q',items:[{slot:1,item}]};
  f.invoke(f.auto.npc,{character:'P',item});f.invoke(f.auto.npc,{character:'Q',item});
  f.invoke(f.auto.npc,{character:'P',item,action:'remove'});
  assert.deepEqual(f.state.merchantMarked.P,[]);
  assert.equal(f.state.npcSaleMarks.length,1);assert.equal(f.state.npcSaleMarks[0].character,'Q');
  assert.ok(f.state.autoNpcSales[npcSaleRuleKey(item,'Q')]);
});
test('manual removal releases pickup reservations and requires matching character',()=>{
  const f=fixture();f.mark();const id=f.state.npcSaleMarks[0].id;
  assert.equal(f.invoke(f.route,{id,character:'Q',remove:true}).code,409);
  assert.equal(f.invoke(f.route,{id,character:'P',remove:true}).code,200);
  assert.deepEqual(f.state.merchantMarked.P,[]);assert.deepEqual(f.state.npcSaleMarks,[]);
});
test('sales from separate players survive merging into one merchant stack',()=>{
  const marks=['P','Q'].map(character=>({id:character,character,source:'merchant',slot:-1,item,quantity:2,state:'queued'}));
  const result=reconcileNpcSales(marks,[{slot:4,item:{...item,q:4}}],false,20000);
  assert.equal(result.marks.length,2);assert.ok(result.marks.every(mark=>mark.slot===4 && mark.state==='queued'));
  const stale=reconcileNpcSales(marks,[{slot:4,item:{...item,q:2}}],false,20000);
  assert.equal(stale.marks.length,2);assert.equal(stale.marks[1].state,'blocked');
  const fresh=reconcileNpcSales(stale.marks,[{slot:4,item:{...item,q:4}}],false,21000);
  assert.equal(readyNpcSales(fresh.marks,21000).length,2);
});
