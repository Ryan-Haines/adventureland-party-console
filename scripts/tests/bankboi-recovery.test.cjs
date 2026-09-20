const test=require('node:test'),assert=require('node:assert/strict');
const {createBankboiService}=require('../../runtime/coordinator/inventory/bankboi-service.ts');
function fixture(){
 let now=200000;const state={transaction:{id:'t',bankboi:'B',mode:'store',phase:'processing',slot:1,requestIds:['keep'],retrievals:[],startedAt:1}};
 const slots=['B'],calls=[],status={seenAt:now,banking:false};
 const ports={now:()=>now,merchant:()=> 'M',plan:()=>null,merchantStatus:()=>undefined,merchantBusy:()=>false,slots:()=>slots,
  clearSlot:i=>{slots[i]=null;},assignSlot:(i,n)=>{calls.push(['assign',n]);slots[i-1]=n;},stop:async n=>calls.push(['stop',n]),
  persistRoster(){},persistBank(){},hasNormalWithdrawals:()=>true,collectWithdrawals:()=>calls.push('collect'),log(){},
  workerStatus:()=>status,interrupted:n=>calls.push(['retry',n]),clearCommand:n=>calls.push(['clear',n])};
 return {state,slots,calls,status,ports,service:createBankboiService(state,ports),advance:n=>{now+=n;}};
}
test('an idle abandoned transaction is stopped once, releases the latch and restores merchant',async()=>{
 const f=fixture();await Promise.all([f.service.start(),f.service.start()]);
 assert.equal(f.state.transaction,null);assert.deepEqual(f.slots,['M']);assert.equal(f.service.busy(),false);
 assert.equal(f.calls.filter(c=>c[0]==='stop').length,1);assert.ok(f.calls.includes('collect'));
});
test('a fresh banking report protects an active cycle until its bounded deadline',async()=>{
 const f=fixture();f.status.banking=true;await f.service.start();assert.ok(f.state.transaction);assert.deepEqual(f.calls,[]);
 f.advance(600000);await f.service.start();assert.equal(f.state.transaction,null);
});
test('Steam override waits for confirmed BankBoi logout and does not restart merchant or discard pending work',async()=>{
 const f=fixture(),active=f.state.transaction;let done;
 const release=f.service.releaseForSteam(()=>new Promise(resolve=>{done=resolve;}));
 await Promise.resolve();assert.equal(f.service.busy(),true);assert.equal(f.slots[0],'B');
 await f.service.start();await f.service.restore(active);assert.equal(f.state.transaction,active);
 done(true);await release;assert.equal(f.state.transaction,null);assert.deepEqual(f.slots,[null]);
 assert.deepEqual(active.requestIds,['keep']);assert.equal(f.calls.some(c=>c[0]==='assign'),false);assert.equal(f.calls.includes('collect'),false);
});
test('failed offline confirmation retains ownership and stale restoration cannot touch a newer cycle',async()=>{
 const f=fixture(),old=f.state.transaction;await assert.rejects(f.service.releaseForSteam(async()=>false),/still stopping/);
 assert.equal(f.state.transaction,old);assert.equal(f.slots[0],'B');
 f.state.transaction={...old,id:'new'};await f.service.restore(old);assert.equal(f.state.transaction.id,'new');assert.equal(f.slots[0],'B');
});
