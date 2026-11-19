const {withDoor}=require('./helpers/coordinator-merchant.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {createPartyCheckpointRoute}=require('../../runtime/hunting/coordinator/api.ts');
const {createCave}=require('../../runtime/hunting/coordinator/cave.ts');
const {createMerchantPartyRoutes}=require('../../runtime/merchant-jobs/coordinator/api.ts');
const {createPartyTravelRoutes}=require('../../runtime/movement/coordinator/routes.ts');
function fixture(){
 const state={leader:'L',followers:{F:true},merchantCharacter:'M',statuses:{L:{seenAt:100000,map:'main',x:2,y:3}},commands:{},merchantCurrent:null,merchantQueue:[],
  upgrades:{L:[{}]},purchases:{},compounds:{F:[{items:[1,2]}]},autoCompounds:{M:[{}]},escape:{stage:'active'}};
 const calls=[];let next=1;
 const ports={now:()=>100000,nextCommand:()=>next++,release:()=>calls.push('release'),members:()=>['L','F'],active:()=>['L','F','M'],
  authorize:(names,location)=>{calls.push(['authorize',names]);state.location=location;},invalidate:(...args)=>calls.push(args),persist:()=>calls.push('persist'),dispatch:()=>calls.push('dispatch'),
  escape:()=>({stage:'started'}),queue:(...args)=>calls.push(args),
  convoy:(location,label,names,purpose)=>{for(const name of names)state.commands[name]={id:next++,type:'party-monster-travel',location,purpose};return true;}};
 // The hunting owner's checkpoint and Cave release, the merchant owner's party routes and movement's party travel and Town, composed
 // as application.ts does.
 const cave=createCave(state,{now:ports.now,persist(){},cancel(){},offline:()=>false});
 const actions={checkpoint:createPartyCheckpointRoute(state,ports),...createMerchantPartyRoutes(state,withDoor(state,ports))};
 const routes={...actions,...createPartyTravelRoutes(state,{...ports,exitDungeon:res=>cave.exitDungeon(res,next++),releaseDungeon:res=>cave.releaseDungeon(res)})};
 function send(route,body={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body},res);return res;}
 return {state,calls,send};
}
scenarioTable('the merchant party routes and the checkpoint route over one coordinator state', fixture, [
['manual collection queues every group member without a radius and does not duplicate work',t=>{
 assert.deepEqual(t.send('bank').body.queued,['L','F']);t.send('bank');assert.equal(t.state.merchantQueue.length,2);
 assert.equal(t.state.merchantQueue[0].expandLeaderCluster,undefined);assert.deepEqual(t.calls,['persist','dispatch']);
}],
['unselected leader cannot save a checkpoint or dispatch collection, even with a null-key report',t=>{
 t.state.leader=null;t.state.statuses.null=t.state.statuses.L;
 assert.equal(t.send('checkpoint').code,409);assert.equal(t.send('bank').code,409);
 assert.deepEqual(t.calls,[]);assert.deepEqual(t.state.merchantQueue,[]);
}],

['send to party explicitly queues marked delivery recipients outside the leader cluster',t=>{
 
 t.state.merchantDeliveries={F:[{slot:24,item:{name:'wattire',level:8,stat_type:'int'},equipOnDelivery:true}],M:[{}],Other:[{}]};
 t.state.statuses.F={seenAt:100000,map:'winterland',x:999,y:999};
 assert.deepEqual(t.send('bank').body.queued,['L','F']);
 assert.deepEqual(t.state.merchantQueue.map(job=>job.target),['L','F']);
 assert.equal(t.state.merchantQueue[1].expandLeaderCluster,undefined);
 t.send('bank');assert.equal(t.state.merchantQueue.length,2);
 assert.equal(t.state.merchantDeliveries.F[0].equipOnDelivery,true);
}],

['repeated send does not duplicate the in-progress leader or queued follower',t=>{
 t.send('bank');t.state.merchantCurrent=t.state.merchantQueue.shift();
 t.state.merchantDeliveries={F:[{item:{name:'wattire',level:8},equipOnDelivery:true}]};
 t.send('bank');assert.deepEqual(t.state.merchantQueue.map(job=>job.target),['F']);
 assert.deepEqual(t.calls,['persist','dispatch']);
}],

['independent parties require selection and queue only the selected group',t=>{
 t.state.followers.F=false;
 assert.equal(t.send('bank').code,409);assert.deepEqual(t.state.merchantQueue,[]);
 assert.equal(t.send('bank',{group:'missing'}).code,409);
 assert.deepEqual(t.send('bank',{group:'F'}).body.queued,['F']);
 assert.deepEqual(t.state.merchantQueue.map(job=>job.target),['F']);
}],
['party upgrade action queues only actionable owners and preserves manual immediate semantics',t=>{
 assert.deepEqual(t.send('upgrades').body.queued,['L','M']);assert.deepEqual(t.calls,[[['L','M'],'upgrades and compounds']]);
}],
['travel authorizes the shared checkpoint and sends one forced convoy to the combat party',t=>{
 assert.equal(t.send('travel',{map:'main',x:8,y:9,force:true}).body.partyLocation.x,8);
 assert.deepEqual(Object.keys(t.state.commands),['L','F']);assert.equal(t.state.commands.F.type,'party-monster-travel');assert.equal(t.state.commands.F.purpose,'party-force-travel');
 const before=t.state.location;assert.equal(t.send('travel',{map:'not a map',x:8,y:9}).code,400);assert.equal(t.state.location,before);
}],
]);

// The hunting owner's Cave release returns its refusal, and the travel command answers it
// with 409 before any walk starts.
test('a travel command while the Cave visit refuses its release replies 409 and starts nothing',()=>{
 const {installedTasks}=require('./fixtures/task-owner-scenario.cjs');
 const t=installedTasks({releaseVisit:()=>Error('Exit the dungeon before resuming ordinary travel')}),handled=[];
 const reply=t.tasks.travelCommand({type:'travel',character:'L'},body=>{handled.push(body);return {ok:true};});
 assert.deepEqual(reply,{status:409,body:{error:'Error: Exit the dungeon before resuming ordinary travel'}});
 assert.deepEqual(handled,[]);
});

// The travel route reads the status owner's navigation set (status/rules.ts navigational), so
// every command type that walks a character asks the Cave visit's release, the event resume
// included.
test('every navigation command type asks the Cave release, as status/rules.ts navigational names them',()=>{
 const {installedTasks}=require('./fixtures/task-owner-scenario.cjs');
 const asked=[],t=installedTasks({releaseVisit:()=>{asked.push(true);return null;}});
 for(const type of ['travel','force-travel','character-travel','party-monster-travel','event-resume-travel','return-leader','town'])
  t.tasks.travelCommand({type,character:'L'},()=>({ok:true}));
 assert.equal(asked.length,6);
});

// An app key's /travel runs as its app's caller, so the party walk, the trip
// task and the walk the trip asks again when it resumes all carry the `app` tier and the app's name. The
// route's convoy is the tasks owner's startWalk, composed as application.ts does.
test("an app key's party travel carries the app tier and name through the trip and its walk",()=>{
 const {createApps}=require('../../runtime/status/coordinator/apps.ts');
 const {installedTasks}=require('./fixtures/task-owner-scenario.cjs');
 const t=installedTasks(),apps=createApps({appKeys:[]},{now:()=>100000,persist(){},notify(){}}),screens={};
 apps.install({get(){},post:(path,handler)=>{screens[path]=handler;}});
 let key;screens['/party-api/apps']({body:{name:'Spreadsheet',scopes:['command']}},{status(){return this;},json(v){key=v.key;return this;}});
 const walks=[],members=()=>['L','F'];
 const {travel}=createPartyTravelRoutes(t.party,{now:()=>100000,nextCommand:()=>1,release(){},members,active:members,authorize(){},invalidate(){},persist(){},
  exitDungeon:()=>false,releaseDungeon:()=>true,convoy:(...args)=>{walks.push(args.slice(5));return t.tasks.startWalk(...args);}});
 t.tasks.taskTick();
 const res={status(){return this;},json(body){this.body=body;return this;}};
 apps.gate({get:()=>'Bearer '+key,method:'POST',path:'/party-api/travel',body:{map:'main',x:5,y:6}},res,()=>travel({body:{map:'main',x:5,y:6}},res));
 assert.equal(res.body?.ok,true);
 assert.deepEqual(walks,[['app','app:Spreadsheet']],'the walk starts at the app tier, naming the app');
 const live=t.tasks.owner.live('party:L');
 assert.equal(live.kind,'app','the trip is the app tier task');
 assert.deepEqual(t.party.manualTasks.map(trip=>[trip.kind,trip.label]),[['app',"Spreadsheet's trip to party location"]],'the trip names the app');
 // The trip walks again from the provider (the start set no walk here): that walk asks at the app tier too.
 t.tasks.taskTick();t.tasks.taskTick();
 assert.deepEqual(t.asks.map(([,,ask])=>[ask.tier,ask.by]),[['app','app:Spreadsheet']]);
});
