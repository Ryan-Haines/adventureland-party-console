const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorStatusIngestion}=require('../../runtime/coordinator/status/composition.ts');
const {createMerchantScheduling}=require('../../runtime/coordinator/status/merchant-scheduling.ts');

// Failure inventory for status reports that omit unchanged inventory:
// (1) a loot pickup, equip or bank deposit reaches the coordinator a report
//     later than before, or not at all;
// (2) a report that omits items, slots or bank clears them in coordinator
//     state or hides them from a heartbeat consumer;
// (3) merchant scheduling (collectionSignature, supplies, capacity, delivery
//     recovery's inventorySeenAt) sees a different inventory than a full
//     report would have shown it;
// (4) a coordinator that does not hold the reported revision (restart, a
//     second runtime, a legacy full report in between) applies the report
//     with stale or missing inventory;
// (5) a coordinator built before this change, which never acknowledges a
//     revision, stops receiving inventory;
// (6) public state, the dashboard and external clients see a field or value
//     that a full report would not have produced.

const coat={slot:0,item:{name:'coat',level:1},meta:{properties:{armor:20}}};
const sword={slot:1,item:{name:'sword',level:0},meta:{properties:{attack:30}}};
const bank={gold:5,packs:{items0:[{slot:0,item:{name:'bkey'},meta:{properties:{}}}]}};
function fixture(extra={}){
 const state={statuses:{},headlessSlots:[],steamMembers:[],steamSwitch:null,nativeOwner:null,merchantCharacter:'M',leader:'F',
  monsterHunt:{phase:'before'},aldata:{auth:'NO'},scatterMonsterTypes:[],scatterEpoch:1,scatterBreakTarget:null,
  partyFarmingMode:'default',partyFarmingMonsterType:null,farmingPolicy:'automatic'};
 const seen=[],calls=[],workers={M:{},F:{}},bankState={snapshot:null,observer:null};let now=1000;
 const observe=(port)=>(body)=>{seen.push({port,name:body.name,items:body.items,slots:body.slots,bank:'bank' in body?body.bank:'absent'});calls.push(port);};
 const service=createCoordinatorStatusIngestion(state,workers,{
  now:()=>now,owned:()=>true,persistRoster(){},itemKey:item=>item.name,observePonty(){},bankState,
  bankPorts:{now:()=>now,adoptReservedCargo(){},persist:()=>calls.push('bank-persist')},
  merchant:observe('merchant'),groupedCombat(){},rareReport(){},rareTick(){},bankboi:observe('bankboi'),anniversary(){},
  huntTick(){},farmAreaTick(){},persist(){},abtesting(){},activeNames:()=>Object.keys(state.statuses),events:observe('events'),publish(){},
  convoyStep:()=>false,merchantScheduling:observe('merchantScheduling'),response:name=>({name,command:null}),...extra,
 });
 function invoke(body){const res={code:200,status(code){this.code=code;return this;},json(value){this.body=value;return this;}};
  service.handle({body:JSON.parse(JSON.stringify(body))},res);return res;}
 return {state,seen,calls,bankState,invoke,time:value=>{now=value;}};
}
const full=(name,revision,fields={})=>({name,ctype:name==='M'?'merchant':'warrior',inventoryRevision:revision,
 items:[coat,null],slots:{mainhand:sword},bank:null,...fields});
const delta=(name,revision,fields={})=>({name,ctype:name==='M'?'merchant':'warrior',inventoryRevision:revision,...fields});

test('an unchanged report keeps items, slots and bank for every consumer and in state',()=>{
 const t=fixture();
 assert.equal(t.invoke(full('M','s.1',{bank})).code,200);
 const first=JSON.parse(JSON.stringify(t.state.statuses.M));
 t.seen.length=0;t.time(2000);
 const reply=t.invoke(delta('M','s.1',{hp:90}));
 assert.equal(reply.code,200);
 for(const entry of t.seen){
  assert.deepEqual(entry.items,[coat,null],entry.port);
  assert.deepEqual(entry.slots,{mainhand:sword},entry.port);
 }
 assert.deepEqual(t.state.statuses.M.items,first.items);
 assert.deepEqual(t.state.statuses.M.slots,first.slots);
 assert.equal(t.state.statuses.M.hp,90);
 assert.equal(t.state.statuses.M.inventorySeenAt,2000,'delivery recovery reads an unchanged inventory as current');
 assert.equal(t.bankState.observer,'M','the bank observer stays the reporting merchant');
 assert.deepEqual(t.bankState.snapshot.packs,bank.packs);
 assert.equal(t.calls.filter(call=>call==='bank-persist').length,1,'an unchanged bank is not stored again');
});

test('omitted fields never clear inventory across many reports',()=>{
 const t=fixture();t.invoke(full('F','a.1'));
 for(let i=0;i<20;i++){t.time(2000+i*1000);assert.equal(t.invoke(delta('F','a.1')).code,200);}
 assert.deepEqual(t.state.statuses.F.items,[coat,null]);
 assert.deepEqual(t.state.statuses.F.slots,{mainhand:sword});
 assert.equal(t.state.statuses.F.bank,null);
 assert.equal(t.state.statuses.F.inventoryRevision,undefined,'the revision is transport state, not character state');
});

test('a changed inventory replaces the carried arrays in the same report',()=>{
 const t=fixture();t.invoke(full('F','a.1'));t.invoke(delta('F','a.1'));
 const loot={slot:1,item:{name:'gem0',q:1},meta:{properties:{}}};
 t.invoke(full('F','a.2',{items:[coat,loot]}));
 assert.deepEqual(t.state.statuses.F.items,[coat,loot]);
 t.invoke(delta('F','a.2'));
 assert.deepEqual(t.state.statuses.F.items,[coat,loot]);
 t.invoke(full('F','a.3',{items:[coat,loot],slots:{}}));
 assert.deepEqual(t.state.statuses.F.slots,{},'an unequip shows in the report that carries it');
});

test('a report the coordinator cannot complete is refused before any consumer runs',()=>{
 const t=fixture();
 const restart=t.invoke(delta('F','a.1',{hp:1}));
 assert.equal(restart.code,409);assert.equal(restart.body.code,'inventory-required');
 assert.deepEqual(t.calls,[]);assert.equal(t.state.statuses.F,undefined);
 t.invoke(full('F','a.1'));t.calls.length=0;
 assert.equal(t.invoke(delta('F','a.2',{hp:2})).code,409,'a revision this coordinator never received');
 assert.deepEqual(t.calls,[]);assert.equal(t.state.statuses.F.hp,undefined);
 t.invoke({name:'F',items:[null,null],slots:{}});
 assert.equal(t.invoke(delta('F','a.1')).code,409,'a full report without a revision replaces the held one');
 assert.deepEqual(t.state.statuses.F.items,[null,null]);
});

test('the response acknowledges only the revision the coordinator holds',()=>{
 const t=fixture();
 assert.equal(t.invoke(full('F','a.1')).body.inventoryRevision,'a.1');
 assert.equal(t.invoke(delta('F','a.1')).body.inventoryRevision,'a.1');
 assert.equal('inventoryRevision' in t.invoke({name:'F',items:[],slots:{}}).body,false);
 assert.equal('inventoryRevision' in t.invoke({name:'F',hp:1}).body,false);
});

test('a report without the bank field keeps it absent and a legacy report without items stays legacy',()=>{
 const t=fixture();
 const legacy={name:'F',ctype:'warrior',inventoryRevision:'a.1',items:[coat],slots:{}};
 t.invoke(legacy);t.invoke(delta('F','a.1'));
 assert.equal('bank' in t.state.statuses.F,false);
 assert.equal(t.seen.filter(entry=>entry.port==='merchantScheduling').every(entry=>entry.bank==='absent'),true);
 t.invoke({name:'F',ctype:'warrior',hp:3});
 assert.equal(t.state.statuses.F.items,undefined,'a report with neither items nor a revision is unchanged');
 assert.equal(t.state.statuses.F.inventorySeenAt,undefined);
});

test('merchant collection queues marked items once across unchanged reports and again after a change',()=>{
 const schedule={merchantCharacter:'M',merchantCurrent:null,merchantQueue:[],merchantAutomations:{restock:false,'inventory cleanout':false},gatheringModes:[],gatheringCooldowns:{},
  merchantCapacityBlocked:false,transferSignatures:{},itemCollectionThreshold:1,upgrades:{},compounds:{},statScrolls:{},marked:{F:[{slot:0,item:{name:'coat',level:1}}]},merchantMarked:{},
  statuses:null,bankCurrent:null,bankStartedAt:0,threshold:1e12,thresholdRunActive:false,bankCycleMembers:{}};
 const queued=[];
 let scheduling;
 const t=fixture({merchantScheduling:(body,previous)=>scheduling.observe(body,previous)});
 schedule.statuses=t.state.statuses;
 const noop=()=>false;
 scheduling=createMerchantScheduling(schedule,{reconcileItems:noop,reconcileUpgrades:noop,reconcileSales:noop,luck(){},recovery(){},standMarket:noop,giveaways(){},compounds(){},exchanges(){},
  policy:()=>({hp:{item:'hpot0',min:0,max:0},mp:{item:'mpot0',min:0,max:0}}),queue:(names,reason)=>queued.push(names.join()+':'+reason),
  markedItem:mark=>mark.item,sameItem:(left,right)=>!!left&&!!right&&left.name===right.name&&left.level===right.level,
  collectionSlots:name=>(t.state.statuses[name]?.items||[]).filter(Boolean).length,standSync(){},dispatch(){},idle(){},bankboi(){},
  clearCommand(){},dispatchBank(){},activeGold:()=>[],persist(){},now:()=>1000});
 t.invoke(full('M','m.1',{items:Array(10).fill(null)}));
 t.invoke(full('F','a.1'));
 for(let i=0;i<5;i++)t.invoke(delta('F','a.1'));
 t.invoke(full('F','a.1'));
 assert.deepEqual(queued,['F:marked items'],'unchanged reports and the heartbeat keep the collection signature');
 schedule.marked.F.push({slot:1,item:{name:'sword',level:0}});
 t.invoke(full('F','a.2',{items:[coat,sword]}));
 t.invoke(delta('F','a.2'));
 assert.deepEqual(queued,['F:marked items','F:marked items']);
});

// Character side of the same inventory: items, slots and bank leave the
// report only while the coordinator acknowledged the current revision.
const fs=require('node:fs'),vm=require('node:vm');
const {namedFunction}=require('./helpers/named-function.cjs');
function client(){
 const source=fs.readFileSync('characters/shared.js','utf8');
 const requests=[];let clock=100000;
 const context=vm.createContext({
  JSON,Math,Object,Array,String,Number,Error,Promise,
  Date:{now:()=>clock},
  character:{items:[{name:'coat',level:1},null],slots:{mainhand:{name:'sword',level:0}},bank:null},
  activeUpgrade:null,catalogKnown:true,statusInventoryCache:null,statusInventoryAcknowledged:null,
  statusInventoryFullAt:0,statusInventoryCount:0,statusInventorySession:'s',
  inventoryOperationEntry:(item,slot)=>item?{slot,item:{...item},meta:{properties:{}}}:null,
  fingerprint:item=>({...item}),itemDefinition:()=>({properties:{}}),
  bankSnapshot:()=>context.character.bank?{gold:context.character.bank.gold,packs:{items0:context.character.bank.items0.map((item,slot)=>item?{slot,item:{...item}}:null)}}:null,
  api:'http://coordinator',root:{},sampleTravelReport(){},convoyDiagnosticClock:()=>0,acceptTravelResponse(){},
  applyEventReturnOwner:()=>Promise.resolve(),rememberConvoyStatusRequest(){},diagnosticText:value=>String(value),
  $:{ajax(options){
   const body=JSON.parse(options.data);requests.push(body);
   const handlers={};
   const reply=context.reply(body);
   queueMicrotask(()=>reply.status===200?handlers.done(reply.body):handlers.fail({status:reply.status,responseJSON:reply.body},'error','Conflict'));
   return {done(fn){handlers.done=fn;return this;},fail(fn){handlers.fail=fn;return this;}};
  }},
  reply:body=>({status:200,body:{inventoryRevision:body.inventoryRevision}}),queueMicrotask,
 });
 vm.runInContext(['statusInventory','attachStatusInventory','acknowledgeStatusInventory','withStatusInventory','request']
  .map(name=>namedFunction(source,name)).join('\n'),context);
 const send=async()=>{const body=context.attachStatusInventory({name:'P'});await context.request('/status',{method:'POST',body});return requests.at(-1);};
 return {context,requests,send,time:value=>{clock=value;}};
}

test('a report omits inventory only while it matches the acknowledged revision',async()=>{
 const c=client();
 const first=await c.send();
 assert.deepEqual(first.items.map(entry=>entry&&entry.item.name),['coat',null]);
 assert.equal(first.slots.mainhand.item.name,'sword');
 assert.equal('bank' in first,true);
 const unchanged=await c.send();
 assert.equal('items' in unchanged||'slots' in unchanged||'bank' in unchanged,false);
 assert.equal(unchanged.inventoryRevision,first.inventoryRevision);
 c.context.character.items[1]={name:'gem0',q:1};
 const loot=await c.send();
 assert.equal(loot.items[1].item.name,'gem0','a loot pickup is in the next report');
 assert.notEqual(loot.inventoryRevision,first.inventoryRevision);
 c.context.character.slots.offhand={name:'shield',level:0};
 assert.equal((await c.send()).slots.offhand.item.name,'shield','an equip is in the next report');
 c.context.character.bank={gold:10,items0:[{name:'coat',level:1}]};
 assert.equal((await c.send()).bank.packs.items0[0].item.name,'coat','a bank deposit is in the next report');
 c.context.character.items[0].level=2;
 assert.equal((await c.send()).items[0].item.level,2,'a change inside an item object is in the next report');
 c.context.activeUpgrade={slot:1,item:{name:'gem0',q:1}};
 assert.ok((await c.send()).items,'an upgrade starting changes the reported inventory');
 assert.equal('items' in await c.send(),false);
});

test('a coordinator that never acknowledges a revision receives every inventory',async()=>{
 const c=client();c.context.reply=()=>({status:200,body:{}});
 for(let i=0;i<3;i++)assert.ok((await c.send()).items);
});

test('inventory is sent at least every 10 seconds and always before the catalog acknowledgement',async()=>{
 const c=client();await c.send();
 c.time(109999);assert.equal('items' in await c.send(),false);
 c.time(110000);assert.ok((await c.send()).items,'heartbeat');
 assert.equal('items' in await c.send(),false);
 c.context.catalogKnown=false;
 assert.ok((await c.send()).items);assert.ok((await c.send()).items);
});

test('a refused report is sent again with inventory in the same request',async()=>{
 const c=client();await c.send();
 c.context.reply=body=>body.items?{status:200,body:{inventoryRevision:body.inventoryRevision}}:{status:409,body:{error:'inventory revision unknown',code:'inventory-required'}};
 const before=c.requests.length;
 const body=c.context.attachStatusInventory({name:'P',hp:5});
 assert.equal('items' in body,false);
 const value=await c.context.request('/status',{method:'POST',body});
 assert.equal(value.inventoryRevision,body.inventoryRevision);
 assert.equal(c.requests.length,before+2);
 assert.equal(c.requests.at(-1).hp,5);assert.ok(c.requests.at(-1).items);
 c.context.reply=()=>({status:409,body:{code:'inventory-required'}});
 await assert.rejects(c.context.request('/status',{method:'POST',body:{name:'P',items:[]}}),/409/,'a refused full report is not retried');
});

// Failure inventory for skipping the bank comparison on a carried bank:
// (1) consumeBankReport skips storing a changed bank; (2) a carried bank leaves
// in place a snapshot that another character or the storage worker replaced;
// (3) the observer stays the other character after the carried bank's report;
// (4) consumeBankReport adopts reserved cargo on a report that changed nothing.
const {consumeBankReport}=require('../../runtime/coordinator/status/bank.ts');
test('a carried bank skips the comparison only while it produced the current snapshot',()=>{
 const state={snapshot:null,observer:null},effects=[];
 const ports={now:()=>100,adoptReservedCargo:()=>effects.push('adopt'),persist:()=>effects.push('persist')};
 const carried={gold:5,packs:{items0:[null]}};
 let reads=0;
 const counted=new Proxy(carried,{get(target,key,receiver){if(key==='packs')reads++;return Reflect.get(target,key,receiver);}});
 consumeBankReport({name:'M',bank:counted},state,ports);
 assert.deepEqual(effects,['adopt','persist']);
 reads=0;
 for(let i=0;i<5;i++){const body={name:'M',bank:counted};consumeBankReport(body,state,ports);assert.equal('bank' in body,false);}
 assert.equal(reads,0,'an unchanged carried bank is not serialized again');
 assert.equal(state.observer,'M');assert.equal(effects.length,2);
 consumeBankReport({name:'P',bank:{gold:6,packs:{items0:[null]}}},state,ports);
 assert.equal(state.observer,'P');assert.equal(state.snapshot.gold,6);
 consumeBankReport({name:'M',bank:counted},state,ports);
 assert.equal(state.observer,'M','the carried bank is compared again after another observer');
 assert.equal(state.snapshot.gold,5);
 state.snapshot={gold:9,packs:{},character:'BankBoi',seenAt:1};
 consumeBankReport({name:'M',bank:counted},state,ports);
 assert.equal(state.snapshot.gold,5,'a snapshot the storage worker replaced is compared again');
 const changed={gold:7,packs:{items0:[null]}};
 consumeBankReport({name:'M',bank:changed},state,ports);
 assert.equal(state.snapshot.gold,7);
});
