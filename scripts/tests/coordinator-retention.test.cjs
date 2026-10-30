// Retention of saved collections keyed by game entity ids or player names:
// docs/efficiency.md (Persistence), failure inventory P5.
const test=require('node:test'),assert=require('node:assert/strict');

test('a stale farm-area snapshot loses expired hits, quiet areas and activity and keeps live ones',()=>{
 const control=require('../farm-area-control.cjs');
 const now=10_000_000;
 const state={seen:{old:now-15_001,live:now-1000},quiet:{oldArea:now-control.COOLDOWN-1,liveArea:now-1000},
  activity:{expired:{hits:[now-20_000],until:now-1},holding:{hits:[now-20_000],until:now+5000},hitting:{hits:[now-500]}},
  preferredLocation:{map:'main'}};
 control.prune(state,now);
 assert.deepEqual(Object.keys(state.seen),['live']);assert.deepEqual(Object.keys(state.quiet),['liveArea']);
 assert.deepEqual(Object.keys(state.activity).sort(),['hitting','holding']);assert.deepEqual(state.preferredLocation,{map:'main'});
 const empty={};control.prune(empty,now);assert.deepEqual(empty,{},'a state without the maps stays as it is');
 // record() keeps applying the same windows while farming runs.
 const recorded={seen:{old:now-15_001}};control.record(recorded,[],[],[],now);assert.deepEqual(recorded.seen,{});
});

test('Merchant luck casts expire after the luck duration, when written and when loaded',()=>{
 const {pruneLuckCasts,mluckRemaining}=require('../../runtime/coordinator/merchant/luck.ts');
 const {initialGatheringState}=require('../../runtime/coordinator/merchant/initial-gathering.ts');
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

test('rare pursuit progress keeps the newest entries up to the limit, when written and when loaded',()=>{
 const {RARE_RECORD_LIMIT,keepNewestRare}=require('../../runtime/coordinator/navigation/rare-retention.ts');
 const {initialFarmingState}=require('../../runtime/coordinator/navigation/initial-farming.ts');
 assert.ok(RARE_RECORD_LIMIT>=25,'more than the 25 a live console collected in 13 days');
 const progress=Object.fromEntries(Array.from({length:RARE_RECORD_LIMIT+5},(_,i)=>['m'+i,{start:i,progress:1000+i,lowHp:1}]));
 keepNewestRare(progress,entry=>entry.progress);
 assert.equal(Object.keys(progress).length,RARE_RECORD_LIMIT);
 assert.equal(progress.m0,undefined);assert.ok(progress['m'+(RARE_RECORD_LIMIT+4)],'the newest stays');
 const saved=Object.fromEntries(Array.from({length:RARE_RECORD_LIMIT+1},(_,i)=>['m'+i,{start:i,progress:i,lowHp:1}]));
 const loaded=initialFarmingState({rarePursuitProgress:saved},()=>0);
 assert.equal(Object.keys(loaded.rarePursuitProgress).length,RARE_RECORD_LIMIT);assert.equal(loaded.rarePursuitProgress.m0,undefined);
 assert.equal(initialFarmingState({},()=>0).rarePursuitProgress,undefined,'absent stays absent');
});

test('rare retry evidence keeps the newest rejections up to the limit',()=>{
 const {RARE_RECORD_LIMIT}=require('../../runtime/coordinator/navigation/rare-retention.ts');
 const {createRareRetryEvidence}=require('../../runtime/coordinator/navigation/rare-retry-evidence.ts');
 const sight=(id,seenAt)=>({id,mtype:'phoenix',map:'main',x:0,y:0,hp:100,target:null,realm:'US',in:'main',seenAt,reporter:'F',visible:true,partyEngaged:false,reachable:false});
 const saved=Object.fromEntries(Array.from({length:RARE_RECORD_LIMIT+3},(_,i)=>['r'+i,{sight:sight('r'+i,i),origin:{map:'main',x:0,y:0}}]));
 const evidence=createRareRetryEvidence(saved);
 assert.equal(Object.keys(saved).length,RARE_RECORD_LIMIT,'loaded evidence is capped');
 assert.equal(saved.r0,undefined);assert.equal(evidence.eligible('r0',sight('r0',0),{map:'main'}),true,'a dropped rejection is no longer remembered');
 assert.equal(evidence.eligible('r'+(RARE_RECORD_LIMIT+2),sight('x',0),{map:'main'}),false,'a kept rejection still holds');
 evidence.reject('new',sight('new',10_000),{map:'main',x:1,y:1});
 assert.equal(Object.keys(saved).length,RARE_RECORD_LIMIT);assert.ok(saved.new);
 assert.equal(evidence.eligible('new',sight('new',9_000),{map:'main'}),false);
});
