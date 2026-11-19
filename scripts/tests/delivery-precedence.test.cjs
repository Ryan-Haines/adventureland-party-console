const test=require('node:test'),assert=require('node:assert/strict');
const {craftProtection}=require('../../runtime/items/coordinator/production.ts');
const {availableCraftStock}=require('../../runtime/items/rules.ts');
const {compoundStorageLeftovers}=require('../../runtime/items/rules.ts');
const {storeCompoundLeftovers}=require('../../runtime/items/character/bank.ts');
const {createMerchantCompletionRoute}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
const {createInventoryReceiptRoutes}=require('../../runtime/items/coordinator/routes/inventory.ts');
const {fixture}=require('./helpers/coordinator-completion.cjs');
const item={name:'intearring',level:2},rule={name:'intearring',targetTier:3,quantity:-1};
const stock=(n,owner='M')=>Array.from({length:n},(_,slot)=>({slot,item:{...item},craftLocation:'inventory:'+owner}));
const state=()=>({merchantCharacter:'M',merchantDeliveries:{F:[{slot:1,item:{...item},equipOnDelivery:true}]}});
test('delivery copy is neither an ingredient nor bankable; other copies remain eligible',()=>{
 const s=state(),entries=stock(3),p=craftProtection(s),safe=availableCraftStock(entries,p);
 assert.equal(safe[1],null);assert.deepEqual(compoundStorageLeftovers([rule],safe,safe).map(e=>e.slot),[0,2]);
 const four=availableCraftStock(stock(4),p);assert.deepEqual(compoundStorageLeftovers([rule],four,four),[]);
 s.merchantDeliveries.F=[];assert.equal(availableCraftStock(entries,craftProtection(s)).filter(Boolean).length,3);
});
test('delivery reservations relocate without stealing another marked copy or reserving every duplicate',()=>{
 const s=state();s.merchantDeliveries.P=[{slot:0,item:{...item}}];
 const entries=stock(4);entries[1]=null;
 const safe=availableCraftStock(entries,craftProtection(s));
 assert.equal(safe[0],null);assert.equal(safe[2],null);assert.ok(safe[3]);
});
test('a new delivery mark after the bank trip prevents the next deposit',async()=>{
 const s=state();s.merchantDeliveries.F=[];let inventory=stock(1);const deposits=[];
 await storeCompoundLeftovers({refresh:async()=>{},rules:()=>[rule],inventorySize:()=>1,
 stock:()=>availableCraftStock(inventory,craftProtection(s)),visitBank:async()=>{s.merchantDeliveries.F=[{slot:0,item}];},deposit:async slot=>{deposits.push(slot);inventory[slot]=null;},log(){}});
 assert.deepEqual(deposits,[]);
});
test('confirmed transfer moves reservation to recipient; failed equip and restart retain it until success',()=>{
 const f=fixture({state:{merchantDeliveries:{F:[{slot:1,item,equipOnDelivery:true}]}},job:{reason:'manual visit'}});
 const mark=f.state.merchantDeliveries.F[0];
 createMerchantCompletionRoute(f.state,f.ports)({body:{jobId:'job',success:true,merchantDeliveriesDelivered:[mark]}},f.response);
 assert.equal(f.state.merchantDeliveries.F[0].awaitingEquip,true);
 assert.equal(availableCraftStock(stock(1,'F'),craftProtection(f.state))[0],null);
 assert.ok(availableCraftStock(stock(1,'M'),craftProtection(f.state))[0]);
 const saved=JSON.parse(JSON.stringify(f.state));const r=createInventoryReceiptRoutes(saved,{owned:()=>true,log(){},persist(){},persistBank(){},dispatchBank(){}});
 const res={json(){},status(){return this;}};const id=saved.commands.F.id;
 r.equipment({body:{character:'F',commandId:id,results:[{item,success:false,error:'full'}]}},res);
 assert.equal(saved.merchantDeliveries.F.length,1);
 saved.commands.F={id:999,type:'equip-deliveries'};
 r.equipment({body:{character:'F',commandId:999,results:[{item,success:true}]}},res);
 assert.equal(saved.merchantDeliveries.F.length,0);
});

test('delivery receipt preserves active travel and durably queues equipment',()=>{
 const f=fixture({state:{commands:{F:{id:42,type:'party-monster-travel',convoyId:'trip'}},
   merchantDeliveries:{F:[{id:'delivery',slot:1,item,equipOnDelivery:true}]}},job:{reason:'manual visit'}});
 const travel=f.state.commands.F,mark={...f.state.merchantDeliveries.F[0]};
 createMerchantCompletionRoute(f.state,f.ports)({body:{jobId:'job',success:true,merchantDeliveriesDelivered:[mark]}},f.response);
 assert.equal(f.state.commands.F,travel);assert.equal(f.state.merchantDeliveries.F[0].awaitingEquip,true);
});

// E08-10c: the handoff's pre-send recheck reads the copy's one fate. This row
// checks the fate the recheck reads; the handoff's send on that fate runs in automatic-collection-client.
test('E08-10c: an item with a compound rule still has a fate that reaches the merchant (MJ90)',()=>{
  const state=({merchantCharacter:'M',statuses:{F:{items:Array(42).fill(null)}},marked:{},merchantMarked:{},upgrades:{},compounds:{},statScrolls:{},merchantQueue:[],merchantCurrent:null,orders:[],restockPolicies:{F:{hp:{item:'hpot1',min:0,max:0},mp:{item:'mpot1',min:0,max:0}}},autoCompounds:{F:[{name:'ringsj',quantity:-1,targetTier:3}]},autoItemMarks:{F:{'ringsj@+0':'merchant'}}});
  state.statuses.F.items[5]={slot:5,item:{name:'ringsj',level:0}};
  const fate=require('../../runtime/items/coordinator/fates.ts').itemFate(state,'F',5);
  assert.equal(fate.row,'F5');
  assert.equal(require('../../runtime/items/rules.ts').fateReachesMerchant(fate),true);
});
// The items owner's identity rule resolves which copy a mark with no slot names, so a
// delivery's hold on the first matching copy leaves the mark's banked second copy riding the errand.
test('items.fate: a mark with no slot answers the copy it names that I1 banks', () => {
  const state = ({ merchantCharacter: 'M', statuses: { F: { items: Array(42).fill(null) } }, marked: { F: [{ name: 'ringsj', level: 0 }] }, merchantMarked: {},
    merchantDeliveries: { F: [{ slot: 0, item: { name: 'ringsj', level: 0 } }] }, upgrades: {}, compounds: {}, statScrolls: {}, merchantQueue: [], merchantCurrent: null, orders: [],
    restockPolicies: { F: { hp: { item: 'hpot1', min: 0, max: 0 }, mp: { item: 'mpot1', min: 0, max: 0 } } }, autoCompounds: {}, autoItemMarks: {} });
  state.statuses.F.items[0] = { slot: 0, item: { name: 'ringsj', level: 0 } };
  state.statuses.F.items[1] = { slot: 1, item: { name: 'ringsj', level: 0 } };
  const { itemFate } = require('../../runtime/items/coordinator/fates.ts');
  assert.deepEqual([itemFate(state, 'F', 0).fate, itemFate(state, 'F', 0).by], ['held', 'delivery']);
  assert.equal(itemFate(state, 'F', state.marked.F[0]).fate, 'bank');
});
