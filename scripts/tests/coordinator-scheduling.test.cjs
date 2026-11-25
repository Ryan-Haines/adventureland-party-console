const test=require('node:test');
const assert=require('node:assert/strict');
const {createMerchantScheduling}=require('../../runtime/merchant-jobs/coordinator/sources.ts');
const {createMerchantScheduling: createComposedScheduling}=require('../../runtime/merchant-jobs/coordinator/api.ts');
// itemsDoor publishes the items owner's answers into the process-wide hook registry. Each row gets a
// registry of its own, so the storage a row plants never answers in a later row.
let hooksBefore;
test.beforeEach(()=>{hooksBefore=Object.getOwnPropertyDescriptor(globalThis,'__partyHooks');delete globalThis.__partyHooks;});
test.afterEach(()=>{if(hooksBefore)Object.defineProperty(globalThis,'__partyHooks',hooksBefore);else delete globalThis.__partyHooks;});
function fixture(){
 const state={merchantCharacter:'M',merchantCurrent:null,merchantQueue:[],merchantAutomations:{},gatheringModes:[],gatheringCooldowns:{},
  merchantCapacityBlocked:false,transferSignatures:{},itemCollectionThreshold:5,upgrades:{},compounds:{},statScrolls:{},marked:{},merchantMarked:{},
  statuses:{M:{name:'M',items:Array(10).fill(null)}},bankCurrent:null,bankStartedAt:0,threshold:1000,thresholdRunActive:false,bankCycleMembers:{}};
 const effects=[];let slots=0,gold=[],proposes=false;
 const ports={reconcileReport:()=>{effects.push('items','upgrades','sales');return true;},
  luck:()=>effects.push('luck'),recovery:()=>effects.push('recovery'),standMarket:()=>false,giveaways:()=>effects.push('giveaways'),compounds:()=>effects.push('compound'),exchanges:()=>effects.push('exchange'),
  policy:()=>({hp:{item:'hpot',min:1,max:10},mp:{item:'mpot',min:1,max:10}}),queue:(names,reason)=>effects.push(['queue',names,reason]),
  markedItem:mark=>mark.item,sameItem:(left,right)=>left?.name===right.name,collectionSlots:()=>slots,standSync:()=>effects.push('stand'),dispatch:()=>effects.push('dispatch'),idle:()=>effects.push('idle'),addonProposes:()=>proposes,expire:()=>effects.push('expire'),
  clearOwnedCommand:(name,matches)=>effects.push(['clear',name,matches]),dispatchBank:()=>effects.push('dispatchBank'),activeNames:()=>gold.map(entry=>entry.name),persist:()=>effects.push('persist'),now:()=>200000};
 require('./helpers/coordinator-merchant.cjs').itemsDoor(state);
 return {state,effects,now:ports.now,observe:createMerchantScheduling(state,ports).observe,slots:value=>{slots=value;},proposes:value=>{proposes=value;},
  gold:value=>{gold=value;for(const entry of value)state.statuses[entry.name]={...state.statuses[entry.name],name:entry.name,gold:entry.gold};}};
}
test('first reconnect preserves marks, and a later report whose reconciliation changed something persists',()=>{
 const f=fixture(), report={name:'P'};f.observe(report,false);assert.equal(f.effects.includes('items'),false);
 f.effects.length=0;f.observe(report,true);assert.deepEqual(f.effects.slice(0,4),['items','upgrades','sales','persist']);
});

test('fighter automatic marks schedule collection and retire empty legacy manual jobs',()=>{
 const f=fixture();f.state.upgrades.P=[{auto:true,item:{name:'wcap'}}];
 f.state.merchantQueue=[{target:'P',reason:'manual upgrades'},{target:'P',reason:'auto compound'}];
 f.observe({name:'P',items:[]},false);
 assert.ok(f.effects.some(x=>Array.isArray(x)&&x[2]==='marked items'));
 assert.equal(f.effects.some(x=>Array.isArray(x)&&x[2]==='manual upgrades'),false);
 assert.deepEqual(f.state.merchantQueue,[{target:'P',reason:'auto compound'}]);
 f.state.upgrades.P.push({item:{name:'coat'}});f.observe({name:'P',items:[]},false);
 assert.ok(f.effects.some(x=>Array.isArray(x)&&x[2]==='manual upgrades'));
});
test('below-threshold collection is not scheduled; capacity reserve blocks collection and resets stale signatures',()=>{
 const f=fixture(),report={name:'P',items:[{item:{name:'coat'}}]};f.state.marked.P=[{slot:0,item:{name:'coat'}}];
 f.state.merchantAutomations.restock=false;f.state.merchantAutomations['inventory cleanout']=false;
 f.slots(2);f.observe(report,false);assert.equal(f.effects.some(entry=>Array.isArray(entry)&&entry[2]==='marked items'),false);
 f.slots(5);f.observe(report,false);assert.equal(f.effects.filter(entry=>Array.isArray(entry)&&entry[2]==='marked items').length,1);
 f.observe(report,false);assert.equal(f.effects.filter(entry=>Array.isArray(entry)&&entry[2]==='marked items').length,1);
 f.observe({name:'M',items:Array(3).fill(null)},false);assert.equal(f.state.merchantCapacityBlocked,true);assert.deepEqual(f.state.transferSignatures,{});
});
test('gold collection queues newcomers once per threshold cycle and fighter restock follows dispatch',()=>{
 const f=fixture();f.gold([{name:'P',gold:2000}]);f.observe({name:'P',items:[]},false);
 assert.ok(f.effects.indexOf('idle')<f.effects.findIndex(entry=>Array.isArray(entry)&&entry[2]==='restock'));
 assert.deepEqual(f.effects.at(-1),['queue',['P'],'gold threshold']);
 f.observe({name:'P'},false);assert.deepEqual(f.effects.at(-1),['queue',[],'gold threshold']);
 f.gold([]);f.observe({name:'P'},false);assert.equal(f.state.thresholdRunActive,false);
});
// A stalled visit clears the command type its bank queue sent, an upgrade
// included.
test('a stalled upgrade visit clears its upgrade command',()=>{
 const f=fixture();f.state.bankCurrent={name:'P',type:'upgrade'};
 f.state.statuses.P={name:'P',seenAt:0};f.observe({name:'M',items:Array(10).fill(null)},false);
 const clear=f.effects.find(entry=>Array.isArray(entry)&&entry[0]==='clear');assert.equal(clear[1],'P');
 assert.deepEqual([clear[2]({type:'upgrade'}),clear[2]({type:'bank'})],[true,false]);
 assert.equal(f.state.bankCurrent,null);
});
// A higher-ranked command written over a present holder's visit frees the bank slot, and the
// visit waits at the queue's head; with no visit running, a report asks the queue again.
test('a visit whose slot another command took returns to the queue head',()=>{
 const f=fixture();f.state.bankCurrent={name:'P',type:'bank'};f.state.bankQueue=[{name:'Q',type:'bank'}];
 f.state.commands={P:{id:4,type:'event-resume-travel'}};f.state.statuses.P={name:'P',seenAt:f.now()};
 f.observe({name:'M',items:Array(10).fill(null)},false);
 assert.deepEqual([f.state.bankCurrent,f.state.bankQueue],[null,[{name:'P',type:'bank'},{name:'Q',type:'bank'}]]);
 assert.ok(f.effects.includes('dispatchBank'));
 f.effects.length=0;f.observe({name:'M',items:Array(10).fill(null)},false);assert.ok(f.effects.includes('dispatchBank'));
});
test('pending delivery equipment resumes after restart without overwriting another command',()=>{
 const f=fixture();f.state.nextCommandId=10;f.state.commands={P:{id:9,type:'convoy'}};
 f.state.merchantDeliveries={P:[{item:{name:'intearring',level:2},awaitingEquip:true}]};
 f.observe({name:'P'},false);assert.equal(f.state.commands.P.type,'convoy');
 delete f.state.commands.P;f.observe({name:'P'},false);
 assert.equal(f.state.commands.P.type,'equip-deliveries');assert.equal(f.state.commands.P.items[0].level,2);
 delete f.state.commands.P;f.observe({name:'P'},false);assert.equal(f.state.commands.P,undefined,'failed attempts are rate limited');
});

test('merchant observations persist relocated delivery marks before scheduling further work',()=>{
 const f=fixture(),mark={id:'delivery',slot:1,item:{name:'sword',level:2},equipOnDelivery:true};
 f.state.merchantDeliveries={P:[mark]};
 const report={name:'M',seenAt:200000,items:[{slot:1,item:{name:'leather',q:20}},{slot:7,item:{...mark.item}}]};
 f.state.statuses.M=report;
 f.observe(report,false);
 assert.equal(mark.slot,7);assert.equal(mark.id,'delivery');assert.equal(mark.equipOnDelivery,true);
 assert.equal(f.effects[0],'persist');assert.ok(f.effects.indexOf('persist')<f.effects.indexOf('idle'));
});

test('ready deliveries alone schedule a visit by default and after re-enabling',()=>{
 const f=fixture();f.state.merchantAutomations={restock:false,'inventory cleanout':false,'party collection':false};
 f.state.merchantDeliveries={P:[{id:'d',slot:1,item:{name:'sword'}}]};
 const report={name:'P',items:Array(10).fill(null)};
 f.observe(report,false);
 assert.deepEqual(f.effects.filter(x=>Array.isArray(x)&&x[0]==='queue'),[['queue',['P'],'deliveries']]);
 f.effects.length=0;f.state.merchantAutomations.deliveries=false;f.observe(report,true);
 assert.equal(f.effects.some(x=>Array.isArray(x)&&x[2]==='deliveries'),false);
 assert.equal(f.state.merchantDeliveries.P.length,1);
 f.state.merchantAutomations.deliveries=true;f.observe(report,true);
 assert.ok(f.effects.some(x=>Array.isArray(x)&&x[2]==='deliveries'));
});

test('blocked, missing-item and awaiting-equip deliveries do not schedule visits',()=>{
 for(const mark of [{},{item:{name:'sword'},blocked:'Transfer outcome uncertain'},{item:{name:'sword'},awaitingEquip:true}]) {
  const f=fixture();f.state.merchantDeliveries={P:[mark]};f.observe({name:'P'},false);
  assert.equal(f.effects.some(x=>Array.isArray(x)&&x[2]==='deliveries'),false);
 }
});

test('stock reconciliation makes a formerly missing delivery schedulable',()=>{
 const f=fixture(),mark={id:'d',slot:1,item:{name:'sword'},blocked:'Reserved delivery item missing'};
 f.state.merchantDeliveries={P:[mark]};f.state.statuses.M={name:'M',seenAt:200000,items:[{slot:7,item:{name:'sword'}}]};
 f.observe({name:'P'},false);
 assert.equal(mark.slot,7);assert.equal(mark.blocked,undefined);
 assert.ok(f.effects.some(x=>Array.isArray(x)&&x[2]==='deliveries'));
});

test('delivered equipment pauses a convoy then resumes its destination after acknowledgement',()=>{
 const f=fixture(),s=f.state,names=['L','P'];
 const {createSharedConvoyNavigation}=require('../../runtime/movement/coordinator/walk.ts');
 const {createInventoryReceiptRoutes}=require('../../runtime/items/coordinator/routes/inventory.ts');
 const engine=createSharedConvoyNavigation();
 s.nextCommandId=10;s.navigationIntents={L:{revision:1},P:{revision:1}};
 s.commands=Object.fromEntries(names.map(n=>[n,{id:1,type:'party-monster-travel',convoyId:'trip',navigationRevision:1}]));
 s.activeConvoy={id:'trip',epoch:7,phase:'assemble',leader:'L',participants:names,completed:[],
   slowestSpeed:57,purpose:'shared-walk',rally:{map:'main',x:0,y:0},location:{map:'halloween',x:-509,y:-626}};
 for(const n of names)s.statuses[n]={name:n,map:'main',x:0,y:0,speed:57,server:'USII',seenAt:200000,convoyProtocol:4,convoyNavigation:{runtimeId:n}};
 engine.step(s,200000);const destination=s.activeConvoy.location;
 s.merchantDeliveries={P:[{id:'delivery',item:{name:'intearring',level:2},awaitingEquip:true}]};
 const ack=()=>{for(const n of names){const cmd=s.commands[n],c=s.activeConvoy;s.statuses[n].convoyNavigation={id:c.id,epoch:c.epoch,commandId:cmd.id,navigationRevision:cmd.navigationRevision,runtimeId:n,phase:'held'};}};
 f.observe({name:'P'},false);assert.equal(s.commands.P.type,'party-monster-travel');
 engine.step(s,200000);ack();engine.step(s,200000);
 f.observe({name:'P'},false);const equip=s.commands.P;
 assert.equal(equip.type,'equip-deliveries');assert.equal(equip.convoyContinuation.convoyId,'trip');
 engine.step(s,200000);assert.equal(s.activeConvoy.merchantInterruption.phase,'collecting','merchant job can already be finished');
 const receipts=createInventoryReceiptRoutes(s,{owned:()=>true,log(){},persist(){}});
 receipts.equipment({body:{character:'P',commandId:equip.id,results:[{item:equip.items[0],deliveryId:'delivery',success:true}]}},{json(){},status(){return this;}});
 engine.step(s,200000);ack();engine.step(s,200000);
 assert.equal(s.activeConvoy.phase,'shared-prepare');assert.equal(s.activeConvoy.location,destination);
 assert.equal(s.activeConvoy.merchantInterruption,undefined);assert.equal(s.merchantDeliveries.P.length,0);
});
test('scheduling composition preserves non-bank commands, reports storage failures and reads current gold', async () => {
  const state = { merchantCharacter: 'M', merchantCurrent: null, merchantQueue: [], merchantAutomations: {}, gatheringModes: [], gatheringCooldowns: {},
    merchantCapacityBlocked: false, transferSignatures: {}, itemCollectionThreshold: 5, upgrades: {}, compounds: {}, statScrolls: {}, marked: {}, merchantMarked: {},
    statuses: { P: { name: 'P', gold: 1001 } }, bankCurrent: { name: 'P' }, bankStartedAt: 0, threshold: 1000, thresholdRunActive: false, bankCycleMembers: {} };
  const command = { type: 'manual' }, calls = [];
  const no = () => {};
  require('./helpers/coordinator-merchant.cjs').itemsDoor(state, { busy: () => false, start: async () => { throw Error('storage failed'); } });
  const service = createComposedScheduling(state, { reconcileReport: () => false,
    luck: no, recovery: no, standMarket: () => false, giveaways: no, compounds: no, exchanges: no, policy: no,
    queue: (names, reason) => calls.push(['queue', names, reason]), markedItem: no, sameItem: () => false,
    collectionSlots: () => 0, standSync: no, dispatch: no, idle: no, addonProposes: () => false, expire: no,
    log: (message, level, details) => { if (level === 'error') calls.push(['error', message, level, details]); }, clearOwnedCommand: (_, matches) => calls.push(['matches', matches(command)]),
    dispatchBank: () => calls.push('bank'), activeNames: () => ['P'], persist: no, now: () => 200000 });
  service.observe({ name: 'P' }, false); await Promise.resolve();
  assert.equal(state.bankCurrent, null); assert.deepEqual(calls[0], ['matches', false]);
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'queue' && call[2] === 'gold threshold'));
  assert.deepEqual(calls.at(-1), ['error', 'Bankboi scheduler failed', 'error', 'storage failed']);
  state.statuses = { P: { name: 'P', gold: 0 } }; service.observe({ name: 'P' }, false); await Promise.resolve();
  assert.equal(state.thresholdRunActive, false); assert.deepEqual(state.bankCycleMembers, {});
});

// Separate: the live offline-merchant row, where the merchant's reports stopped while its job was
// current. No report dispatched, so the dispatch pass's offline read never ran and the job held for
// the whole row.
// Separate: the live merchant hook table, where the fixture add-on's kind was never asked. The
// add-on's kinds and jobs join only in the dispatch pass, and with every automation off the queue
// stayed empty, so no report dispatched.
test('an idle merchant with an empty queue dispatches while an add-on proposes merchant jobs',()=>{
 const none=fixture();none.observe({name:'P',items:[]},false);
 assert.deepEqual([none.effects.includes('dispatch'),none.effects.includes('idle')],[false,true],'with no add-on the empty queue idles');
 const f=fixture();f.proposes(true);f.observe({name:'P',items:[]},false);
 assert.deepEqual([f.effects.includes('dispatch'),f.effects.includes('idle')],[true,false],'an add-on that proposes gets the dispatch pass');
 const busy=fixture();busy.proposes(true);busy.state.merchantCurrent={id:'j',target:'M',reason:'restock',phase:'assigned'};
 busy.observe({name:'P',items:[]},false);
 assert.equal(busy.effects.includes('dispatch'),false,'a current job still holds the dispatch');
});

test('a party report while a job is current asks the job recovery whether the merchant went offline',()=>{
 const f=fixture();f.state.merchantCurrent={id:'j',target:'M',reason:'manual bank exchange',phase:'assigned'};
 f.observe({name:'P',items:[]},false);
 assert.ok(f.effects.includes('expire'));assert.equal(f.effects.includes('dispatch'),false);
 const idle=fixture();idle.observe({name:'P',items:[]},false);
 assert.equal(idle.effects.includes('expire'),false);
});
