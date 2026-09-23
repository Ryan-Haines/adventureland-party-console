const {test}=require('node:test'),assert=require('node:assert/strict');
const {replay}=require('./helpers/dashboard-card-replay.cjs');
test('actual connected cards isolate movement and unrelated forms while keeping errors and actions current',async()=>{
 const result=await replay({steps:5});
 assert.equal(result.movement.renders.card,0);
 assert.equal(result.movement.renders.inventory,0);
 assert.ok(result.movement.renders.map>=5);
 assert.deepEqual(result.unrelated,{card:0,inventory:0,map:0,status:0});
 assert.equal(result.unrelatedCalled,'unrelated-latest');
 assert.equal(result.error,'Invalid threshold');assert.equal(result.called,'latest');
 assert.equal(result.errors.inventory,0);
 assert.equal(result.hp.card,1);assert.equal(result.hp.inventory,0);
 assert.equal(result.inventory.card,0);assert.ok(result.inventory.inventory>0);
});
