const test=require('node:test'),assert=require('node:assert/strict');
const {initialFarmingSelections}=require('../../runtime/coordinator/navigation/initial-focus.ts');
test('focus initialization preserves selection precedence and legacy defaults',()=>{
 const empty=[];assert.equal(initialFarmingSelections({monsterFocus:['bat']},{monsterFocus:empty}).monsterFocus,empty);
 assert.deepEqual(initialFarmingSelections({monsterFocus:'bat'},{}).monsterFocus,['bat']);assert.deepEqual(initialFarmingSelections({},{}).monsterFocus,['goo']);
 assert.deepEqual(initialFarmingSelections({monsterFocus:[]},{monsterFocus:'ignored'}).monsterFocus,[]);
});
test('per-character selection maps and valid farming modes remain unchanged',()=>{
 const map={},old={F:3};const state=initialFarmingSelections({monsterFocusByCharacter:old,monsterPrioritiesByCharacter:old,monsterSearchRadiusByCharacter:old},{monsterFocusByCharacter:map});
 assert.equal(state.monsterFocusByCharacter,map);assert.equal(state.monsterPrioritiesByCharacter,old);assert.equal(state.monsterSearchRadiusByCharacter,old);
 for(const farmingPolicy of ['auto','default','scatter','hunt'])assert.equal(initialFarmingSelections({farmingPolicy},{}).farmingPolicy,farmingPolicy);
 assert.equal(initialFarmingSelections({farmingPolicy:'invalid'},{}).farmingPolicy,'auto');
});
