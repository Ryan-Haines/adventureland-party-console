const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const routing=require('../bank-stack-routing.cjs');
const source=require('./helpers/coordinator-source.cjs').coordinatorSource();
function fixture(){
 const party={merchantCharacter:'M',statuses:{M:{map:'bank',seenAt:Date.now(),standOpen:false}},
 merchantCurrent:null,merchantQueue:[{reason:'upgrades and compounds'}],headlessSlots:['M'],
 bankbois:{B:{name:'B',state:'ready',items:[]}},withdrawals:{M:[]},bankSnapshot:{packs:{}},
 bankboiQueue:[{id:'a',pack:'items1',slot:35,state:'staged',item:{name:'leather',q:2}}]};
 const swaps=[];
 const c=vm.createContext({party,Date,Number,Math,coordinatorPolicies:require('../../runtime/coordinator/index.ts'),bankStackRouting:routing,bankboiSwitchBusy:false,
 character_manage:{M:{}},persistBankState(){},persistRosterState(){},softkill_block:async()=>{},
 assignHeadlessSlot:(slot,name)=>swaps.push(name),merchantLog(){}});
 const {createBankboiService}=require('../../runtime/coordinator/inventory/bankboi-service.ts');
 const service=createBankboiService({get transaction(){return party.bankboiTransaction;},set transaction(value){party.bankboiTransaction=value;}},{
  now:()=>Date.now(),merchant:()=>party.merchantCharacter,plan:()=>routing.servicePlan(party),merchantStatus:()=>party.statuses.M,merchantBusy:()=>!!party.merchantCurrent,
  slots:()=>party.headlessSlots,clearSlot:index=>{party.headlessSlots[index]=null;},assignSlot:(...args)=>c.assignHeadlessSlot(...args),
  stop:async name=>{const block=c.character_manage[name];if(block){block.enabled=false;await c.softkill_block(block);}},
  persistRoster:()=>c.persistRosterState(),persistBank:()=>c.persistBankState(),hasNormalWithdrawals:()=>party.withdrawals.M.some(r=>!r.pack.startsWith('bankboi:')),
  collectWithdrawals:()=>c.collectWithdrawals?.(),log:(...args)=>c.merchantLog(...args)});
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
 const {party,c,swaps}=fixture();party.statuses.M.gatheringPhase='casting';
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
test('withdrawal alone schedules service, and transient worker errors are retryable',()=>{
 const {party}=fixture();party.bankboiQueue=[];party.withdrawals.M=[{pack:'bankboi:B',slot:0,item:{name:'sword'}}];
 assert.equal(routing.servicePlan(party).retrievals.length,1);
 party.bankbois.B.state='error';party.bankbois.B.error='bank_unavailable';party.bankbois.B.retryAt=Date.now()+10000;
 assert.equal(routing.servicePlan(party),null);party.bankbois.B.retryAt=0;
 assert.ok(routing.servicePlan(party));
});
test('legacy missing-items1 hydration errors are retryable',()=>{
 const {party}=fixture();
 party.bankbois.B={name:'B',state:'error',error:"Cannot read properties of undefined (reading 'items1')",retryAt:0,items:[]};
 assert.equal(routing.servicePlan(party).candidate.name,'B');
});

test('older interrupted workers get a retry ahead of a recently serviced worker',()=>{
 const {party}=fixture();party.bankbois.B.seenAt=200;
 party.bankbois.C={name:'C',state:'error',error:'interrupted',retryAt:0,seenAt:100,items:[]};
 assert.equal(routing.servicePlan(party).candidate.name,'C');
});

test('a full first worker and interrupted second worker keep deposits pending through cooldown',async()=>{
 const {party,c,swaps}=fixture();
 const full=Array.from({length:42},()=>({item:{name:'sword'}}));
 party.bankSnapshot.packs={items0:full,items1:full};
 party.bankbois.B.items=full;
 party.bankbois.C={name:'C',state:'error',error:'interrupted',retryAt:Date.now()+60000,items:[]};
 assert.equal(routing.servicePlan(party),null);
 const pending=routing.servicePlan(party,{includeCoolingDown:true});
 assert.equal(pending.candidate.name,'C');
 assert.equal(pending.requests[0].id,'a');
 await c.maybeStartBankboiService();
 assert.deepEqual(swaps,[], 'pending work must not bypass the retry cooldown');
 party.bankbois.C.retryAt=0;
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
