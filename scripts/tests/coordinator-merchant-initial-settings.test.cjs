const test=require('node:test'),assert=require('node:assert/strict');
const {initialMerchantSales}=require('../../runtime/settings/coordinator/initial.ts');
const {defaultMerchantRoutinePriorities,defaultMerchantAutomations}=require('../../runtime/merchant-jobs/rules.ts');
test('listing migration fills missing metadata without mutating original records',()=>{
 const listings=[{item:{name:'ring'}},{id:'saved',state:'live',queuedAt:9},{id:'zero',queuedAt:0}];
 const result=initialMerchantSales({standListings:listings},()=>100);
 assert.deepEqual(result.standListings[0],{item:{name:'ring'},id:'stand-migrated-100-0',state:'configured',queuedAt:100});
 assert.deepEqual(result.standListings[1],listings[1]);assert.equal(result.standListings[2].queuedAt,102);assert.equal(listings[0].id,undefined);
});
test('saved disabled automations and zero priorities override defaults',()=>{
 // #116 (docs/testing-npc-sale-reserve.md) loads a legacy sale rule with keep 0 and keeps a saved
 // reserve, so the load copies each rule and never hands the saved map back.
 const marks=[],rules={ring:{item:{name:'ring'},createdAt:5},wand:{item:{name:'wand'},createdAt:6,keep:3}};const result=initialMerchantSales({npcSaleMarks:marks,autoNpcSales:rules,merchantRoutinePriorities:{'merchant luck':0},merchantAutomations:{exchange:false}},()=>1);
 assert.equal(result.npcSaleMarks,marks);assert.deepEqual(result.autoNpcSales,{ring:{item:{name:'ring'},createdAt:5,keep:0},wand:{item:{name:'wand'},createdAt:6,keep:3}});assert.equal(rules.ring.keep,undefined);assert.equal(result.merchantRoutinePriorities['merchant luck'],0);assert.equal(result.merchantAutomations['automatic exchange'],false);assert.equal(result.merchantAutomations.exchange,undefined);assert.equal(result.merchantAutomations['manual exchange'],undefined);assert.equal(result.merchantRoutinePriorities['party collection'],90);
 assert.deepEqual(initialMerchantSales({npcSaleMarks:{}},()=>1).npcSaleMarks,[]);
});
