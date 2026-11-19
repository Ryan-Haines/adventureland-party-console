const test = require('node:test');
const assert = require('node:assert/strict');

test('unreachable marketplace destinations are not blacklistable offenses', () => {
  const {createMarketplaceProgressRoutes}=require('../../runtime/items/coordinator/routes/market.ts');
  for(const failureCode of ['destination_unreachable','listing_not_available','seller_not_visible','stand_not_open']) {
    const listing={key:'a',item:{name:'ring'},quantity:1,seller:'Seller',serverRegion:'US',serverIdentifier:'II'};
    const state={merchantCharacter:'M',merchantCurrent:{id:'job',reason:'ALData marketplace purchases',listings:[listing]},
      merchantQueue:[],commands:{},standBids:{}};
    const blocked=[];
    const routes=createMarketplaceProgressRoutes(state,{now:()=>1,fulfill(){},log(){},dismiss(){},persist(){},
      blacklist:(...args)=>{blocked.push(args);return {failures:1,cooldownMinutes:1,until:1000};}});
    routes.aldata({body:{jobId:'job',listingKey:'a',success:false,failureCode}},{json(){}});
    assert.equal(blocked.length,['seller_not_visible','stand_not_open'].includes(failureCode)?1:0,failureCode);
  }
});
