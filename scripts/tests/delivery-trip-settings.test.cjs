const {test}=require('node:test'),assert=require('node:assert/strict');
const {settingsWriter,merchantViewNames}=require('./helpers/settings-writer.cjs');
const {initialMerchantSales}=require('../../runtime/settings/coordinator/initial.ts');
const {defaultMerchantRoutinePriorities,defaultMerchantAutomations}=require('../../runtime/merchant-jobs/rules.ts');
const {createRoutinePriorityRoute}=require('../../runtime/merchant-jobs/coordinator/routes.ts');

test('delivery scheduling defaults on at priority 90 and preserves saved false and priority zero',()=>{
 const fresh=initialMerchantSales({},()=>1);
 assert.equal(fresh.merchantAutomations.deliveries,true);assert.equal(fresh.merchantRoutinePriorities.deliveries,90);
 const restored=initialMerchantSales({merchantAutomations:{deliveries:false},merchantRoutinePriorities:{deliveries:0}},()=>1);
 assert.equal(restored.merchantAutomations.deliveries,false);assert.equal(restored.merchantRoutinePriorities.deliveries,0);
});

test('settings remove only waiting delivery jobs, retain active trips and marks, and persist re-enabling',()=>{
 const mark={id:'d',item:{name:'sword'}},active={id:'active',reason:'deliveries',target:'P'};
 const state={priorities:{deliveries:90},automations:{deliveries:true},queue:[{id:'d',reason:'deliveries',target:'P'},...['manual visit','party collection','restock'].map(reason=>({id:reason,reason,target:'P',manual:true}))],merchantCurrent:active,merchantDeliveries:{P:[mark]}};
 let saved,dispatches=0;
 const route=createRoutinePriorityRoute(state,{priorities:defaultMerchantRoutinePriorities(),automations:defaultMerchantAutomations(),stamp:j=>j,persist:()=>{saved=JSON.parse(JSON.stringify(state));},dispatch:()=>dispatches++,
  write:settingsWriter(state,{names:merchantViewNames}).write});
 const send=enabled=>{const res={status(){return this},json(value){this.body=value}};route({body:{priorities:{},enabled:{deliveries:enabled}}},res);assert.equal(res.body.ok,true);};
 send(false);assert.deepEqual(state.queue.map(j=>j.reason),['manual visit','party collection','restock']);
 assert.equal(state.merchantCurrent,active);assert.deepEqual(state.merchantDeliveries.P,[mark]);assert.equal(saved.automations.deliveries,false);
 send(true);assert.equal(saved.automations.deliveries,true);assert.equal(dispatches,2);
});
