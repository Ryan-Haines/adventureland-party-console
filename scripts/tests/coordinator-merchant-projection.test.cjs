const test=require('node:test'),assert=require('node:assert/strict');
const {projectMerchantJob,projectBankbois}=require('../../runtime/coordinator/telemetry/merchant-projection.ts');
test('public jobs redact credentials and explain collection thresholds without mutating intent',()=>{
 const job={reason:'marked items',target:'F',aldataKey:'secret'},ports={stamp:job=>({...job,priority:90}),slots:()=>2,threshold:()=>5,nearby:()=>true};
 const view=projectMerchantJob(job,ports);assert.equal(view.aldataKey,undefined);assert.equal(job.aldataKey,'secret');assert.equal(view.collectionLabel,'nearby collection');assert.equal(view.collectionSlots,2);assert.equal(view.collectionNearby,true);assert.equal(view.priority,90);
 ports.slots=()=>5;assert.equal(projectMerchantJob(job,ports).collectionLabel,'marked items');ports.threshold=()=>0;assert.equal(projectMerchantJob(job,ports).collectionThreshold,1);
 assert.equal(projectMerchantJob({reason:'exchange',aldataKey:'secret'},ports).collectionSlots,undefined);assert.equal(projectMerchantJob(null,ports),null);
});
test('BankBoi views sort names and expose only the matching transaction phase and mode',()=>{
 const items=[{slot:1}],bankbois={Z:{name:'Z',items},A:{name:'A',items:'invalid'}},transaction={bankboi:'Z',phase:'withdraw',mode:'fetch',private:'internal'};
 const view=projectBankbois(bankbois,transaction);assert.deepEqual(view.map(x=>x.name),['A','Z']);assert.deepEqual(view[0].items,[]);assert.equal(view[1].items,items);assert.equal(view[0].transaction,null);assert.deepEqual(view[1].transaction,{phase:'withdraw',mode:'fetch'});assert.equal(bankbois.Z.transaction,undefined);
});

test('offline storage characters expose current account class and level without altering storage state',()=>{
 const stored={B:{name:'B',state:'offline'}};let character={type:'merchant',level:23,private:'hidden'};
 const read=()=>projectBankbois(stored,null,()=>character)[0];
 assert.equal(read().ctype,'merchant');assert.equal(read().level,23);assert.equal(read().private,undefined);
 character={type:'merchant',level:24};assert.equal(read().level,24);assert.equal(stored.B.level,undefined);
});
