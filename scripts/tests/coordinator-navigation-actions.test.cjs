const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorNavigationActions}=require('../../runtime/movement/coordinator/routes.ts');
function fixture(members=['F']){
 const location={map:'main',x:1,y:2},state={leader:'F',merchantCharacter:'M',activeConvoy:null,partyFarmingMode:'default',targetMode:'hunt',
  monsterHunt:{target:'bat'},monsterFocus:['goo'],monsterSearchRadiusByCharacter:{},statuses:{F:{seenAt:100000,map:'main'}},location,
  combatLogs:{},commands:{},nextCommandId:40,eventReturn:null,townCycle:null,anniversary:{eventCycle:null},eventSessions:{},deferredEventReturns:{}};
 const calls=[],group={ready:true,anchor:{map:'main'},blockers:[],key:'key',selection:'bat',members:['F']};
 const service=createCoordinatorNavigationActions(state,{
  now:()=>100000,owned:name=>members.includes(name),intent:()=>({revision:7}),group:()=>group,persist:()=>calls.push('persist'),
  selectedDestination:()=>location,finishReturn:()=>calls.push('finish'),contains:()=>true,
  huntOwns:hunt=>{assert.equal(hunt,state.monsterHunt);return !!hunt?.busy;},farmingLive:()=>!state.monsterHunt?.busy,
  engage:(current,body,options)=>{assert.equal(current,state);calls.push(['engage',options]);return true;},
  acceptArrival:(hunt,convoy,body,at)=>{assert.equal(hunt,state.monsterHunt);calls.push(['arrival',convoy.id,at]);return true;},
  waypoint:()=>location,start:(...args)=>{calls.push(['start',...args]);return true;},active:()=>members,members:()=>members,
  valid:(current,body)=>{assert.equal(current,state);return body.convoyId===state.activeConvoy?.id;},history:()=>calls.push('history'),
  hold:(current,...args)=>{assert.equal(current,state);calls.push(['hold',...args]);},error:message=>calls.push(['error',message]),
 });
 function invoke(handler,body){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};handler({body},res);return res;}
 return {state,calls,service,invoke,location};
}

test('Franky exit acknowledgements allocate Town once and preserve it against replayed completion',()=>{
 // Every walk holds its completion until its members arrive (route-store.ts `sharedArrivalReady`).
 const t=fixture();t.state.activeConvoy={id:'exit',phase:'travel',departAt:1,purpose:'franky-exit',participants:['F'],completed:['F'],routeServer:'S',runtimes:{F:'F'}};
 Object.assign(t.state.statuses.F,{server:'S',convoyNavigation:{runtimeId:'F'}});
 t.state.eventReturn={exitConvoyId:'exit',cycleId:'cycle',event:'franky',checkpoint:t.location,pending:['F']};
 t.state.commands={F:{id:1,type:'convoy-move'}};t.state.nextCommandId=90;
 assert.equal(t.invoke(t.service.acknowledgements.complete,{character:'F',convoyId:'exit'}).code,200);
 assert.deepEqual(t.state.commands.F,{id:90,type:'event-return-town',cycleId:'cycle',event:'franky',checkpoint:t.location});
 assert.equal(t.state.nextCommandId,91);assert.equal(t.state.activeConvoy,null);
 assert.equal(t.invoke(t.service.acknowledgements.complete,{character:'F',convoyId:'exit'}).code,200);
 assert.equal(t.invoke(t.service.acknowledgements.complete,{character:'F',convoyId:'older-exit'}).code,409);
 assert.equal(t.state.commands.F.id,90);
 // Each member's Town goes out with its completion once every member stands at the exit, and the
 // walk stays until the last member completes (EVT-031). The walk's protocol marker no longer
 // decides it: franky-exit's legacy completion test went with the movement rewrite.
 const two=fixture(['F','B']),exit={id:'exit',epoch:2,phase:'travel',departAt:1,purpose:'franky-exit',participants:['F','B'],completed:[],
  routeServer:'S',routeVersion:3,runtimes:{F:'F',B:'B'},location:{map:'main',x:0,y:0}};
 two.state.activeConvoy=exit;two.state.nextCommandId=90;
 two.state.eventReturn={exitConvoyId:'exit',cycleId:'cycle',event:'franky',checkpoint:two.location,pending:['F','B']};
 const report=(name,id,phase)=>({id:'exit',epoch:2,commandId:id,navigationRevision:0,runtimeId:name,routeVersion:3,phase});
 // The walk's own commands carry walk.ts sharedCommand's type, the one route-store.ts walkCommandOf reads.
 two.state.commands={F:{id:1,type:'party-monster-travel',convoyId:'exit',epoch:2,navigationRevision:0},B:{id:2,type:'party-monster-travel',convoyId:'exit',epoch:2,navigationRevision:0}};
 two.state.statuses={F:{seenAt:100000,server:'S',map:'main',x:0,y:0,hp:100,convoyNavigation:report('F',1,'arrived')},
  B:{seenAt:100000,server:'S',map:'desertland',x:0,y:0,hp:100,convoyNavigation:report('B',2,'travelling')}};
 assert.deepEqual(two.invoke(two.service.acknowledgements.complete,{character:'F',convoyId:'exit'}).body,{ok:false,waiting:true},
  'F waits at the exit while B still walks');
 assert.equal(two.state.commands.F.type,'party-monster-travel');
 Object.assign(two.state.statuses.B,{map:'main',convoyNavigation:report('B',2,'arrived')});
 assert.equal(two.invoke(two.service.acknowledgements.complete,{character:'F',convoyId:'exit'}).code,200);
 assert.deepEqual(two.state.commands.F,{id:90,type:'event-return-town',cycleId:'cycle',event:'franky',checkpoint:two.location});
 assert.deepEqual(two.state.eventReturn.exited,['F']);assert.equal(two.state.activeConvoy,exit,'the walk stays for B');
 assert.equal(two.invoke(two.service.acknowledgements.complete,{character:'B',convoyId:'exit'}).code,200);
 assert.equal(two.state.commands.B.type,'event-return-town');assert.deepEqual(two.state.eventReturn.exited,['F','B']);
 assert.equal(two.state.activeConvoy,null);
});
