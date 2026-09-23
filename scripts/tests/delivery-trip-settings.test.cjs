const {test}=require('node:test'),assert=require('node:assert/strict');
const {initialMerchantSales,defaultMerchantRoutinePriorities,defaultMerchantAutomations}=require('../../runtime/coordinator/merchant/initial-settings.ts');
const {createRoutinePriorityRoute}=require('../../runtime/coordinator/http/routine-priorities.ts');
const {createMerchantControlRoutes}=require('../../runtime/coordinator/http/merchant-control.ts');

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
 const route=createRoutinePriorityRoute(state,{priorities:defaultMerchantRoutinePriorities(),automations:defaultMerchantAutomations(),stamp:j=>j,persist:()=>{saved=JSON.parse(JSON.stringify(state));},dispatch:()=>dispatches++});
 const send=enabled=>{const res={status(){return this},json(value){this.body=value}};route({body:{priorities:{},enabled:{deliveries:enabled}}},res);assert.equal(res.body.ok,true);};
 send(false);assert.deepEqual(state.queue.map(j=>j.reason),['manual visit','party collection','restock']);
 assert.equal(state.merchantCurrent,active);assert.deepEqual(state.merchantDeliveries.P,[mark]);assert.equal(saved.automations.deliveries,false);
 send(true);assert.equal(saved.automations.deliveries,true);assert.equal(dispatches,2);
});

test('cancelling a delivery job disables automatic trips without deleting marks',()=>{
 const mark={id:'d',item:{name:'ring'}},state={merchantQueue:[{id:'j',target:'P',reason:'deliveries'}],merchantAutomations:{deliveries:true},merchantDeliveries:{P:[mark]}};
 const routes=createMerchantControlRoutes(state,{automated:reason=>reason in defaultMerchantAutomations(),persist(){},log(){}});
 const res={json(body){this.body=body}};routes.cancel({body:{id:'j'}},res);
 assert.equal(res.body.ok,true);assert.equal(state.merchantAutomations.deliveries,false);assert.deepEqual(state.merchantDeliveries.P,[mark]);
});
