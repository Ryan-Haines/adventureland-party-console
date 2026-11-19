const test=require('node:test');const assert=require('node:assert/strict');
const {createFarmingIntents}=require('../../runtime/hunting/coordinator/farm.ts');

// Observed on the live console 2026-11-18: a Follow mark left on a character that was not logged in
// kept it in the party, and the escape and the death recovery waited for it to report.
test('the party is the leader and its online followers, never the merchant', ()=>{
 const online=new Set(['L','F','M']);
 const state={leader:'L',merchantCharacter:'M',followers:{F:true,Off:true,No:false,M:true},characterLocations:{},navigationIntents:{}};
 const intents=createFarmingIntents(state,{now:()=>0,names:()=>['L','F','Off','No','M'],online:n=>online.has(n),
  cancelConvoy(){},startConvoy:()=>true,events:()=>({forget(){},retarget(){}}),persist(){}});
 assert.deepEqual(intents.members(),['L','F']);
 online.add('Off');
 assert.deepEqual(intents.members(),['L','F','Off'],'a follower that logs in joins');
 online.delete('L');
 assert.ok(intents.members().includes('L'),'the leader stays the party\'s anchor');
});
