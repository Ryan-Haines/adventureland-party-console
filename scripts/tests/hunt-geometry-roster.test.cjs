const test=require('node:test'),assert=require('node:assert/strict');
const {reconcileCurrentHuntParty}=require('../../runtime/hunting/coordinator/hunt.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const retainsMember=({hunt,state})=>{
 assert.equal(reconcileCurrentHuntParty(hunt,state,20000,()=>assert.fail('must retain repair')),false);
 assert.deepEqual(hunt.participants,['W','M']);
};
scenarioTable('a Hunt with a stale member under a geometry repair keeps that member',phase=>{
 const hunt={participants:['W','M'],owner:'W',missions:[],stage:'returning'};
 const state={leader:'W',followers:{M:true},commands:{},statuses:{W:{seenAt:20000,ctype:'warrior',server:'USII'},M:{seenAt:1000,ctype:'mage',server:'USII'}},
 activeConvoy:{geometryRepair:{phase},failureCode:phase==='failed'?'geometry-mismatch':undefined}};
 return {hunt,state};
},[
 ['Hunt retains its reloading member during geometry waiting',retainsMember,'waiting'],
 ['Hunt retains its reloading member during geometry failed',retainsMember,'failed'],
]);
