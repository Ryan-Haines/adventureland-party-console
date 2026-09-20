const test=require('node:test'),assert=require('node:assert/strict');
const {initialItemIntents}=require('../../runtime/coordinator/inventory/initial-intents.ts');
test('item intent initialization retains saved requests without rewriting them',()=>{
 const saved={upgrades:{F:[1]},statScrolls:{F:[2]},purchases:{F:['ring']},compounds:{M:[3]},autoCompounds:{M:[4]},autoExchanges:{leather:{}},goldTargets:{F:0}};
 const state=initialItemIntents(saved);for(const key of Object.keys(saved))assert.equal(state[key],saved[key]);
});
test('missing intent maps default independently',()=>{
 const a=initialItemIntents({}),b=initialItemIntents({});
 for(const key of Object.keys(a)){assert.deepEqual(a[key],key === "upgradeOfferingRules" ? [] : {});assert.notEqual(a[key],b[key]);}
 assert.notEqual(a.upgrades,a.compounds);
});
