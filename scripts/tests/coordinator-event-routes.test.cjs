const test=require('node:test'),assert=require('node:assert/strict');
const {createEventRecoveryRoutes}=require('../../runtime/events/coordinator/routes.ts');
const {createEventAcknowledgementRoutes}=require('../../runtime/events/coordinator/routes.ts');
function fixture(){
 const state={leader:'L',eventReturn:null,anniversary:{eventCycle:null},eventSessions:{},statuses:{L:{seenAt:100,map:'level2w',x:9,y:9}},
  commands:{},deferredEventReturns:{},townCycle:null,partyFarmingMode:'default',monsterSearchRadiusByCharacter:{}};
 const calls=[],intents={L:{revision:1},F:{revision:1}},enabled=new Set(['L','F']);
 const ports={owned:name=>['L','F'].includes(name),enabled:name=>enabled.has(name),participants:()=>[...enabled],active:()=>['L','F'],
  abort:(...args)=>calls.push(['abort',...args]),begin:(...args)=>{calls.push(['begin',...args]);return {cycleId:'return',pending:['L']};},snapshot:()=>state.anniversary,
  now:()=>100,intent:name=>intents[name],nextCommand:()=>7,persist:()=>calls.push(['persist']),selectedDestination:()=>{calls.push(['position',state.statuses.L.map]);return {};},
  finishReturn:()=>calls.push(['finish']),contains:()=>true};
 const routes={...createEventRecoveryRoutes(state,ports),...createEventAcknowledgementRoutes(state,ports)};
 function send(route,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body},res);return res;}
 return {state,calls,intents,enabled,send};
}
test('exit acknowledgement must match both command and replacement runtime',()=>{
 const t=fixture();t.state.eventReturn={cycleId:'return',event:'abtesting',pending:['L']};
 t.state.commands.L={id:10,type:'event-return-town',cycleId:'return'};
 t.state.statuses.L.combatSelection={runtimeId:'new'};
 const body={character:'L',cycleId:'return',navigationRevision:1,map:'main',x:0,y:0,commandId:10,runtimeId:'new'};
 assert.equal(t.send('returnComplete',{...body,commandId:9}).body.stale,true);
 assert.equal(t.send('returnComplete',{...body,runtimeId:'old'}).body.stale,true);
 assert.deepEqual(t.state.eventReturn.pending,['L']);
 assert.equal(t.send('returnComplete',body).body.routedLeader,true);
});
test('event absence must be absent from every opted-in live report',()=>{
 const t=fixture(),body={character:'L',event:'franky'};
 t.state.statuses.L.serverLiveEvents=[{name:'franky'}];assert.equal(t.send('ended',body).code,409);assert.equal(t.calls.length,0);
 t.state.statuses.L.serverLiveEvents=[];assert.equal(t.send('ended',body).body.cycleId,'return');
});
test('disabling one anniversary follower returns only that member while the remaining party stays',()=>{
 const t=fixture();t.enabled.delete('F');t.state.anniversary.eventCycle={id:'round',participants:['L','F'],waypoints:{}};
 assert.equal(t.send('disabled',{character:'F',event:'anniversary'}).code,200);
 assert.deepEqual(t.calls[0],['begin','anniversary',{participants:['F'],waypoints:{}},true]);assert.deepEqual(t.state.anniversary.eventCycle.participants,['L']);
});
test('Town event acknowledgement updates coordinates before destination selection',()=>{
 const t=fixture();t.state.eventReturn={cycleId:'return',event:'franky',pending:['L']};
 const body={character:'L',cycleId:'return',navigationRevision:1,map:'main',x:0,y:0};
 const refused=t.send('returnComplete',{...body,mapEvent:'franky'});
 assert.equal(refused.code,409);assert.equal(refused.body.error,'character is still inside the ended event');
 const r=t.send('returnComplete',body);assert.equal(r.body.routedLeader,true);assert.deepEqual(t.calls,[['position','main'],['finish']]);
});
test('late deferred acknowledgement preserves unrelated newer commands and leaves cleanup to reconciliation',()=>{
 const t=fixture();t.state.statuses.F={seenAt:100,map:'main',x:0,y:0};t.intents.F.cancelled=true;t.state.deferredEventReturns.F={cycleId:'old',navigationRevision:1,checkpoint:{map:'cave',x:1,y:1}};
 t.state.commands.F={id:9,cycleId:'new',type:'character-travel'};
 assert.equal(t.send('returnComplete',{character:'F',cycleId:'old',navigationRevision:1}).body.stale,true);
 assert.ok(t.state.deferredEventReturns.F);assert.equal(t.state.commands.F.id,9);
});
test('authorized deferred returns resume the captured waypoint and reject stale revisions',()=>{
 const t=fixture();t.state.statuses.F={seenAt:100,map:'main',x:0,y:0};t.state.deferredEventReturns.F={cycleId:'old',navigationRevision:1,event:'franky',checkpoint:{map:'cave',x:1,y:1}};
 assert.equal(t.send('returnComplete',{character:'F',cycleId:'old',navigationRevision:0}).code,409);
 t.send('returnComplete',{character:'F',cycleId:'old',navigationRevision:1});assert.equal(t.state.commands.F.type,'event-resume-travel');assert.equal(t.state.commands.F.location.map,'cave');
});
test('resume engagement stamps only routes owning the acknowledged command and revision',()=>{
 const t=fixture(),location={map:'cave',x:1,y:1};
 const route={location,revision:1,commandId:9};
 const stale={location,revision:0,commandId:9};
 const newer={location,revision:1,commandId:10};
 t.state.anniversary.eventCycle={returnRoutes:{L:route}};
 t.state.eventReturn={returnRoutes:{L:stale}};
 t.state.eventSessions.L={returnRoutes:{L:newer}};
 t.state.commands.L={id:9,type:'event-resume-travel',navigationRevision:1,location,convoyHandoff:true};
 const result=t.send('resumeComplete',{character:'L',commandId:9,navigationRevision:1,engagedTarget:{id:'rat',...location}});
 assert.equal(result.code,200);assert.equal(route.engagedAt,100);
 assert.equal(stale.engagedAt,undefined);assert.equal(newer.engagedAt,undefined);
 assert.equal(t.state.anniversary.eventCycle.returnRoutes.L,route);
});
// EV18 (EVT-050): a deselection returns the deselected event's members, and the
// leader's anniversary deselection aborts the round.
test('a deselected event returns its members, and the leader deselecting the anniversary aborts the round',()=>{
 const t=fixture();t.enabled.clear();
 t.state.eventSessions={L:{event:'crabxx',participants:['L','F'],waypoints:{L:{revision:1}}},F:{event:'crabxx',participants:['L','F'],waypoints:{}}};
 assert.equal(t.send('disabled',{character:'L',event:'crabxx'}).code,200);
 assert.deepEqual(t.calls[0].slice(0,2),['begin','crabxx']);assert.deepEqual(t.calls[0][2].participants,['L','F']);assert.equal(t.calls[0][3],true);
 assert.deepEqual(t.state.eventSessions,{});
 const a=fixture();a.enabled.delete('L');a.state.anniversary.eventCycle={id:'round',liveRound:'r1',target:'X',participants:['L','F'],waypoints:{}};
 assert.equal(a.send('disabled',{character:'L',event:'anniversary'}).code,200);
 assert.deepEqual(a.calls[0],['abort',a.state.anniversary.eventCycle,'r1','X','L','event-disabled']);
});
