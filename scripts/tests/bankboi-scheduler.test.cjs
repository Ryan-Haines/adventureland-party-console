const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const routing=require('../../runtime/items/coordinator/storage.ts');
const {coordinatorSource,withCoordinatorImports}=require('./helpers/coordinator-source.cjs');
const {partyHooks}=require('../../runtime/hooks/index.ts');
// The group and event answers a transaction's start reads (merchantEventReserved, merchantSlotCommand):
// no group holds the merchant and no event return is deferred.
require('../../runtime/tasks/api.ts').publishTasks({groupOf:()=>null,live:()=>null});
require('../../runtime/events/api.ts').publishEventAnswers({deferredReturn:()=>false});
const source=coordinatorSource();
// A free BankBoi cell reads null, as a worker's report keeps every bag cell (bank.ts `items`).
const bag=(...filled)=>Object.assign(Array(42).fill(null),filled);
function fixture(){
 const party={merchantCharacter:'M',statuses:{M:{map:'bank',seenAt:Date.now(),standOpen:false}},
 merchantCurrent:null,merchantQueue:[{reason:'upgrades and compounds'}],headlessSlots:['M'],lifecycle:{},commands:{},nextCommandId:1,
 bankbois:{B:{name:'B',state:'ready',items:bag()}},withdrawals:{M:[]},bankSnapshot:{packs:{}},
 bankboiQueue:[{id:'a',pack:'items1',slot:35,state:'staged',item:{name:'leather',q:2}}],bankboiTransaction:null};
 const swaps=[];
 const c=vm.createContext(withCoordinatorImports({party,Date,Number,Math,character_manage:{M:{}},softkill_block:async()=>{}}));
 // The roster's slot answer starts the named character in the slot.
 partyHooks().publish({name:'core:roster-fixture',folder:'core',author:'test',summary:'Starts a character in a slot.',
  hooks:{'roster.assign':(slot,name)=>{party.headlessSlots[slot-1]=name;swaps.push(name);},'roster.offline':async()=>true}});
 const service=routing.createBankboiStorage(party,c.character_manage,{now:()=>Date.now(),stop:block=>c.softkill_block(block),
  persistRoster(){},persistBank(){},collect:()=>c.collectWithdrawals?.(),log(){},merchantHeld:()=>false});
 c.maybeStartBankboiService=service.start;c.restoreMerchantAfterBankboi=service.restore;c.bankboiService=service;
 return {party,c,swaps};
}
test('one reserve item starts service from the bank despite queued upgrades and a closed stand',async()=>{
 const {party,c,swaps}=fixture();await c.maybeStartBankboiService();
 assert.deepEqual(swaps,['B']);assert.equal(party.merchantQueue.length,1);
 assert.equal(party.bankboiTransaction.phase,'waiting-for-bankboi');
});
test('active merchant operations finish or checkpoint before switching; concurrent calls switch once',async()=>{
 const {party,c,swaps}=fixture();party.merchantCurrent={id:'job'};
 await c.maybeStartBankboiService();assert.equal(swaps.length,0);
 party.merchantCurrent=null;await Promise.all([c.maybeStartBankboiService(),c.maybeStartBankboiService()]);assert.equal(swaps.length,1);
});

test('BankBoi slot swap waits for the current gathering cast to finish',async()=>{
 const {party,c,swaps}=fixture();party.statuses.M.gatheringPhase='cast';
 await c.maybeStartBankboiService();assert.deepEqual(swaps,[]);
 party.statuses.M.gatheringPhase='cooldown';await c.maybeStartBankboiService();assert.deepEqual(swaps,['B']);
});

test('a failed merchant stop releases the transaction and restores its slot',async()=>{
 const {party,c,swaps}=fixture();c.softkill_block=async()=>{throw new Error('fixture stop failed');};
 await c.maybeStartBankboiService();assert.equal(party.bankboiTransaction,null);assert.equal(c.bankboiService.busy(),false);assert.deepEqual(swaps,['M']);
});

test('restoration releases the latch and schedules ordinary bank withdrawals',async()=>{
 const {party,c,swaps}=fixture();let collections=0;c.collectWithdrawals=()=>collections++;
 await c.maybeStartBankboiService();const transaction=party.bankboiTransaction;
 c.character_manage.B={enabled:true};party.withdrawals.M=[{pack:'items1',slot:35}];
 await c.restoreMerchantAfterBankboi(transaction);assert.deepEqual(swaps,['B','M']);assert.equal(party.bankboiTransaction,null);
 assert.equal(c.bankboiService.busy(),false);assert.equal(c.character_manage.B.enabled,false);assert.equal(collections,1);
});
// An interrupted worker runs again at its next report, with no retry time.
test('withdrawal alone schedules service, and transient worker errors are retryable',()=>{
 const {party}=fixture();party.bankboiQueue=[];party.withdrawals.M=[{pack:'bankboi:B',slot:0,item:{name:'sword'}}];
 assert.equal(routing.servicePlan(party).retrievals.length,1);
 Object.assign(party.bankbois.B,{state:'error',error:'bank_unavailable',code:'interrupted'});
 assert.ok(routing.servicePlan(party));
});
// v1.5.0 saved a retryable worker error as text with no code; the load gives it
// one.
test('legacy missing-items1 hydration errors are retryable',()=>{
 const {party}=fixture();const {initialBankState}=require('../../runtime/items/saved-fields.ts');
 const saved={bankbois:{B:{name:'B',state:'error',error:"Cannot read properties of undefined (reading 'items1')",retryAt:0,items:bag()},
  C:{name:'C',state:'error',error:'unknown failure',retryAt:0,items:bag()}}};
 party.bankbois=initialBankState(saved,()=>({}),{declared:(_,value)=>value}).bankbois;
 assert.deepEqual([party.bankbois.B.code,party.bankbois.C.code],['interrupted',undefined]);
 assert.equal(routing.servicePlan(party).candidate.name,'B');
});
// The live reserve drain row (e2e/live-bankboi-offerings.spec.ts 'BankBoi drains all seven reserve
// cells after a persisted movement timeout') saves a worker whose movement plan request timed out.
// It saves the worker with no bag report (items []), which has room for the staged stacks.
test('a saved movement plan timeout is a retryable worker error',()=>{
 const {party}=fixture();const {initialBankState}=require('../../runtime/items/saved-fields.ts');
 for(const items of [bag(),[]]){
  const saved={bankbois:{B:{name:'B',state:'error',error:'POST /movement-plan · timeout',retryAt:0,items}}};
  party.bankbois=initialBankState(saved,()=>({}),{declared:(_,value)=>value}).bankbois;
  assert.equal(party.bankbois.B.code,'interrupted');
  assert.equal(routing.servicePlan(party)?.candidate.name,'B',`items ${items.length}`);
 }
});

test('older interrupted workers get a retry ahead of a recently serviced worker',()=>{
 const {party}=fixture();party.bankbois.B.seenAt=200;
 party.bankbois.C={name:'C',state:'error',error:'interrupted',code:'interrupted',seenAt:100,items:bag()};
 assert.equal(routing.servicePlan(party).candidate.name,'C');
});

test('a full first worker passes the deposits to an interrupted second worker at its next report',async()=>{
 const {party,c,swaps}=fixture();
 const full=Array.from({length:42},()=>({item:{name:'sword'}}));
 party.bankSnapshot.packs={items0:full,items1:full};
 party.bankbois.B.items=full;
 party.bankbois.C={name:'C',state:'error',error:'interrupted',code:'interrupted',items:bag()};
 const pending=routing.servicePlan(party);
 assert.equal(pending.candidate.name,'C');
 assert.equal(pending.requests[0].id,'a');
 await c.maybeStartBankboiService();
 assert.deepEqual(swaps,['C']);
});

test('pending storage does not reserve a terminally failed or full worker',()=>{
 const {party}=fixture();
 party.bankbois.B={name:'B',state:'error',error:'permission_denied',retryAt:Date.now()+60000,items:[]};
 assert.equal(routing.servicePlan(party,{includeCoolingDown:true}),null);
 const full=Array.from({length:42},()=>({item:{name:'sword'}}));
 party.bankSnapshot.packs={items0:full,items1:full};
 party.bankbois.B={name:'B',state:'ready',items:full};
 assert.equal(routing.servicePlan(party,{includeCoolingDown:true}),null);
});
test('a staging drain takes priority over retrieval from a different worker',()=>{
 const {party}=fixture();party.bankbois.C={name:'C',state:'ready',items:[]};party.withdrawals.M=[{pack:'bankboi:C',item:{name:'sword'}}];
 assert.equal(routing.servicePlan(party).candidate.name,'B');
});

test('outbound staging is left for the merchant before retrieving another batch',()=>{
 const {party}=fixture();party.bankboiQueue=[];
 party.bankSnapshot.packs.items1=Array(35).fill(null).concat(Array.from({length:7},()=>({item:{name:'ring'}})));
 party.withdrawals.M=[...Array.from({length:7},(_,i)=>({pack:'items1',slot:35+i,item:{name:'ring'}})),{pack:'bankboi:B',item:{name:'sword'}}];
 assert.equal(routing.servicePlan(party),null);
 party.bankboiQueue=[{id:'stale',pack:'items1',slot:35,state:'staged',item:{name:'ring'}}];
 assert.equal(routing.servicePlan(party),null);
});

test('merchant pickup of outbound staging outranks optional gathering',()=>{
 const {party,c}=fixture();party.withdrawals.M=[{pack:'items1',slot:35}];party.bankSnapshot.packs.items1=Array(42).fill(null);party.bankSnapshot.packs.items1[35]={item:{name:'ring'}};
 c.merchantRoutinePriority=()=>88;
 vm.runInContext(source.slice(source.indexOf('  function merchantJobPriority('),source.indexOf('  function prioritizedStandBids(')),c);
 assert.equal(c.merchantJobPriority({target:'M',reason:'manual bank exchange'}),101);
});
