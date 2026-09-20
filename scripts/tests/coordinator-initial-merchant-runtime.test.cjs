const test=require('node:test'),assert=require('node:assert/strict');
const {initialMerchantRuntime}=require('../../runtime/coordinator/merchant/initial-runtime.ts');
test('merchant startup preserves saved work and strict force-stand flag',()=>{
 const saved={merchantCharacter:'M',merchantForceStand:true,merchantWeapon:{name:'rod'},merchantQueue:[{id:1}],merchantCurrent:{id:2},merchantCargo:{bank:[1],gold:5}};
 const state=initialMerchantRuntime(saved);for(const key of Object.keys(saved))assert.equal(state[key],saved[key]);
 assert.equal(initialMerchantRuntime({merchantForceStand:'true'}).merchantForceStand,false);
});
test('merchant startup defaults invalid queues and creates fresh empty cargo',()=>{
 const a=initialMerchantRuntime({merchantCharacter:'',merchantQueue:{}}),b=initialMerchantRuntime({});
 assert.equal(a.merchantCharacter,'GoldMajesty');assert.deepEqual(a.merchantQueue,[]);assert.equal(a.merchantCurrent,null);assert.equal(a.merchantWeapon,null);assert.deepEqual(a.merchantCargo,{bank:[],gold:0});assert.notEqual(a.merchantCargo,b.merchantCargo);
});
