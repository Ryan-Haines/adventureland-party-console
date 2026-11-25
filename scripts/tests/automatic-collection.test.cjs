const {productionFunction} = require('./helpers/production-functions.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {collectionPickups}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
const { mergePickupJobs } = require('../../runtime/merchant-jobs/rules.ts');
const {createMerchantQueue}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
const {coordinatorCollectionSlots,coordinatorCollectionReady}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
const {coordinatorMerchantTransferBlocked}=require('../../runtime/merchant-jobs/rules.ts');
const {merchantJobPriority,routineEnabled}=require('../../runtime/merchant-jobs/rules.ts');
const {partyMerchantCommand}=require('../../runtime/merchant-jobs/coordinator/commands.ts');
const {createMerchantHandoffRoutes}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
const {plannedOperationStage}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
const item=(slot,name,extra={})=>({slot,item:{name,level:0,...extra}});
function fixture(){
 const entries=[item(0,'coat'),item(1,'ring'),item(2,'junk',{q:8}),item(3,'gem')];
 return {merchantCharacter:'M',merchantAutomations:{},merchantRules:{version:1,owner:'M',members:['M','F'],conflicts:[],backup:{}},statuses:{F:{seenAt:1000,map:'main',server:'US II',x:0,y:0,items:entries},M:{seenAt:1000,map:'main',server:'US II',x:1000,y:0,items:Array(42).fill(null)}},marked:{F:[entries[3]]},merchantMarked:{F:[{...entries[2],quantity:4,npcSaleId:'sale'}]},upgrades:{F:[{...entries[0],tiers:3,auto:true}]},autoCompounds:{M:[{name:'ring',targetTier:2,quantity:-1}]},npcSaleMarks:[{id:'sale',auto:true,source:'character',character:'F',state:'collecting',slot:2,item:entries[2].item,quantity:4}],compounds:{},statScrolls:{},autoItemMarks:{},goldTargets:{},commands:{},merchantQueue:[],merchantCurrent:null,itemCollectionThreshold:4,threshold:100};
}
test('automatic upgrade, compound and sale pickups merge at collection priority and capacity',()=>{
 const s=fixture(),state={queue:[],current:null,blocks:{}};
 const priority=j=>merchantJobPriority(j,{routines:{'party collection':85,'auto upgrade':91,'auto compound':93,'auto npc sales':98},bids:{},completesStorageHandoff:()=>false});let next=0;
 const q=createMerchantQueue(state,{merchant:()=> 'M',bankboi:()=>false,enabled:reason=>routineEnabled({reason},s.merchantAutomations),collectionReady:j=>coordinatorCollectionReady(s,j,()=>1000),capacitySignature:()=>'',gold:()=>({bank:0,merchant:0}),nextId:()=>String(++next),now:()=>1000,routinePriority:()=>85,priority,stamp:j=>({...j,priority:priority(j)}),hasPendingStandInventory:()=>false,persist(){},dispatch(){},log(){}});
 for(const r of ['auto upgrade','auto compound','auto npc sale pickup','marked items'])q.queue(['F'],r);
 assert.equal(state.queue.length,1);assert.equal(state.queue[0].reason,'marked items');assert.equal(state.queue[0].priority,85);
 assert.equal(coordinatorCollectionSlots(s,'F'),4);
 s.statuses.M.items=Array(42).fill(item(0,'cap'));assert.equal(coordinatorMerchantTransferBlocked(s,state.queue[0]),true);
 s.merchantAutomations['party collection']=false;state.queue.length=0;q.queue(['F'],'auto compound');assert.equal(state.queue.length,0);
});
test('selection respects disabled processing, slot uniqueness, locked items and reservations',()=>{
 const s=fixture();assert.deepEqual(collectionPickups(s,'F').keep.map(m=>m.slot).sort(),[0,1,2]);
 s.merchantMarked.F.push(s.statuses.F.items[0]);assert.equal(coordinatorCollectionSlots(s,'F'),4);
 s.merchantMarked.F.pop();s.merchantAutomations['auto upgrade']=false;s.merchantAutomations['auto npc sales']=false;
 assert.deepEqual(collectionPickups(s,'F').keep.map(m=>m.slot),[1]);
 s.statuses.F.items[1].item.l='l';assert.equal(collectionPickups(s,'F').keep.length,0);
 delete s.statuses.F.items[1].item.l;s.merchantQueue=[{id:'craft',order:{crafts:[{id:'recipe',quantity:1}],requirements:[{id:'ring',level:0,quantity:1}],sources:{F:[{item:{name:'ring',level:0},quantity:1}]}}}];assert.equal(collectionPickups(s,'F').keep.length,0);
});
test('ordinary collection excludes manual NPC sale reservations but manual pickup still works',()=>{
 const s=fixture();s.npcSaleMarks[0].auto=false;
 assert.equal(coordinatorCollectionSlots(s,'F'),3);assert.equal(coordinatorCollectionSlots(s,'F','npc sale pickup'),1);
});
test('pending migration preserves earliest age and unrelated work without touching active jobs',()=>{
 const old={id:'old',target:'F',reason:'auto compound',routine:'auto compound',priorityOverride:99,queuedAt:1};
 const input=[{id:'collection',target:'F',reason:'marked items',queuedAt:4},old,{id:'up',target:'F',reason:'auto upgrade',queuedAt:2},{id:'sale',target:'F',reason:'auto npc sale pickup',queuedAt:3},{id:'own',target:'M',reason:'auto compound'},{id:'manual',target:'F',reason:'manual upgrades'}];
 const jobs=mergePickupJobs(input,'M');assert.equal(jobs.length,3);assert.equal(jobs[0].queuedAt,1);assert.equal(jobs[0].routine,'party collection');assert.equal(jobs[0].priorityOverride,undefined);assert.equal(old.reason,'auto compound');assert.equal(jobs[1].reason,'auto compound');
 assert.deepEqual(mergePickupJobs(jobs,'M'),jobs);
});
test('collection handoff uses keep receipts and sends no processing instructions',()=>{
 const s=fixture();s.merchantCurrent={id:'job',reason:'marked items',target:'F'};
 const routes=createMerchantHandoffRoutes(s,{offline:()=>false,nextCommand:()=>7,persist(){},owned:()=>true,queue(){},log(){},now:()=>1000,visitAllowed:()=>true});
 const response={status(){return this},json(v){return v}};
 routes.handoff({body:{jobId:'job',target:'F',capacity:4}},response);
 const command=s.commands.F;
 assert.deepEqual(command.upgrades,[]);assert.deepEqual(command.autoCompounds,[]);assert.deepEqual(command.compounds,[]);
 assert.deepEqual(command.merchantMarked.map(m=>m.slot).sort(),[0,1,2]);
 const sale=command.merchantMarked.find(m=>m.npcSaleId);assert.equal(sale.quantity,4);
 routes.complete({body:{jobId:'job',character:'F',commandId:7,kept:[{...sale,quantity:3}]}},response);
 assert.equal(s.npcSaleMarks[0].source,'merchant');assert.equal(s.npcSaleMarks[0].quantity,3);
 const work={marked:[],upgrades:[1],compounds:[2],autoCompounds:[{name:'ring'}],statScrolls:[],withdrawals:[],deliveries:[],purchases:[]};
 const service=partyMerchantCommand(1,s.merchantCurrent,{seenAt:1000,items:[]},{merchant:'M',work:()=>work,npcSales:[{auto:true}],statScrolls:{},restock:()=>({}),gatheringModes:[],workingGold:0,visitWithdrawals:()=>[]});
 for(const field of ['upgrades','compounds','autoCompounds','npcSales'])assert.deepEqual(service[field],[]);
});
test('planned activity separates bank retrieval from merchant inventory processing',()=>{
 const rings=[item(0,'ring'),item(1,'ring'),item(2,'ring')],rules=[{name:'ring',targetTier:2,quantity:-1}];
 assert.equal(plannedOperationStage('auto compound',[],rules,[]),'retrieving');assert.equal(plannedOperationStage('auto compound',rings,rules,[]),'processing');
 assert.equal(plannedOperationStage('auto upgrade',[item(0,'coat')],[],[{...item(0,'coat'),auto:true}]),'processing');
});


test('Hunt movement blocks dispatch without pruning work and defers a raced handoff',()=>{
 // The allows('merchant-visit') check refuses F, as a Hunt turn-in's return convoy does.
 const s=fixture();s.activeConvoy={phase:'failed',nonPreemptible:true,participants:['F']};let held=['F'];
 s.merchantCurrent={id:'job',reason:'marked items',target:'F'};
 const {coordinatorReadyFacts}=require('../../runtime/merchant-jobs/coordinator/dispatch.ts'),{pruneIneligibleCollections,merchantVisitRefused}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
 const allowed=name=>!held.includes(name),facts=coordinatorReadyFacts(s,{now:()=>1000,visitAllowed:allowed});
 s.merchantQueue=[s.merchantCurrent];
 assert.equal(facts.waits(s.merchantCurrent),true);
 assert.equal(pruneIneligibleCollections(s,()=>1000,facts),false);assert.equal(s.merchantQueue.length,1);
 assert.equal(merchantVisitRefused({target:'M',reason:'auto upgrade'},allowed),false);
 assert.equal(merchantVisitRefused({target:'M',reason:'merchant commerce',order:{sources:{F:[]}}},allowed),true);
 assert.equal(merchantVisitRefused({target:'M',reason:'merchant commerce',order:{sources:{F:[]}},resumeState:{phase:'leveling'}},allowed),false);
 const routes=createMerchantHandoffRoutes(s,{offline:()=>false,nextCommand:()=>7,persist(){},owned:()=>true,queue(){},log(){},now:()=>1000,visitAllowed:allowed});
 const before={...s.commands};const response={status(){return this},json(v){return v}};
 assert.deepEqual(routes.handoff({body:{jobId:'job',target:'F'}},response),{deferred:true,reason:'hunt_movement_owned'});
 assert.deepEqual(s.commands,before);
 s.merchantCurrent={id:'commerce',reason:'merchant commerce',target:'M',order:{sources:{F:[]}}};
 assert.deepEqual(routes.order({body:{jobId:'commerce',target:'F'}},response),{deferred:true,reason:'hunt_movement_owned'});
 held=[];assert.equal(merchantVisitRefused(s.merchantQueue[0],allowed),false);
});


test('protected work does not prevent unrelated merchant selection and becomes eligible on release',()=>{
 const s=fixture();let held=['F'];
 s.merchantRoutinePriorities={};s.withdrawals={};
 const blocked={id:'blocked',reason:'service',target:'F',priorityOverride:99,queuedAt:1};
 s.merchantQueue=[blocked,{id:'other',reason:'auto upgrade',target:'M',queuedAt:2}];
 const {takeCoordinatorMerchantJob,coordinatorCollectionReady}=require('../../runtime/merchant-jobs/coordinator/owner.ts'),{coordinatorReadyFacts}=require('../../runtime/merchant-jobs/coordinator/dispatch.ts');
 const {coordinatorMerchantTransferBlocked}=require('../../runtime/merchant-jobs/rules.ts');
 const {partyHooks}=require('../../runtime/hooks/index.ts');
 // The pick reads the dispatch pass's facts; the other owners' answers hold nothing here.
 partyHooks().publish({name:'core:automatic-collection-reads',folder:'core',author:'test',summary:'Nothing holds a job.',
  hooks:{'cave.state':()=>({owned:false}),'items.needs':()=>({gold:0,withdrawals:[],slots:0,postage:0})}});
 const pass=()=>coordinatorReadyFacts(s,{now:()=>1000,visitAllowed:name=>!held.includes(name),capacityBlocked:job=>coordinatorMerchantTransferBlocked(s,job),
  collectionReady:job=>coordinatorCollectionReady(s,job,()=>1000)});
 assert.equal(takeCoordinatorMerchantJob(s,pass()).id,'other');
 assert.equal(s.merchantQueue[0],blocked);
 held=[];assert.equal(takeCoordinatorMerchantJob(s,pass()).id,'blocked');
});

test('character handoff helper yields immediately for Hunt ownership instead of polling or proceeding',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 let requests=0;
 const c=vm.createContext({request:async()=>{requests++;return {deferred:true,reason:'hunt_movement_owned'};},sleep:()=>{throw Error('must not poll');}});
 // The convoy pause ask is the job owner's visit module.
 require('./helpers/merchant-visits.cjs').installVisits(c);
 await assert.rejects(c.requestMerchantHandoff('/merchant/handoff',{}),e=>e.reason==='hunt_movement_owned');
 assert.equal(requests,1);
});
