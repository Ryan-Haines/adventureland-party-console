const test=require('node:test'),assert=require('node:assert/strict');
const {initialFarmingState}=require('../../runtime/coordinator/navigation/initial-farming.ts');
test('farming initialization preserves durable Hunt and rare state without resuming scatter decisions',()=>{
 const saved={monsterHunt:{stage:'returning'},passiveRareHunts:{phoenix:true},phoenixRouteOrder:['a'],phoenixPatrolActive:1,rareHuntReturn:{id:1},farmAreaState:{F:{}},huntBlacklist:{rat:{}}};
 const state=initialFarmingState(saved,()=>123);
 for(const key of ['monsterHunt','passiveRareHunts','phoenixRouteOrder','rareHuntReturn','farmAreaState','huntBlacklist'])assert.equal(state[key],saved[key]);
 assert.equal(state.phoenixPatrolActive,true);assert.equal(state.scatterEpoch,123);assert.equal(state.partyFarmingMode,'default');assert.equal(state.monsterHunterLocation,null);assert.equal(state.scatterBreakTarget,null);assert.deepEqual(state.scatterMonsterTypes,[]);
});
test('farming defaults create independent mutable collections',()=>{
 const a=initialFarmingState({},()=>1),b=initialFarmingState({},()=>2);assert.equal(a.monsterHunt,null);assert.equal(a.rareHuntReturn,null);assert.equal(a.phoenixPatrolActive,false);
 for(const key of ['passiveRareHunts','phoenixRouteOrder','farmAreaState','huntBlacklist','scatterMonsterTypes'])assert.notEqual(a[key],b[key]);
});
