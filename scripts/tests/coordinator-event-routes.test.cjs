const test=require('node:test'),assert=require('node:assert/strict');
const {createEventRecoveryRoutes}=require('../../runtime/coordinator/http/event-recovery.ts');
const {createEventAcknowledgementRoutes}=require('../../runtime/coordinator/http/event-acknowledgements.ts');
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
test('event absence must be sustained and absent from every opted-in live report',()=>{
 const t=fixture(),body={character:'L',event:'franky',missingFor:9999};assert.equal(t.send('ended',body).code,409);
 body.missingFor=10000;t.state.statuses.L.serverLiveEvents=[{name:'franky'}];assert.equal(t.send('ended',body).code,409);assert.equal(t.calls.length,0);
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
 assert.equal(t.send('returnComplete',{...body,mapEvent:'franky'}).code,409);
 const r=t.send('returnComplete',body);assert.equal(r.body.routedLeader,true);assert.deepEqual(t.calls,[['position','main'],['finish']]);
});
test('cancelled deferred returns discard their checkpoint but preserve unrelated newer commands',()=>{
 const t=fixture();t.state.statuses.F={seenAt:100,map:'main',x:0,y:0};t.intents.F.cancelled=true;t.state.deferredEventReturns.F={cycleId:'old',navigationRevision:1,checkpoint:{map:'cave',x:1,y:1}};
 t.state.commands.F={id:9,cycleId:'new',type:'character-travel'};
 assert.equal(t.send('returnComplete',{character:'F',cycleId:'old',navigationRevision:1}).body.deferred,true);
 assert.equal(t.state.deferredEventReturns.F,undefined);assert.equal(t.state.commands.F.id,9);
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
