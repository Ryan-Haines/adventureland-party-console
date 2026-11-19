const test=require('node:test'),assert=require('node:assert/strict');
const {createBankboiStorage:createBankboiService}=require('../../runtime/items/coordinator/storage.ts');
const {itemsSince}=require('./helpers/items-notices.cjs');
// The roster's two answers as a core registration: `assign` starts a character in a slot
// and `offline` answers the row's planted confirmation.
function rosterFixture(assign,offline=async()=>true){
 const {partyHooks}=require('../../runtime/hooks/index.ts');
 partyHooks().publish({name:'core:roster-fixture',folder:'core',author:'test',summary:'Starts a character in a slot.',
  hooks:{'roster.assign':assign,'roster.offline':name=>offline(name)}});
}
function fixture(confirm){
 let now=200000;
 const state={bankboiTransaction:{id:'t',bankboi:'B',mode:'store',phase:'processing',slot:1,requestIds:['keep'],retrievals:[],startedAt:1},
  merchantCharacter:'M',headlessSlots:['B'],statuses:{B:{seenAt:now}},lifecycle:{B:'online'},commands:{},withdrawals:{M:[{pack:'items0'}]},
  bankbois:{B:{name:'B',items:[]}},bankboiQueue:[]};
 const slots=state.headlessSlots,calls=[];
 rosterFixture((slot,name)=>{calls.push(['assign',name]);slots[slot-1]=name;},name=>confirm(name));
 const ports={now:()=>now,stop:async()=>calls.push(['stop']),persistRoster(){},persistBank(){},collect:()=>calls.push('collect'),log(){},merchantHeld:()=>false};
 return {state,slots,calls,service:createBankboiService(state,{B:{enabled:true}},ports),advance:n=>{now+=n;}};
}
// IT31: a working BankBoi keeps its transaction
// while its reports repeat (a vault sort and a bank pack wait change no report field) and writes no
// bank per report; the roster's offline ends it once, with one `items.storage` notice (1.37).
const working=()=>{
 let now=1;
 const state={bankboiTransaction:{id:'t',bankboi:'B',mode:'store',phase:'processing',slot:1,requestIds:[],retrievals:[],startedAt:0},
  lifecycle:{B:'online'},headlessSlots:['B'],merchantCharacter:'M',commands:{},statuses:{B:{seenAt:now}},withdrawals:{},
  bankbois:{B:{name:'B',items:[]}},bankboiQueue:[]},persisted=[];
 const ports=new Proxy({now:()=>now,merchantHeld:()=>true,persistBank:()=>persisted.push('bank')},{get:(t,k)=>k in t?t[k]:()=>undefined});
 return {state,persisted,service:createBankboiService(state,{B:{enabled:true}},ports),advance:n=>{now+=n;state.statuses.B.seenAt=now;}};
};
test('a working BankBoi whose reports repeat keeps its transaction until the roster reports it offline',async()=>{
 const f=working(),report={name:'B',items:[],gold:5,x:0,y:0,map:'bank'},since=itemsSince('B');
 for(let i=0;i<3;i++){f.service.observe(report);f.advance(1);await f.service.start().catch(()=>{});}
 assert.equal(f.state.bankboiTransaction.id,'t');assert.deepEqual(f.persisted,[]);
 f.state.lifecycle.B='offline';await f.service.start().catch(()=>{});
 assert.deepEqual(since().filter(e=>e.decision==='storage').map(e=>[e.phase,e.code]),[['ended','abandoned']]);
});
test('Steam override waits for confirmed BankBoi logout and does not restart merchant or discard pending work',async()=>{
 let done;const f=fixture(()=>new Promise(resolve=>{done=resolve;})),active=f.state.bankboiTransaction;
 const release=f.service.releaseForSteam();
 await Promise.resolve();assert.equal(f.service.busy(),true);assert.equal(f.slots[0],'B');
 await f.service.start();await f.service.restore(active);assert.equal(f.state.bankboiTransaction,active);
 done(true);await release;assert.equal(f.state.bankboiTransaction,null);assert.deepEqual(f.slots,[null]);
 assert.deepEqual(active.requestIds,['keep']);assert.equal(f.calls.some(c=>c[0]==='assign'),false);assert.equal(f.calls.includes('collect'),false);
});
test('failed offline confirmation retains ownership and stale restoration cannot touch a newer cycle',async()=>{
 const f=fixture(async()=>false),old=f.state.bankboiTransaction;await assert.rejects(f.service.releaseForSteam(),/still stopping/);
 assert.equal(f.state.bankboiTransaction,old);assert.equal(f.slots[0],'B');
 f.state.bankboiTransaction={...old,id:'new'};await f.service.restore(old);assert.equal(f.state.bankboiTransaction.id,'new');assert.equal(f.slots[0],'B');
});

// IT30: the completion receipt is saved on the
// worker's record, so a completion resent after a restart or after the transaction ended counts once.
test('a BankBoi completion resent after a restart counts once',()=>{
 const {createBankboiStorageRoutes}=require('../../runtime/items/coordinator/storage.ts');
 const saved=JSON.stringify({merchantCharacter:'M',bankboiTransaction:null,bankbois:{B:{name:'B',items:[{name:'ring'}],receipt:'B:7'}},bankboiQueue:[],commands:{},withdrawals:{},standListings:[]});
 const state=JSON.parse(saved),effects=[];
 const routes=createBankboiStorageRoutes(state,{now:()=>1,adopt:()=>{},persist:()=>effects.push('persist'),log:()=>effects.push('log')});
 const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 routes.complete({body:{character:'B',commandId:7,items:[],deposited:[{item:{name:'ring'}}]}},res);
 assert.deepEqual(res.body,{ok:true,duplicate:true});
 assert.deepEqual(state.bankbois.B.items,[{name:'ring'}]);assert.deepEqual(effects,[]);
});

// IT60: a manual compound's BankBoi copy follows its deposit to a vault, so the group's
// job survives the relocation.
test('a manual compound\'s BankBoi copy follows its deposit',()=>{
 const {createStorageReferenceUpdates}=require('../../runtime/items/coordinator/storage.ts');
 const ring={name:'ring',level:1},request={pack:'bankboi:B',slot:0,item:ring,improvement:'manual compounds'};
 const state={merchantCharacter:'M',standListings:[],npcSaleMarks:[],merchantQueue:[],upgrades:{},withdrawals:{M:[request]},
  compounds:{M:[{id:'group-1',items:[{slot:-1,item:ring,storage:{pack:'bankboi:B',slot:0}}]}]}};
 createStorageReferenceUpdates(state).deposited([{request,pack:'items2',slot:5,item:ring}]);
 assert.deepEqual(state.compounds.M[0].items[0].storage,{pack:'items2',slot:5});
 assert.deepEqual(state.withdrawals.M[0].pack,'items2');
});

// The kept bound: a BankBoi whose worker the roster still shows
// starting when bankboiStartBoundMs has passed ends its transaction, and the status owner's bound record counts the
// firing. Before the bound, the same start waits.
test('bankboiStartBoundMs: a worker that never finishes starting trips the bound and records it',async()=>{
 const {itemsSavedFields}=require('../../runtime/items/saved-fields.ts'),{boundFirings}=require('../../runtime/status/coordinator/api.ts');
 const bound=itemsSavedFields.settings.bankboiStartBoundMs.default,before=boundFirings().counts.bankboiStartBoundMs||0;let now=bound-1;
 const state={bankboiTransaction:{id:'t',bankboi:'B',mode:'store',phase:'waiting-for-bankboi',slot:1,requestIds:[],retrievals:[],startedAt:0},
  lifecycle:{B:'starting'},headlessSlots:['B'],merchantCharacter:'M',commands:{},statuses:{},withdrawals:{},bankbois:{},bankboiQueue:[]};
 // Every port the restore reaches answers nothing; the row reads only the bound's decision.
 const ports=new Proxy({now:()=>now,merchantHeld:()=>true},{get:(t,k)=>k in t?t[k]:()=>undefined});
 const service=createBankboiService(state,{B:{enabled:true}},ports);
 await service.start();
 assert.equal(boundFirings().counts.bankboiStartBoundMs||0,before);
 assert.equal(state.bankboiTransaction?.phase,'waiting-for-bankboi','before the bound the start waits for the worker');
 now=bound;await service.start().catch(()=>{});
 assert.equal(boundFirings().counts.bankboiStartBoundMs,before+1);
 const entry=boundFirings().entries.at(-1);assert.equal(entry.owner,'10');assert.equal(entry.subject,'B');assert.equal(entry.state.lifecycle,'starting');
});

// A BankBoi transaction tells `items.storage` once when it takes the merchant's slot and once when
// the merchant gets the slot back. The groups and tasks, events and roster answers are stand-in
// answers the transaction's start reads.
test("items.storage: a transaction's start and end",async()=>{
 require('../../runtime/tasks/api.ts').publishTasks({groupOf:()=>null,live:()=>null});
 require('../../runtime/events/api.ts').publishEventAnswers({deferredReturn:()=>false});
 const assigned=[];rosterFixture((slot,name)=>assigned.push([slot,name]));
 const now=100000,state={bankboiTransaction:null,merchantCharacter:'M',headlessSlots:['M'],statuses:{M:{seenAt:now}},merchantCurrent:null,
  bankbois:{B:{name:'B',items:[],state:'provisioning'}},lifecycle:{},commands:{},withdrawals:{},bankboiQueue:[],nextCommandId:1,bankSnapshot:null};
 const ports={now:()=>now,stop:async()=>{},persistRoster(){},persistBank(){},collect(){},log(){},merchantHeld:()=>false};
 const service=createBankboiService(state,{B:{enabled:true},M:{enabled:true}},ports),since=itemsSince('B');
 await service.start();
 const active=state.bankboiTransaction;
 assert.deepEqual(since().map(e=>[e.decision,e.phase,e.id]),[['storage','started',active.id]]);
 await service.restore(active);
 assert.deepEqual(since().map(e=>[e.decision,e.phase,e.code??null]),[['storage','started',null],['storage','ended','complete']]);
 assert.deepEqual(assigned,[[1,'B'],[1,'M']]);
});
