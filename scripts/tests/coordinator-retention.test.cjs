// Retention of saved collections keyed by game entity ids or player names:
// docs/efficiency.md (Persistence), failure inventory P5.
const test=require('node:test'),assert=require('node:assert/strict');

// A quiet mark holds until a member observes its area again (no event says an unwatched area got
// busy), so an old mark stays with its time and the ranking reads its age; the row asserts that in
// place of the 2 min drop the mark had before.
test('a stale farm-area snapshot loses unlisted contests and the old hit filter and keeps quiet marks and live contests',()=>{
 const {pruneFarmEvidence,recordFarmEvidence}=require('../../runtime/hunting/coordinator/farm.ts');
 const now=10_000_000;
 const state={seen:{old:now-15_001},lastMoveAt:now-1,quiet:{oldArea:now-3_600_000,liveArea:now-1000},
  activity:{gone:{actor:'Stranger'},holding:{actor:'Rival'}},preferredLocation:{map:'main'}};
 pruneFarmEvidence(state);
 assert.equal('seen' in state,false);assert.equal('lastMoveAt' in state,false);
 // recordFarmEvidence keeps a contest only while a current report lists its player.
 recordFarmEvidence(state,[{seenAt:now,farmCompetition:{players:['Rival']}}],[],[],now);
 assert.deepEqual(state.quiet,{oldArea:now-3_600_000,liveArea:now-1000});
 assert.deepEqual(Object.keys(state.activity),['holding']);assert.deepEqual(state.preferredLocation,{map:'main'});
 const empty={};pruneFarmEvidence(empty);assert.deepEqual(empty,{},'a state without the maps stays as it is');
});

test('Merchant luck casts expire after the luck duration, when written and when loaded',()=>{
 const {pruneLuckCasts,mluckRemaining}=require('../../runtime/merchant-jobs/coordinator/sources.ts');
 const {initialGatheringState}=require('../../runtime/settings/coordinator/initial.ts');
 const now=10_000_000,hour=3_600_000;
 const casts={Stranger:now-hour,Friend:now-hour+1,Self:now};
 const status={name:'Friend'};
 const before=Object.fromEntries(Object.entries(casts).map(([name,at])=>[name,mluckRemaining(status,'M',at,now)]));
 pruneLuckCasts(casts,now);
 assert.deepEqual(Object.keys(casts).sort(),['Friend','Self']);
 for(const [name,remaining] of Object.entries(before))assert.equal(mluckRemaining(status,'M',casts[name],now),remaining,'same remaining time for '+name);
 const loaded=initialGatheringState({mluckCastAt:{Stranger:now-2*hour,Self:now}},()=>now);
 assert.deepEqual(Object.keys(loaded.mluckCastAt),['Self']);
});

