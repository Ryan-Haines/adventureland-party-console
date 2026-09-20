const test = require('node:test');
const assert = require('node:assert/strict');
const { compoundPassCost } = require('../../.build/shared/compound-cost.cjs');
const prices = [6400,240000,9200000,1840000000].map((cost,i)=>({id:'cscroll'+i,cost}));
test('one +2 item needs four successful combines, including its three +1 ingredients',()=>{
  assert.deepEqual(compoundPassCost([3,5,6,7],2,prices),{gold:25600,scrolls:4});
});
test('scroll grade changes at the source level threshold',()=>{
  assert.deepEqual(compoundPassCost([3,5,6,7],4,prices),{gold:39*6400+240000,scrolls:40});
  assert.deepEqual(compoundPassCost([4,5,6,7],4,prices),{gold:40*6400,scrolls:40});
});
test('high-grade items start at the correct scroll and missing prices are not zero',()=>{
  assert.deepEqual(compoundPassCost([0,0,6,7],1,prices),{gold:9200000,scrolls:1});
  assert.equal(compoundPassCost([0,0,6,7],1,prices.slice(0,2)),null);
});
