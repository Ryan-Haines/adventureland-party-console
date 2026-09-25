const test=require('node:test'),assert=require('node:assert/strict');
const {createMerchantHandoffRoutes}=require('../../runtime/coordinator/http/merchant-handoff.ts');
const {createMerchantProgressRoutes}=require('../../runtime/coordinator/http/merchant-progress.ts');
function fixture(){
 const state={merchantCharacter:'M',merchantCurrent:{id:'job',target:'F',reason:'upgrades and compounds',priority:5,phase:'assigned'},merchantQueue:[],commands:{},statuses:{F:{map:'main'}},
  marked:{},merchantMarked:{},autoItemMarks:{},upgrades:{},compounds:{},statScrolls:{},autoCompounds:{},goldTargets:{F:1000},threshold:500,gatheringModes:[],gatheringCooldowns:{}};
 const calls=[],ports={now:()=>100,nextCommand:()=>7,persist:()=>calls.push('persist'),owned:()=>true,queue:(...args)=>calls.push(args),log(){},
  priority:job=>job.priority,routinePriority:()=>9,stamp:job=>job,dispatch:()=>calls.push('dispatch')};
 const routes={...createMerchantHandoffRoutes(state,ports),...createMerchantProgressRoutes(state,ports)};
 function send(route,body={},params={},query={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body,params,query},res);return res;}
 return {state,calls,send};
}
test('handoff respects protected Hunt travel and preserves newer commands on old acknowledgements',()=>{
 const t=fixture();t.state.activeConvoy={nonPreemptible:true,participants:['F']};assert.equal(t.send('handoff',{jobId:'job',target:'F'}).body.waiting,true);assert.equal(t.state.commands.F,undefined);
 t.state.activeConvoy=null;t.send('handoff',{jobId:'job',target:'F',capacity:2});assert.equal(t.state.commands.F.capacity,2);assert.equal(t.state.commands.F.goldTarget,1000);
 t.send('complete',{jobId:'job',character:'F',commandId:6});assert.equal(t.state.commands.F.id,7);
 t.send('complete',{jobId:'job',character:'F',commandId:7});assert.equal(t.state.commands.F,undefined);assert.equal(t.state.merchantCurrent.phase,'processing');
});
test('commerce handoff requires a reserved source and records delivered material without clearing another command',()=>{
 const t=fixture();Object.assign(t.state.merchantCurrent,{reason:'merchant commerce',order:{sources:{F:[{slot:2}]}}});
 assert.equal(t.send('order',{jobId:'job',target:'X'}).code,409);t.send('order',{jobId:'job',target:'F'});assert.deepEqual(t.state.commands.F.items,[{slot:2}]);
 t.state.commands.F={id:8,type:'travel'};t.send('orderComplete',{jobId:'job',character:'F',sent:[{slot:2}]});assert.equal(t.state.commands.F.id,8);assert.equal(t.state.merchantCurrent.orderHandoff.sent.length,1);
});
test('merchant heartbeat clamps future progress and batch status picks only the same collection batch',()=>{
 const t=fixture();t.send('heartbeat',{jobId:'job',progressAt:200});assert.equal(t.state.merchantCurrent.progressAt,100);assert.equal(t.state.merchantCurrent.phase,'processing');assert.equal(t.calls.length,0);
 t.state.merchantCurrent.batchId='b';t.state.merchantQueue=[{target:'X',batchId:'other'},{target:'L',batchId:'b'}];
 assert.equal(t.send('job',{}, {id:'job'}).body.nextCollectionTarget,'L');assert.equal(t.send('job',{}, {id:'stale'}).code,404);
});
test('checkpoint preserves current work on equal priority and yields durable resume state to higher-priority gathering',()=>{
 const t=fixture();t.state.merchantQueue=[{id:'next',priority:5}];assert.equal(t.send('checkpoint',{jobId:'job',state:{step:2}}).body.yield,false);
 t.state.gatheringModes=['fishing'];t.state.commands.M={id:7};const res=t.send('checkpoint',{jobId:'job',state:{step:3}});
 assert.equal(res.body.yield,true);assert.equal(t.state.merchantCurrent,null);assert.equal(t.state.commands.M,undefined);assert.equal(t.state.merchantQueue.at(-1).resumeState.step,3);
 assert.equal(t.state.merchantQueue.at(-1).phase,undefined);assert.equal(t.calls.at(-1),'dispatch');
});


test('cleared marks stop the next protected action without removing the active operation',()=>{
 const t=fixture();t.state.merchantCurrent.itemMarksCleared=true;
 const response=t.send('checkpoint',{jobId:'job',protectionOnly:true});
 assert.equal(response.code,409);assert.match(response.body.error,/Item marks cleared/);assert.equal(t.state.merchantCurrent.id,'job');
});

test('merchant activity accepts known stages only for merchant-owned work',()=>{
 const f=fixture();f.state.merchantCurrent.target='M';
 f.send('heartbeat',{jobId:'job',operationStage:'retrieving'});assert.equal(f.state.merchantCurrent.operationStage,'retrieving');
 f.send('heartbeat',{jobId:'job',operationStage:'invented'});assert.equal(f.state.merchantCurrent.operationStage,'retrieving');
 f.send('heartbeat',{jobId:'job',operationStage:'processing'});assert.equal(f.state.merchantCurrent.operationStage,'processing');
 f.state.merchantCurrent.target='F';f.send('heartbeat',{jobId:'job',operationStage:'storing'});assert.equal(f.state.merchantCurrent.operationStage,'processing');
});


test('event checkpoint preserves job identity and resume data and rejects duplicate yields',()=>{
 const f=fixture();f.state.eventSelectionsByCharacter={M:['snowman']};f.state.statuses.M={seenAt:100,merchantEventReserved:true};
 Object.assign(f.state.merchantCurrent,{resumeState:{step:4},completedListingKeys:['receipt'],commandId:7});
 f.state.commands.M={id:7};
 assert.equal(f.send('checkpoint',{jobId:'job',protectionOnly:true}).body.yield,undefined);
 assert.equal(f.state.merchantCurrent.id,'job');
 assert.equal(f.send('checkpoint',{jobId:'job',eventOnly:true}).body.yield,true);
 assert.equal(f.state.merchantCurrent,null);assert.equal(f.state.merchantQueue.length,1);
 assert.equal(f.state.merchantQueue[0].id,'job');assert.deepEqual(f.state.merchantQueue[0].resumeState,{step:4});
 assert.deepEqual(f.state.merchantQueue[0].completedListingKeys,['receipt']);
 assert.equal(f.send('checkpoint',{jobId:'job',eventOnly:true}).code,409);assert.equal(f.state.merchantQueue.length,1);
});
