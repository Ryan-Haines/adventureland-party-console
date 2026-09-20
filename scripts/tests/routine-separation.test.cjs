const test = require('node:test'), assert = require('node:assert/strict');
const {routineFor,migrateRoutinePriorities,splitLegacyWork,routineEnabled}=require('../../runtime/coordinator/merchant/routines.ts');
const {merchantJobPriority}=require('../../runtime/coordinator/merchant/priority.ts');
const {scopeWork}=require('../../runtime/coordinator/merchant/command-scope.ts');
const {batchMarketplaceVisits}=require('../../runtime/coordinator/merchant/marketplace-batch.ts');
const {createAutomaticMerchantSales}=require('../../runtime/coordinator/merchant/automatic-sales.ts');

test('automatic upgrades have independent priorities and carry no manual or stat-scroll work',()=>{
 const saved=migrateRoutinePriorities({'manual upgrades':91});
 assert.equal(saved['auto upgrade'],91);
 assert.equal(migrateRoutinePriorities({'manual upgrades':91,'auto upgrade':0})['auto upgrade'],0);
 const policy={routines:{...saved,'auto upgrade':42},bids:{},completesStorageHandoff:()=>false};
 assert.equal(merchantJobPriority({reason:'auto upgrade'},policy),42);
 assert.equal(merchantJobPriority({reason:'manual upgrades'},policy),91);
 assert.equal(routineEnabled({reason:'auto upgrade'},{'auto upgrade':false}),false);
 assert.equal(routineEnabled({reason:'manual upgrades'},{'auto upgrade':false}),true);
 const data={upgrades:[{id:'manual'},{id:'hat',auto:true}],statScrolls:[1],preloadStatScrolls:[2],bankUpgradeRules:[3]};
 const automatic=scopeWork({reason:'auto upgrade'},data),manual=scopeWork({reason:'manual upgrades'},data);
 assert.deepEqual(automatic.upgrades,[{id:'hat',auto:true}]);assert.deepEqual(automatic.statScrolls,[]);assert.deepEqual(automatic.preloadStatScrolls,[]);assert.deepEqual(automatic.bankUpgradeRules,[3]);
 assert.deepEqual(manual.upgrades,[{id:'manual'}]);assert.deepEqual(manual.statScrolls,[1]);assert.deepEqual(manual.bankUpgradeRules,[]);
});
test('marketplace priority follows intent across every executor; manual matching orders ignore WTB priority',()=>{
 const policy={routines:{'manual marketplace purchases':88,'stand bid purchases':22},bids:{cap:{priorityOverride:99}},completesStorageHandoff:()=>false};
 for(const reason of ['stand purchases','ALData marketplace purchases','Ponty purchases']){
  assert.equal(merchantJobPriority({reason,manual:true,bidItemId:'cap'},policy),88);
  assert.equal(merchantJobPriority({reason,bidItemId:'cap'},policy),99);
  assert.equal(routineEnabled({reason,manual:true},{'stand bid purchases':false}),true);
 }
 assert.equal(routineFor({reason:'stand search'}),'manual marketplace purchases');
 assert.equal(routineEnabled({reason:'marked items'},{'party collection':false}),false);
});
test('migration retains zeroes and explicit new values; split legacy work keeps allocations with crafting',()=>{
 const p=migrateRoutinePriorities({'upgrades and compounds':0,'merchant commerce':34,'npc sales':12,'manual compounds':80});
 assert.equal(p['manual upgrades'],0);assert.equal(p['manual compounds'],80);assert.equal(p['manual buying'],34);assert.equal(p['manual crafting'],34);assert.equal(p['auto npc sales'],12);
 const storage=[{allocationId:'s',pack:'bankboi:B'}];
 const jobs=splitLegacyWork({id:'a',reason:'merchant commerce',blockedOnBankboi:true,order:{buys:[{id:'pot'}],crafts:[{id:'coat'}],storage}});
 assert.equal(jobs.length,2);assert.equal(jobs[0].order.storage,storage);assert.deepEqual(jobs[0].order.buys,[]);assert.deepEqual(jobs[1].order.storage,[]);assert.equal(jobs[1].blockedOnBankboi,false);
 assert.deepEqual(splitLegacyWork({id:'a',reason:'upgrades and compounds'}).map(j=>j.reason),['manual upgrades','manual compounds']);
});
test('commands isolate upgrades, compounds, automatic compounds, and NPC sale provenance',()=>{
 const data={upgrades:[1],compounds:[2],autoCompounds:[3],statScrolls:[4],purchases:[5],npcSales:[{id:'manual'},{id:'auto',auto:true}]};
 const u=scopeWork({reason:'manual upgrades'},data);assert.deepEqual(u.upgrades,[1]);assert.deepEqual(u.statScrolls,[4]);assert.deepEqual(u.compounds,[]);assert.deepEqual(u.npcSales,[]);
 const c=scopeWork({reason:'manual compounds'},data);assert.deepEqual(c.compounds,[2]);assert.deepEqual(c.upgrades,[]);assert.deepEqual(c.autoCompounds,[]);
 assert.deepEqual(scopeWork({reason:'npc sales'},data).npcSales,[{id:'manual'}]);
 assert.deepEqual(scopeWork({reason:'auto npc sales'},data).npcSales,[{id:'auto',auto:true}]);
 assert.deepEqual(data.upgrades,[1]);
});
test('marketplace batching cannot pull automatic work into a manual itinerary',()=>{
 const listing={key:'one',seller:'S',serverRegion:'US',serverIdentifier:'II'};
 const manual={reason:'ALData marketplace purchases',manual:true,listings:[listing]};
 const auto={reason:manual.reason,bidItemId:'cap',listings:[{...listing,key:'two'}]};
 const result=batchMarketplaceVisits(manual,[auto]);assert.equal(result.queue[0],auto);assert.equal(manual.listings.length,1);
});
test('disabled automatic NPC sales preserve rules and marks while manual work remains runnable',()=>{
 const state={merchantCharacter:'M',merchantAutomations:{'auto npc sales':false},autoNpcSales:{cap:true},autoStandMarks:{},npcSaleMarks:[{id:'a',auto:true,source:'merchant',slot:0,item:{name:'cap'},quantity:1},{id:'m',source:'merchant',slot:1,item:{name:'coat'},quantity:1}],standListings:[],merchantQueue:[]};
 const calls=[];const service=createAutomaticMerchantSales(state,{now:()=>1,nextCommand:()=>1,queue:(names,reason)=>calls.push(reason),publish(){},syncStand:()=>true,idle(){},persist(){}});
 service.reconcile({name:'M',items:[{slot:0,item:{name:'cap'}},{slot:1,item:{name:'coat'}}]});
 assert.deepEqual(calls,['npc sales']);assert.equal(state.npcSaleMarks.length,2);assert.equal(state.autoNpcSales.cap,true);
});
