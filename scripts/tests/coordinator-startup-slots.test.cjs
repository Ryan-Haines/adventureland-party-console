const test=require('node:test'),assert=require('node:assert/strict');
const {createStartupSlots}=require('../../runtime/coordinator/characters/startup-slots.ts');
test('startup preparation clears connection before watching and then disables workers',()=>{
 const workers={F:{connected:true,enabled:true}},observed=[];
 const service=createStartupSlots(workers,{headlessSlots:[],nativeOwner:null},{watch:(_name,worker)=>observed.push({...worker})});
 service.prepare();assert.deepEqual(observed,[{connected:false,enabled:true}]);assert.equal(workers.F.enabled,false);
});
test('restoration preserves Steam reservations, clears invalid slots and starts each worker once',()=>{
 const state={headlessSlots:['Steam','Gone','F','F',null,'Primary'],nativeOwner:'Primary'},workers={F:{enabled:false}},calls=[];
 const service=createStartupSlots(workers,state,{reserved:name=>name==='Steam',owned:name=>name!=='Gone',ensure:name=>{calls.push(['ensure',name]);return workers[name];},start:name=>calls.push(['start',name]),persist:()=>calls.push(['persist'])});
 service.restore();assert.deepEqual(state.headlessSlots,['Steam',null,'F','F',null,null]);assert.equal(calls.filter(x=>x[0]==='start').length,1);assert.equal(workers.F.enabled,true);assert.deepEqual(calls.at(-1),['persist']);
 service.restore();assert.equal(calls.filter(x=>x[0]==='start').length,1);
});
test('restoration reads ownership at invocation so a Steam handoff during the delay is respected',()=>{
 const state={headlessSlots:['F'],nativeOwner:null},workers={F:{enabled:false}};let reserved=false,started=0;
 const service=createStartupSlots(workers,state,{watch(){},reserved:()=>reserved,owned:()=>true,ensure:()=>workers.F,start:()=>started++,persist(){}});
 service.prepare();reserved=true;service.restore();assert.equal(started,0);assert.deepEqual(state.headlessSlots,['F']);
});
