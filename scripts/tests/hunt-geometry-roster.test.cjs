const test=require('node:test'),assert=require('node:assert/strict');
const {reconcileCurrentHuntParty}=require('../../runtime/coordinator/hunt/current-party.ts');
for(const phase of ['waiting','failed'])test('Hunt retains its reloading member during geometry '+phase,()=>{
 const hunt={participants:['W','M'],owner:'W',missions:[],stage:'returning'};
 const state={leader:'W',followers:{M:true},commands:{},statuses:{W:{seenAt:20000,ctype:'warrior',server:'USII'},M:{seenAt:1000,ctype:'mage',server:'USII'}},
 activeConvoy:{geometryRepair:{phase},failureCode:phase==='failed'?'geometry-mismatch':undefined}};
 assert.equal(reconcileCurrentHuntParty(hunt,state,20000,()=>assert.fail('must retain repair')),false);
 assert.deepEqual(hunt.participants,['W','M']);
});
