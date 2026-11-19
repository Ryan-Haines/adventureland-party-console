const {withRunner}=require('./helpers/merchant-runner.cjs');
const {productionFunctions} = require('./helpers/production-functions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {inventoryMergePlan:plan}=require('../../runtime/items/coordinator/storage.ts');
const entry=(slot,name,q,extra={})=>({slot,item:{name,q,...extra},meta:{definition:{s:9999}}});
const status=()=>({name:'M',items:[entry(10,'slice_nightberry',2),entry(15,'slice_nightberry',432),entry(18,'gem1',43),entry(28,'gem1',1)]});
test('plans Nightberry 434 followed by Tiny Ruby 44 without moving unrelated slots',()=>{
 const s=status(),p={merchantCharacter:'M'};let m=plan(p,s);assert.deepEqual([m.to,m.from],[10,15]);
 s.items=s.items.filter(e=>e.slot!==15);s.items[0].item.q=434;m=plan(p,s);assert.deepEqual([m.to,m.from],[18,28]);
});
for(const field of ['marked','merchantMarked','upgrades','compounds','withdrawals','statScrolls'])test(field+' reservations preserve separately marked stacks',()=>{
 const s=status(),p={merchantCharacter:'M',[field]:{M:[{slot:15,item:s.items[1].item}]}};
 assert.equal(plan(p,s).source.name,'gem1');
});
for(const field of ['standListings','npcSaleMarks','merchantDeliveries','merchantCargo','merchantQueue'])test(field+' prevents consolidation of promised items',()=>{
 const s=status(),p={merchantCharacter:'M',[field]:[{item:s.items[1].item}]};assert.equal(plan(p,s).source.name,'gem1');
});
// The game's can_stack (game) refuses a locked copy, a different title, a PvP copy beside a plain
// one and a cxjar with other data.
test('stack limits, locks and different properties do not merge',()=>{
 for(const extra of [{l:'l'},{p:'shiny'},{v:1}]) {
 const s={name:'M',items:[entry(0,'gem1',43),entry(1,'gem1',1,extra)]};assert.equal(plan({merchantCharacter:'M'},s),null);
 }
 assert.equal(plan({merchantCharacter:'M'},{name:'M',items:[entry(0,'cxjar',2,{data:'a'}),entry(1,'cxjar',1,{data:'b'})]}),null);
 assert.equal(plan({merchantCharacter:'M'},{name:'M',items:[entry(0,'gem1',9998),entry(1,'gem1',2)]}),null);
});
test('another bag holder defers consolidation, a running job does not',()=>{
 // upgradeInventoryBusy is the report of an upgrade, the tidy or a held lucky slot owning cells
 // (the lucky slot E2E held __partyInventoryCommands for this).
 for(const flag of ['banking','gatheringActive','rip','upgradeInventoryBusy'])assert.equal(plan({merchantCharacter:'M'},{...status(),[flag]:true}),null);
 assert.deepEqual([plan({merchantCharacter:'M',merchantCurrent:{id:'j'}},status()).to],[10]);
 const rewards={id:'x',reason:'exchange',exchangeRewards:[{name:'slice_nightberry',q:2}]};
 assert.deepEqual([plan({merchantCharacter:'M',merchantCurrent:rewards},status()).to],[10]);
});
test('PvP Nightberry singleton stays separate until the server removes its marker',()=>{
 const s={name:'M',items:[entry(10,'slice_nightberry',1,{v:'2026-09-11T21:23:09.427Z'}),entry(29,'slice_nightberry',257)]};
 const p={merchantCharacter:'M'};
 assert.equal(plan(p,s),null);
 delete s.items[0].item.v;
 const merge=plan(p,s);assert.deepEqual([merge.to,merge.from],[10,29]);
});
test('two PvP stacks can merge despite different acquisition timestamps',()=>{
 const s={name:'M',items:[entry(10,'slice_nightberry',1,{v:'2026-09-11T21:23:09.427Z'}),entry(29,'slice_nightberry',257,{v:'2026-09-11T21:00:00.000Z'})]};
 assert.ok(plan({merchantCharacter:'M'},s));
});
// The merchant's merge (bank.ts `mergeBag`) asks for a plan over the bag it sends, so no
// dispatched plan can replay stale below joins two partials and leaves a locked copy.
test('runtime never swaps stacks the game refuses to stack',async()=>{
 const {bagMerge}=require('./helpers/items-character.cjs');
 const refused=bagMerge({items:[{name:'slice_nightberry',q:2},{name:'slice_nightberry',q:432},null],canStack:()=>false});
 assert.equal(await refused.bank.mergeBag(),0);assert.deepEqual(refused.swaps,[]);
});
test('inventory fingerprints preserve the server PvP marker for planning',()=>{
 const {fingerprint}=require('../../runtime/items/identity.ts');
 const item={name:'slice_nightberry',q:1,v:'2026-09-11T21:23:09.427Z'};
 assert.deepEqual(JSON.parse(JSON.stringify(fingerprint(item))),item);
});
test('failed move backs off without changing inventory or throwing out stand recovery',async()=>{
 const {bagMerge}=require('./helpers/items-character.cjs');
 const failed=bagMerge({items:[{name:'slice_nightberry',q:2},{name:'slice_nightberry',q:432},null],swap:async()=>{throw Error('failed');}});
 assert.equal(await failed.bank.mergeBag(),0);
 assert.equal(failed.character.items[1].q,432);assert.equal(failed.bank.stackError(),'failed');
 assert.equal(await failed.bank.mergeBag(),0);assert.equal(failed.swaps.length,1,'the next ask waits for a bag change');
});
test('merge endpoint plans with current reservations rather than the old dispatched plan',()=>{
 const s=status();s.seenAt=Date.now();const party={merchantCharacter:'M',statuses:{M:s}};
 const {createStackMergeRoute}=require('../../runtime/items/coordinator/routes/inventory.ts');
 const handler=createStackMergeRoute(party,{now:()=>Date.now(),anniversary:()=>({}),bankboiBusy:()=>false,plan:items=>plan(party,{...s,items})});
 let merge;const check=()=>handler({body:{character:'M',items:s.items}},{json:body=>{merge=body.merge;}});
 check();assert.deepEqual([merge.to,merge.from],[10,15]);
 party.marked={M:[{slot:15,item:s.items[1].item}]};check();assert.equal(merge.source.name,'gem1');
});

// The composed route plans the bag the merchant sent, not the stored report's, and a bag with a
// malformed cell plans nothing.
test('the composed stack merge route plans the sent bag',()=>{
 const {createCoordinatorInventoryActions}=require('../../runtime/items/coordinator/routes/inventory.ts');
 const stored={name:'M',seenAt:Date.now(),items:[{slot:0,item:{name:'gem1',q:1}},{slot:1,item:{name:'gem1',q:1}}]};
 const state={merchantCharacter:'M',statuses:{M:stored},nextCommandId:1,merchantCatalog:{allItems:[{id:'gem1',meta:{definition:{s:9999}}}]}};
 const actions=createCoordinatorInventoryActions(state,{offline:()=>false,now:()=>Date.now(),anniversary:()=>({}),bankboiBusy:()=>false,plan,reconcile(){}});
 let answer;const send=items=>{actions.merge({body:{character:'M',items}},{json:body=>{answer=body.merge;}});return answer;};
 const merge=send([{slot:4,item:{name:'gem1',q:2}},null,{slot:6,item:{name:'gem1',q:3}}]);
 assert.deepEqual([merge.to,merge.from,merge.quantity],[4,6,3]);
 assert.equal(send([{slot:4,item:{name:'gem1',q:2}},{item:{name:'gem1',q:3}}]),null);
});

// Failure inventory: a per-copy report carries no definition, so the stack
// limit falls to 1 and the merchant never merges partial stacks.
test('per-copy reports read the stack limit from the catalog',()=>{
 const slim=(slot,name,q)=>({slot,item:{name,q},meta:{properties:{}}});
 const s={name:'M',items:[slim(10,'gem1',43),slim(28,'gem1',1)]};
 assert.equal(plan({merchantCharacter:'M'},s),null);
 const merchantCatalog={allItems:[{id:'gem1',meta:{definition:{s:9999}}}]};
 assert.deepEqual([plan({merchantCharacter:'M',merchantCatalog},s).to,plan({merchantCharacter:'M',merchantCatalog},s).from],[10,28]);
});

// An account-bound (`acl`), past-title (`ps`) or PvP (`v`) pile stays apart from a plain one. A
// partial fill tops a stack up when a free cell takes the split; a full bag goes on past that pair
// to a later whole merge.
test("acl, ps and PvP piles stay apart, and a full bag takes the next whole merge",()=>{
 for(const extra of [{acl:1},{ps:['x']},{v:1}])assert.equal(plan({merchantCharacter:'M'},{name:'M',items:[entry(0,'gem1',43),entry(1,'gem1',1,extra)]}),null);
 assert.ok(plan({merchantCharacter:'M'},{name:'M',items:[entry(0,'gem1',43,{ps:['x']}),entry(1,'gem1',1,{ps:['x']})]}));
 const m=plan({merchantCharacter:'M'},{name:'M',items:[entry(0,'gem1',9990),entry(1,'gem1',20),null]});
 assert.deepEqual([m.to,m.from,m.quantity],[0,1,9]);
 const full=plan({merchantCharacter:'M'},{name:'M',items:[entry(0,'gem1',9990),entry(1,'gem1',20),entry(2,'gem0',5),entry(3,'gem0',5)]});
 assert.deepEqual([full.to,full.from,full.quantity],[2,3,5]);
});
// Observed live: the coordinator restarted mid-merge, the permission POST failed with a network
// error, and the unchanged bag never asked again, leaving candy at 549 and 31.
test('a failed permission request asks again on the same bag',async()=>{
 const {bagMerge}=require('./helpers/items-character.cjs');
 let down=true;
 const restarted=bagMerge({items:[{name:'candy0',q:549},{name:'candy0',q:31},null],request:async()=>{if(down)throw Error('POST /merchant/stack-merge-permission · network');}});
 assert.equal(await restarted.bank.mergeBag(),0);
 down=false;
 assert.equal(await restarted.bank.mergeBag(),1);
 assert.deepEqual(restarted.character.items.map(item=>item?.q??null),[580,null,null]);
 assert.equal(restarted.bank.stackError(),null);
});
// On the character: two compatible partials merge in one visit, a locked copy never moves, and
// the merge waits for another holder of the bag.
test('the bag merge joins partials, leaves a locked copy and waits for the holder',async()=>{
 const {bagMerge}=require('./helpers/items-character.cjs');
 const joined=bagMerge({items:[{name:'gem1',q:43},{name:'gem1',q:1},{name:'gem0',q:5},{name:'gem0',q:5},null]});
 assert.equal(await joined.bank.mergeBag(),2);
 assert.deepEqual(joined.character.items.map(item=>item?.q??null),[44,null,10,null,null]);
 const locked=bagMerge({items:[{name:'gem1',q:43},{name:'gem1',q:1,l:'l'},null]});
 assert.equal(await locked.bank.mergeBag(),0);
 assert.deepEqual(locked.swaps,[]);
 const held=bagMerge({items:[{name:'gem1',q:43},{name:'gem1',q:1},null]});
 held.bag.take('banking');
 const merging=held.bank.mergeBag();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(held.swaps,[],'no merge beside the banking holder');
 held.bag.release('banking');
 assert.equal(await merging,1);
});
// A merge that moves nothing ends the loop, and the next ask waits for the bag to change. Red on an
// earlier build: 84 passes with a 2 s recheck.
test('a merge loop with no change ends and waits for a bag change',async()=>{
 const {bagMerge}=require('./helpers/items-character.cjs');
 const still=bagMerge({items:[{name:'gem1',q:43},{name:'gem1',q:1},null],swap:()=>{}});
 assert.equal(await still.bank.mergeBag(),0);
 assert.equal(await still.bank.mergeBag(),0);
 assert.deepEqual([still.swaps.length,still.asks.length],[1,1]);
 still.character.items[2]={name:'hpot0',q:1};
 await still.bank.mergeBag();
 assert.equal(still.asks.length,2,'a changed bag asks again');
});

// The composed inventory actions hand the route's plan the bag the merchant sends, so the
// plan does not read a stale stored bag.
test('the composed merge route plans the bag the merchant sends, not the stored one',()=>{
 const {createCoordinatorInventoryActions}=require('../../runtime/items/coordinator/routes/inventory.ts');
 const meta={definition:{s:9999}},stored=[{slot:0,item:{name:'gem1',q:5},meta},{slot:1,item:{name:'sword'},meta}];
 const sent=[{slot:0,item:{name:'gem1',q:5},meta},{slot:1,item:{name:'gem1',q:7},meta},null];
 const state={merchantCharacter:'M',statuses:{M:{name:'M',seenAt:100000,items:stored}},nextCommandId:1,bankbois:{},withdrawals:{},merchantQueue:[],merchantCurrent:null,
  standListings:[],npcSaleMarks:[],marked:{},merchantMarked:{},upgrades:{},compounds:{},statScrolls:{},merchantDeliveries:{}};
 const actions=createCoordinatorInventoryActions(state,{plan,now:()=>100000,anniversary:()=>({}),bankboiBusy:()=>false,reconcile(){},persist(){},publish(){},log(){},queue(){},
  idle(){},dispatch(){},stamp:job=>job,key:item=>item.name,write:()=>({ok:true})});
 const ask=items=>{let merge;actions.merge({body:{character:'M',items}},{json:body=>{merge=body.merge;},status(){return this;}});return merge;};
 assert.equal(ask(stored),null,'the stored bag holds nothing to merge');
 const merge=ask(sent);assert.deepEqual([merge.from,merge.to],[1,0]);
});
