const test=require('node:test'),assert=require('node:assert/strict');
const {initialGatheringState}=require('../../runtime/coordinator/merchant/initial-gathering.ts');
test('gathering migration respects empty multi-mode selection and migrates only absent arrays',()=>{
 const modes=[];assert.equal(initialGatheringState({gatheringModes:modes,gatheringMode:'fishing'}).gatheringModes,modes);
 assert.deepEqual(initialGatheringState({gatheringMode:'mining'}).gatheringModes,['mining']);assert.deepEqual(initialGatheringState({}).gatheringModes,[]);
});
test('gathering initialization retains saved cooldowns and makes independent defaults',()=>{
 const saved={gatheringNoTool:{fishing:true},gatheringCooldowns:{fishing:100},mluckCastAt:{F:50}},state=initialGatheringState(saved);
 assert.equal(state.gatheringNoTool,saved.gatheringNoTool);assert.equal(state.gatheringCooldowns,saved.gatheringCooldowns);assert.equal(state.mluckCastAt,saved.mluckCastAt);
 const a=initialGatheringState({}),b=initialGatheringState({});assert.deepEqual(a.gatheringCooldowns,{fishing:0,mining:0});assert.notEqual(a.gatheringCooldowns,b.gatheringCooldowns);
});
