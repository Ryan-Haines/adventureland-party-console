const test=require('node:test'),assert=require('node:assert/strict');
const {run}=require('./helpers/coordinator-host.cjs');

// The host composes the merchant job owner's completion route with the items owner's command ids;
// the items owner's install runs the mail jobs. The key mail's check moved to the items owner's
// publication ask (coordinator-market-feeds.test.cjs), so the route takes no ALData fetch.
test('the completion route takes the items owner command ids and no ALData fetch',async()=>{
 let party,completion;
 const host=await run(undefined,{
  '../items/coordinator/api.ts':policies=>({...policies,installItems(state,ports){party=state;return policies.installItems(state,ports);}}),
  '../merchant-jobs/coordinator/api.ts':policies=>({...policies,createMerchantCompletionRoute(state,ports){completion=ports;return policies.createMerchantCompletionRoute(state,ports);}}),
 });
 assert.equal(completion.fetchAuth,undefined);
 assert.equal(completion.nextCommand(),party.nextCommandId-1,'the completion route takes 10\'s command ids');
});
