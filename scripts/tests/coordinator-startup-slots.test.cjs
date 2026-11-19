const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/coordinator-workers.cjs');
test('startup preparation clears connection before watching and then disables workers',()=>{
 const observed=[],f=fixture({blocks:{F:{connected:true,enabled:true}},watch:(_name,worker)=>observed.push({...worker})});
 f.manager.prepareSlots();assert.deepEqual(observed,[{connected:false,enabled:true}]);assert.equal(f.blocks.F.enabled,false);
});
test('restoration preserves Steam reservations, clears invalid slots and starts each worker once',()=>{
 const calls=[],f=fixture({blocks:{F:{enabled:false}},state:{headlessSlots:['Steam','Gone','F','F',null,'Primary'],nativeOwner:'Primary'},
  reserved:name=>name==='Steam',owned:name=>name!=='Gone',commit:by=>calls.push(['commit',by])});
 f.manager.restoreSlots();assert.deepEqual(f.state.headlessSlots,['Steam',null,'F','F',null,null]);assert.equal(f.workers.length,1);assert.equal(f.blocks.F.enabled,true);assert.deepEqual(calls,[['commit','start']]);
 f.manager.restoreSlots();assert.equal(f.workers.length,1);
 // A slot write commits the roster with its actor, so roster.changed names it.
 f.manager.assign(5,'F','storage');assert.deepEqual(calls.at(-1),['commit','storage']);
});
test('restoration reads ownership at invocation so a Steam handoff during the delay is respected',()=>{
 let reserved=false;const f=fixture({blocks:{F:{enabled:false}},state:{headlessSlots:['F'],nativeOwner:null},reserved:()=>reserved});
 f.manager.prepareSlots();reserved=true;f.manager.restoreSlots();assert.equal(f.workers.length,0);assert.deepEqual(f.state.headlessSlots,['F']);
});
