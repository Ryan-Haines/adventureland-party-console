const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {reconcileDeliveries,acknowledgeDelivery}=require('../../runtime/coordinator/merchant/delivery-recovery.ts');
const {createMerchantCompletionRoute}=require('../../runtime/coordinator/http/merchant-completion.ts');
const {fixture}=require('./helpers/coordinator-completion.cjs');
const orb={name:'orbg',level:2,p:null};
const status=(items=[],slots={})=>({seenAt:100000,items,slots});

test('inventory rearrangement moves delivery marks without changing their durable intent',()=>{
 const mark={id:'moved',slot:4,item:orb,equipOnDelivery:true},deliveries={F:[mark]};
 const changes=reconcileDeliveries(deliveries,status([{slot:4,item:{name:'sword'}},{slot:17,item:orb}]),{},100000);
 assert.equal(mark.slot,17);assert.equal(mark.id,'moved');assert.equal(mark.equipOnDelivery,true);
 assert.ok(changes.length);assert.equal(mark.blocked,undefined);
 assert.deepEqual(reconcileDeliveries(deliveries,status([{slot:17,item:orb}]),{},100001),[]);
});

test('relocation preserves stationary duplicate ownership and survives missing stock plus reload',()=>{
 let deliveries={F:[{id:'moving',slot:1,item:orb}],P:[{id:'stationary',slot:2,item:orb}]};
 reconcileDeliveries(deliveries,status([{slot:2,item:orb},{slot:8,item:orb}]),{},100000);
 assert.equal(deliveries.F[0].slot,8);assert.equal(deliveries.P[0].slot,2);
 reconcileDeliveries(deliveries,status([]),{},100001);
 deliveries=JSON.parse(JSON.stringify(deliveries));
 assert.equal(deliveries.F[0].id,'moving');assert.ok(deliveries.F[0].blocked);
 reconcileDeliveries(deliveries,status([{slot:9,item:orb},{slot:2,item:orb}]),{},100002);
 assert.equal(deliveries.F[0].slot,9);assert.equal(deliveries.F[0].blocked,undefined);
 assert.equal(deliveries.P[0].slot,2);
});

test('stack growth relocates the mark while retaining the requested delivery quantity',()=>{
 const mark={id:'stack',slot:1,item:{name:'leather',q:3}};
 reconcileDeliveries({F:[mark]},status([{slot:6,item:{name:'leather',q:20}}]),{},100000);
 assert.equal(mark.slot,6);assert.equal(mark.item.q,3);
});

test('merged stacks retain both recipients without promising more stock than exists',()=>{
 const deliveries={F:[{id:'f',slot:1,item:{name:'leather',q:3}}],P:[{id:'p',slot:2,item:{name:'leather',q:4}}]};
 reconcileDeliveries(deliveries,status([{slot:6,item:{name:'leather',q:7}}]),{},100000);
 for(const marks of Object.values(deliveries)) {assert.equal(marks[0].slot,6);assert.equal(marks[0].blocked,undefined);}
 assert.equal(deliveries.F[0].item.q,3);assert.equal(deliveries.P[0].item.q,4);
 reconcileDeliveries(deliveries,status([{slot:6,item:{name:'leather',q:4}}]),{},100001);
 assert.equal(deliveries.P[0].blocked,'Reserved delivery item missing');assert.equal(deliveries.P[0].item.q,4);
});

test('stale inventory and recipient equipment cannot move or erase a modern delivery',()=>{
 const mark={id:'modern',slot:1,item:orb,equipOnDelivery:true},deliveries={F:[mark]};
 assert.deepEqual(reconcileDeliveries(deliveries,{...status([{slot:6,item:orb}]),seenAt:1},{},100000),[]);
 assert.equal(mark.slot,1);
 reconcileDeliveries(deliveries,status([]),{F:status([],{orb:{item:orb}})},100001);
 assert.equal(deliveries.F[0],mark);assert.equal(mark.blocked,'Reserved delivery item missing');
});

test('one available copy cannot unblock two deliveries and uncertainty survives relocation',()=>{
 const marks=[{id:'a',slot:1,item:orb,blocked:'Transfer outcome uncertain'},{id:'b',slot:2,item:orb}];
 reconcileDeliveries({F:marks},status([{slot:7,item:orb}]),{},100000);
 assert.equal(marks[0].slot,7);assert.equal(marks[0].blocked,'Transfer outcome uncertain');
 assert.equal(marks[1].blocked,'Reserved delivery item missing');
});
test('equipped legacy orb is retired once without consuming a different level',()=>{
 const deliveries={F:[{slot:10,item:orb,equipOnDelivery:true}]};
 const recipient=status([{slot:22,item:{...orb,level:1}}],{orb:{item:orb}});
 assert.match(reconcileDeliveries(deliveries,status(),{F:recipient},100000).join(' '),/already-equipped/);
 assert.deepEqual(deliveries.F,[]);assert.deepEqual(reconcileDeliveries(deliveries,status(),{F:recipient},100001),[]);
});
test('stale reports, different properties and duplicate requests cannot establish delivery',()=>{
 for(const recipient of [status([],{orb:{item:{...orb,level:1}}}),{...status([],{orb:{item:orb}}),seenAt:1},status([],{orb:{item:{...orb,p:'shiny'}}})]) {
  const deliveries={F:[{item:orb,equipOnDelivery:true}]};reconcileDeliveries(deliveries,status(),{F:recipient},100000);
  assert.equal(deliveries.F.length,1);assert.ok(deliveries.F[0].blocked);
 }
 const deliveries={F:[{item:orb,equipOnDelivery:true},{item:orb,equipOnDelivery:true}]};
 reconcileDeliveries(deliveries,status(),{F:status([],{orb:{item:orb}})},100000);assert.equal(deliveries.F.length,2);
});
test('moved stock unblocks missing delivery, but uncertainty is not silently retried',()=>{
 const mark={id:'d',item:{name:'leather',q:3}},deliveries={F:[mark]};
 reconcileDeliveries(deliveries,status([{slot:7,item:{name:'leather',q:2}}]),{},100000);assert.ok(mark.blocked);
 reconcileDeliveries(deliveries,status([{slot:9,item:{name:'leather',q:3}}]),{},100000);assert.equal(mark.blocked,undefined);
 mark.blocked='Transfer outcome uncertain';reconcileDeliveries(deliveries,status([{slot:9,item:{name:'leather',q:3}}]),{},100000);assert.ok(mark.blocked);
});
test('receipts survive a later job failure and cannot consume a newer identical request',()=>{
 const f=fixture({state:{merchantDeliveries:{F:[{id:'first',item:orb},{id:'second',item:orb}]}}});
 const route=createMerchantCompletionRoute(f.state,f.ports);
 const body={deliveryReceipt:true,character:'M',target:'F',deliveryId:'first',phase:'confirmed'};
 route({body},f.response);route({body},f.response);
 assert.deepEqual(f.state.merchantDeliveries.F.map(x=>x.id),['second']);
 route({body:{jobId:'job',success:false,error:'interrupted',merchantDeliveriesDelivered:[{id:'first',item:orb}]}},f.response);
 assert.deepEqual(f.state.merchantDeliveries.F.map(x=>x.id),['second']);
 route({body},f.response);assert.equal(f.response.body.ok,true);
});
test('equip receipt is idempotent across persisted state reload',()=>{
 let marks=[{id:'d',item:orb,equipOnDelivery:true}];
 acknowledgeDelivery(marks,{id:'d'});marks=JSON.parse(JSON.stringify(marks));
 assert.equal(acknowledgeDelivery(marks,{id:'d'}),undefined);assert.equal(marks.length,1);assert.equal(marks[0].awaitingEquip,true);
});
function client(storage=new Map(),request=async()=>{}) {
 const src=fs.readFileSync('characters/shared.js','utf8'),start=src.indexOf('  var recoveredDeliveryJournal = false;'),end=src.indexOf('  async function prepareBankUpgrades',start);
 let sends=0;const context={root:{localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}},character:{name:'M',ctype:'merchant'},request,merchantSendItem:async()=>{sends++;}};
 vm.createContext(context);vm.runInContext(src.slice(start,end),context);return {context,storage,sends:()=>sends};
}
test('lost confirmation response and runtime reload retry only the receipt',async()=>{
 let fail=true;const a=client(new Map(),async(_url,{body})=>{if(body.phase==='confirmed'&&fail)throw Error('offline');});
 await a.context.sendReservedMerchantDelivery({target:'F'},{id:'d',item:orb},4);assert.equal(a.sends(),1);
 assert.equal(JSON.parse(a.storage.get('party-deliveries:M')).d.phase,'confirmed');
 fail=false;const b=client(a.storage);await b.context.recoverMerchantDeliveryReceipts();assert.equal(b.sends(),0);assert.deepEqual(JSON.parse(a.storage.get('party-deliveries:M')),{});
});
test('restart during send blocks that delivery without another game send',async()=>{
 const storage=new Map([['party-deliveries:M',JSON.stringify({d:{deliveryReceipt:true,character:'M',target:'F',deliveryId:'d',phase:'sending'}})]]);
 const reports=[],c=client(storage,async(_url,{body})=>reports.push(body.phase));
 await c.context.recoverMerchantDeliveryReceipts();assert.deepEqual(reports,['uncertain']);
 assert.equal(await c.context.sendReservedMerchantDelivery({target:'F'},{id:'d',item:orb},4),false);assert.equal(c.sends(),0);
});
test('missing reserved delivery does not prevent a valid later delivery or collection',async()=>{
 const src=fs.readFileSync('characters/shared.js','utf8'),start=src.indexOf('        for (var markedDeliveryIndex = 0;'),end=src.indexOf('        for (var d = 0;',start);
 const sent=[],context={command:{target:'F',merchantDeliveries:[{id:'missing',item:orb},{id:'valid',slot:3,item:{name:'sword'}}]},deliveredMerchantItems:[],activity:[],character:{items:{3:{name:'sword'}}},sameItem:(a,b)=>a?.name===b.name,findItem:()=>-1,sendReservedMerchantDelivery:async(_c,m)=>{sent.push(m.id);return true;},collected:false};
 vm.createContext(context);await vm.runInContext('(async()=>{'+src.slice(start,end)+'collected=true;})()',context);
 assert.deepEqual(sent,['valid']);assert.equal(context.collected,true);assert.equal(context.deliveredMerchantItems.length,1);
});
test('legacy final receipts remain usable after IDs are assigned',()=>{
 const receipt={slot:4,item:orb},marks=[{...receipt,id:'migrated',legacy:true}];
 acknowledgeDelivery(marks,receipt);assert.equal(marks.length,0);
});
test('an uncertain receipt arriving after confirmation cannot demote an equipment request',()=>{
 const f=fixture({state:{merchantDeliveries:{F:[{id:'d',item:orb,equipOnDelivery:true}]}}});
 const route=createMerchantCompletionRoute(f.state,f.ports),body={deliveryReceipt:true,character:'M',target:'F',deliveryId:'d',phase:'confirmed'};
 route({body},f.response);route({body:{...body,phase:'uncertain'}},f.response);
 assert.equal(f.state.merchantDeliveries.F[0].awaitingEquip,true);assert.equal(f.state.merchantDeliveries.F[0].blocked,undefined);
});
test('repeated cleanout requests do not duplicate jobs or queued logs',()=>{
 const {createMerchantHandoffRoutes}=require('../../runtime/coordinator/http/merchant-handoff.ts');
 const state={merchantCharacter:'M',merchantCurrent:null,merchantQueue:[]};let logs=0;
 const ports={owned:()=>true,queue:(names,reason)=>state.merchantQueue.push({target:names[0],reason}),log:()=>logs++};
 const response={json:x=>x,status(){return this;}},routes=createMerchantHandoffRoutes(state,ports);
 routes.cleanout({body:{character:'F'}},response);routes.cleanout({body:{character:'F'}},response);
 assert.equal(state.merchantQueue.length,1);assert.equal(logs,1);
});
test('cancelled or already completed delivery is never sent by a stale command',async()=>{
 const c=client(new Map(),async()=>({ok:true,pending:false}));
 assert.equal(await c.context.sendReservedMerchantDelivery({target:'F'},{id:'d',item:orb},4),false);
 assert.equal(c.sends(),0);
});
test('equipment receipt clears only its delivery ID among identical items',()=>{
 const {createInventoryReceiptRoutes}=require('../../runtime/coordinator/http/inventory-receipts.ts');
 const state={merchantDeliveries:{F:[{id:'first',item:orb,awaitingEquip:true},{id:'second',item:orb,awaitingEquip:true}]},commands:{F:{type:'equip-deliveries',id:9}}};
 const route=createInventoryReceiptRoutes(state,{owned:()=>true,log:()=>{},persist:()=>{}}),response={json:x=>x,status(){return this;}};
 route.equipment({body:{character:'F',commandId:9,results:[{item:orb,deliveryId:'second',success:true}]}},response);
 assert.deepEqual(state.merchantDeliveries.F.map(x=>x.id),['first']);
});
