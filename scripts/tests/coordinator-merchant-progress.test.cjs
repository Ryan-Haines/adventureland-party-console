const test=require('node:test'),assert=require('node:assert/strict');
const {createMerchantHandoffRoutes}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
const {createMerchantProgressRoutes}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
const {publishTasks}=require('../../runtime/tasks/api.ts');
const {publishEventAnswers}=require('../../runtime/events/api.ts');
function fixture(){
 // The merchant's event hold asks the tasks owner's `task.live` for its group, which
 // holds no event task here, so the merchant's own report decides it.
 publishTasks({groupOf:name=>'party:'+name,live:()=>null});
 // The events owner's deferred returns hold none here.
 publishEventAnswers({deferredReturn:()=>false});
 const state={merchantCharacter:'M',merchantCurrent:{id:'job',target:'F',reason:'upgrades and compounds',priority:5,phase:'assigned'},merchantQueue:[],commands:{},statuses:{F:{map:'main'}},
  marked:{},merchantMarked:{},autoItemMarks:{},upgrades:{},compounds:{},statScrolls:{},autoCompounds:{},goldTargets:{F:1000},threshold:500,gatheringModes:[],gatheringNoTool:{},gatheringCooldowns:{}};
 // The checkpoint reads the dispatch facts, which ask the items owner's items.needs.
 require('./helpers/coordinator-merchant.cjs').itemsDoor(state);
 const calls=[],ports={now:()=>100,nextCommand:()=>7,persist:()=>calls.push('persist'),owned:()=>true,queue:(...args)=>calls.push(args),log(){},
  priority:job=>job.priority,routinePriority:()=>9,stamp:job=>job,dispatch:()=>calls.push('dispatch'),visitAllowed:name=>!held.includes(name),offline:name=>offline.includes(name)};
 const routes={...createMerchantHandoffRoutes(state,ports),...createMerchantProgressRoutes(state,ports)};
 function send(route,body={},params={},query={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body,params,query},res);return res;}
 return {state,calls,send};
}
// The tasks owner's allows('merchant-visit') refuses a member a Hunt return holds.
let held=[],offline=[];
test('handoff respects protected Hunt travel and preserves newer commands on old acknowledgements',()=>{
 const t=fixture();held=['F'];assert.equal(t.send('handoff',{jobId:'job',target:'F'}).body.reason,'hunt_movement_owned');assert.equal(t.state.commands.F,undefined);
 held=[];t.send('handoff',{jobId:'job',target:'F',capacity:2});assert.equal(t.state.commands.F.capacity,2);assert.equal(t.state.commands.F.goldTarget,1000);
 t.send('complete',{jobId:'job',character:'F',commandId:6});assert.equal(t.state.commands.F.id,7);
 t.send('complete',{jobId:'job',character:'F',commandId:7});assert.equal(t.state.commands.F,undefined);assert.equal(t.state.merchantCurrent.phase,'processing');
});
test('commerce handoff requires a reserved source and records delivered material without clearing another command',()=>{
 const t=fixture();Object.assign(t.state.merchantCurrent,{reason:'merchant commerce',order:{sources:{F:[{slot:2}]}}});
 assert.equal(t.send('order',{jobId:'job',target:'X'}).code,409);t.send('order',{jobId:'job',target:'F'});assert.deepEqual(t.state.commands.F.items,[{slot:2}]);
 t.state.commands.F={id:8,type:'travel'};t.send('orderComplete',{jobId:'job',character:'F',sent:[{slot:2}]});assert.equal(t.state.commands.F.id,8);assert.equal(t.state.merchantCurrent.orderHandoff.sent.length,1);
});
test('merchant heartbeat marks the job processing and batch status picks only the same collection batch',()=>{
 const t=fixture();t.send('heartbeat',{jobId:'job'});assert.equal(t.state.merchantCurrent.phase,'processing');assert.equal(t.calls.length,0);
 t.state.merchantCurrent.batchId='b';t.state.merchantQueue=[{target:'X',batchId:'other'},{target:'L',batchId:'b'}];
 assert.equal(t.send('job',{}, {id:'job'}).body.nextCollectionTarget,'L');assert.equal(t.send('job',{}, {id:'stale'}).code,404);
});
test('checkpoint preserves current work on equal priority and yields durable resume state to higher-priority gathering',()=>{
 const t=fixture();t.state.merchantQueue=[{id:'next',priority:5}];assert.equal(t.send('checkpoint',{jobId:'job',state:{step:2}}).body.yield,false);
 t.state.gatheringModes=['fishing'];t.state.commands.M={id:7,jobId:'job'};const res=t.send('checkpoint',{jobId:'job',state:{step:3}});
 assert.equal(res.body.yield,true);assert.equal(t.state.merchantCurrent,null);assert.equal(t.state.commands.M,undefined);assert.equal(t.state.merchantQueue.at(-1).resumeState.step,3);
 assert.equal(t.state.merchantQueue.at(-1).phase,undefined);assert.equal(t.calls.at(-1),'dispatch');
 // At three free slots the dispatch refuses gathering, so the checkpoint does not yield to it.
 const full=fixture();full.state.gatheringModes=['fishing'];full.state.statuses.M={seenAt:100,items:[null,null,null,{name:'wbook0'}]};
 assert.equal(full.send('checkpoint',{jobId:'job',state:{step:3}}).body.yield,false);assert.equal(full.state.merchantCurrent.id,'job');
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

// The merchant's event hold is its own file, named for what it decides, with no stand-in left:
// the tasks owner's live event attendance task of the merchant's group holds the merchant.
test("the event hold answers the merchant group's live event task",()=>{
 const {merchantEventRecoveryReserved}=require('../../runtime/merchant-jobs/coordinator/event-hold.ts');
 publishTasks({groupOf:name=>'party:'+name,live:()=>({kind:'event-attendance'})});
 assert.equal(merchantEventRecoveryReserved({merchantCharacter:'M'}),true);
 publishTasks({groupOf:name=>'party:'+name,live:()=>null});
});

// A member that cannot answer ends the merchant's wait with the cause, from the lifecycle owner's
// roster (offline or failed) or its own rip report, at any wait length; a present, living member whose
// convoy pause is still landing keeps the wait.
test('the handoff and its receipt read refuse a member the roster answers offline or that reports rip',()=>{
 const f=fixture();
 offline=['F'];
 try{
  assert.deepEqual(f.send('handoff',{jobId:'job',target:'F'}).body,{refused:true,reason:'F is offline'});
  assert.equal(f.state.commands.F,undefined,'no handoff command goes to an offline member');
  assert.equal(f.send('job',{},{id:'job'}).body.handoffRefused,'F is offline');
 }finally{offline=[];}
 f.state.statuses.F.rip=true;
 assert.equal(f.send('job',{},{id:'job'}).body.handoffRefused,'F is dead');
 delete f.state.statuses.F.rip;
 assert.equal(f.send('job',{},{id:'job'}).body.handoffRefused,null,'a present, living member keeps the wait');
});
