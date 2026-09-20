const test=require('node:test'),assert=require('node:assert/strict');
const {createStandMarkRoute}=require('../../runtime/coordinator/http/stand-marks.ts');
const {createNpcSaleRoute}=require('../../runtime/coordinator/http/npc-sale.ts');
const {createAutomaticSaleRoutes}=require('../../runtime/coordinator/http/automatic-sales.ts');
const {createStaleOrderRoute}=require('../../runtime/coordinator/http/stale-orders.ts');
function fixture(){
 const item={name:'leather',q:7},state={merchantCharacter:'M',statuses:{M:{items:[{slot:2,item}]}},bankSnapshot:{packs:{}},bankbois:{},standListings:[],npcSaleMarks:[],withdrawals:{},
  merchantCurrent:null,merchantQueue:[],autoNpcSales:{},autoStandMarks:{},merchantDeliveries:{},marked:{}};
 let id=1;const calls=[],ports={now:()=>100,nextCommand:()=>id++,persist:()=>calls.push('persist'),persistBank:()=>calls.push('bank'),publish:()=>calls.push('publish'),
  bankService:async()=>calls.push('service'),log(){},queue:(...args)=>calls.push(args),syncStand:()=>false,idle:()=>calls.push('idle'),stamp:job=>job,key:item=>item.name,reconcile:()=>calls.push('reconcile')};
 const automatic=createAutomaticSaleRoutes(state,ports),routes={stand:createStandMarkRoute(state,ports),npc:createNpcSaleRoute(state,ports),autoNpc:automatic.npc,autoStand:automatic.stand,clear:createStaleOrderRoute(state,ports.persist)};
 function send(route,body={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body},res);return res;}
 return {state,item,calls,send};
}
test('mark-all reprices live copies, ignores transient stack fields, deduplicates sources and stages bank withdrawals',()=>{
 const t=fixture();t.state.standListings=[{id:'live',slot:2,item:{...t.item,q:3,rid:'remote'},state:'live',tradeSlot:'trade1'}];
 t.state.bankSnapshot.packs.items1=[{slot:4,item:{...t.item,q:20}}];
 t.send('stand',{slot:2,item:t.item,price:100,quantity:1,markAll:true});
 assert.equal(t.state.standListings.length,3);assert.equal(t.state.standListings[0].id,'live');assert.equal(t.state.standListings[0].price,100);
 assert.deepEqual(t.state.standListings.map(x=>x.quantity),[3,7,20]);assert.equal(t.state.withdrawals.M.length,1);
 assert.deepEqual(t.calls.at(-1),[['M'],'manual bank exchange']);
});
test('single stand edits retain requested quantity, enforce capacity, and remove matching withdrawal',()=>{
 const t=fixture(),body={slot:2,item:t.item,price:100,quantity:2,bankPack:'bankboi:bankboi0'};
 t.send('stand',body);assert.equal(t.state.standListings[0].quantity,2);assert.ok(t.calls.includes('service'));
 t.send('stand',{...body,remove:true});assert.equal(t.state.standListings.length,0);assert.equal(t.state.withdrawals.M.length,0);
 t.state.standListings=Array.from({length:16},(_,i)=>({id:String(i),slot:i,item:{name:'sword'},state:'configured'}));
 assert.equal(t.send('stand',{slot:22,item:t.item,price:1}).code,409);
});
test('NPC sales validate the current item and modified-item acknowledgment before queuing storage work',()=>{
 const t=fixture(),body={source:'merchant',slot:2,item:{name:'leather'},quantity:8};assert.equal(t.send('npc',body).code,400);
 body.quantity=2;body.item={name:'sword',level:2};assert.equal(t.send('npc',body).code,409);
 t.state.statuses.M.items[0].item=body.item;body.quantity=1;assert.equal(t.send('npc',body).code,400);
 assert.equal(t.send('npc',{...body,acknowledged:true}).code,200);assert.equal(t.state.npcSaleMarks.length,1);
});
test('BankBoi NPC sales request retrieval; an already-running sale schedules one follow-up job',()=>{
 const t=fixture();t.state.bankbois.bankboi0={items:[{slot:0,item:t.item}]};
 t.send('npc',{pack:'bankboi:bankboi0',slot:0,item:t.item,quantity:1});assert.equal(t.state.withdrawals.M[0].pack,'bankboi:bankboi0');assert.ok(t.calls.includes('bank'));
 t.state.merchantCurrent={reason:'npc sales'};t.send('npc',{source:'merchant',slot:2,item:t.item,quantity:1});assert.equal(t.state.merchantQueue.length,1);
});
test('removing auto-stand rules cancels their bank withdrawals without touching manual withdrawals',()=>{
 for(const action of ['remove','clear-all','npc']) {
  const t=fixture();t.state.standListings=[{id:'auto',auto:true,autoRuleKey:'leather'},{id:'manual',auto:false}];
  t.state.withdrawals.M=[{standListingId:'auto'},{standListingId:'manual'},{pack:'items0',slot:7}];
  t.send(action==='npc'?'autoNpc':'autoStand',{item:t.item,action:action==='npc'?'set':action});
  assert.deepEqual(t.state.standListings.map(x=>x.id),['manual']);
  assert.deepEqual(t.state.withdrawals.M,[{standListingId:'manual'},{pack:'items0',slot:7}]);
 }
});

test('automatic sale rules replace competing rules while preserving manual marks',()=>{
 const t=fixture();t.state.standListings=[{auto:true,autoRuleKey:'leather'},{auto:false,autoRuleKey:'leather'}];
 t.send('autoNpc',{item:t.item});assert.equal(t.state.standListings.length,1);assert.ok(t.state.autoNpcSales.leather);
 t.state.npcSaleMarks=[{autoRuleKey:'leather'},{autoRuleKey:'sword'}];t.send('autoStand',{item:t.item,price:99});
 assert.equal(t.state.autoNpcSales.leather,undefined);assert.equal(t.state.npcSaleMarks.length,1);assert.equal(t.state.autoStandMarks.leather.price,99);
 t.send('autoStand',{action:'clear-all'});assert.equal(t.state.standListings.length,1);
});
test('stale-order cleanup preserves every delivery even when stock is missing',()=>{
 const t=fixture();t.state.merchantDeliveries={L:[{item:{name:'leather',q:1}}],F:[{item:{name:'leather',q:3}}]};
 t.state.marked.M=[{item:{name:'leather',q:999}},{item:{name:'sword'}}];
 const result=t.send('clear').body;assert.equal(result.deliveriesRemoved,0);assert.equal(result.bankMarksRemoved,1);assert.equal(t.state.merchantDeliveries.L.length,1);assert.equal(t.state.merchantDeliveries.F.length,1);
});
