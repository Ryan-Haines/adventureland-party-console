const test=require('node:test'),assert=require('node:assert/strict');
const {initialCommandState}=require('../../runtime/coordinator/navigation/initial-commands.ts');
test('restart invalidates saved convoy runtime while preserving destination and epoch',()=>{
 const convoy={id:'saved',epoch:'42',phase:'travel',location:{map:'main'},departAt:1};
 const state=initialCommandState({activeConvoy:convoy,navigationEpoch:200},()=>100);
 assert.equal(state.activeConvoy.phase,'failed');assert.equal(state.activeConvoy.epoch,42);assert.equal(state.activeConvoy.failureCode,'runtime-lost');assert.equal(state.activeConvoy.failedAt,100);assert.equal(state.activeConvoy.departAt,null);assert.equal(state.activeConvoy.location,convoy.location);assert.equal(convoy.phase,'travel');assert.equal(state.navigationEpoch,200);assert.equal(state.nextCommandId,100);
});
test('fresh command state clears transient queues and uses clock fallback for absent epochs',()=>{
 const state=initialCommandState({activeConvoy:{epoch:0},navigationEpoch:'bad'},()=>100);
 assert.equal(state.activeConvoy.epoch,100);assert.equal(state.navigationEpoch,100);assert.deepEqual(state.commands,{});assert.deepEqual(state.bankQueue,[]);assert.equal(state.bankCurrent,null);assert.equal(state.thresholdRunActive,false);
 const other=initialCommandState({},()=>101);assert.equal(other.activeConvoy,null);assert.notEqual(state.commands,other.commands);assert.notEqual(state.bankQueue,other.bankQueue);
});

test('convoy restoration retains command clock allocation order',()=>{
 const calls=[],location={map:'main',x:1,y:2};let time=100;
 const convoy={id:'saved',get epoch(){calls.push('epoch');return 0;},location};
 const saved={get activeConvoy(){calls.push('convoy');return convoy;},navigationEpoch:0};
 const state=initialCommandState(saved,()=>{calls.push('clock:'+time);return time++;});
 assert.deepEqual(calls.filter(value=>value.startsWith('clock:')),['clock:100','clock:101','clock:102','clock:103']);
 assert.equal(state.activeConvoy.epoch,100);assert.equal(state.activeConvoy.failedAt,101);
 assert.equal(state.navigationEpoch,102);assert.equal(state.nextCommandId,103);assert.equal(state.activeConvoy.location,location);
});
