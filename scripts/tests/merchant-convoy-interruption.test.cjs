const test = require('node:test'), assert = require('node:assert/strict');
const {createSharedConvoyNavigation} = require('../../runtime/coordinator/navigation/shared-navigation.ts');
const {createMerchantHandoffRoutes} = require('../../runtime/coordinator/http/merchant-handoff.ts');
const {initialCommandState} = require('../../runtime/coordinator/navigation/initial-commands.ts');
const {createCoordinatorEventReturns} = require('../../runtime/coordinator/events/return-composition.ts');
const legacy = require('../convoy-navigation.cjs');
function fixture(purpose='monster-hunt') {
  let now=1000; const names=['L','F','P'];
  const state={nextCommandId:10,merchantCharacter:'M',merchantCurrent:{id:'job',target:'F',reason:'collection'},
    marked:{},merchantMarked:{},autoItemMarks:{},upgrades:{},compounds:{},statScrolls:{},autoCompounds:{},goldTargets:{},
    navigationIntents:Object.fromEntries(names.map(n=>[n,{revision:1}])),
    commands:Object.fromEntries(names.map(n=>[n,{id:1,type:'party-monster-travel',convoyId:'trip',epoch:7,navigationRevision:1}])),
    statuses:Object.fromEntries(names.map(n=>[n,{map:'main',x:0,y:0,speed:57,server:'USII',seenAt:now,convoyProtocol:4,convoyNavigation:{runtimeId:n}}])),
    activeConvoy:{id:'trip',epoch:7,routeProtocol:4,phase:'assemble',leader:'L',participants:names,completed:[],slowestSpeed:57,
      purpose,rally:{map:'main',x:0,y:0},location:{map:'halloween',x:-509,y:-626},navigationExempt:purpose==='shared-walk-return'}};
  const engine=createSharedConvoyNavigation(legacy), routes=createMerchantHandoffRoutes(state,{now:()=>now,nextCommand:()=>state.nextCommandId++,persist(){},owned:()=>true,queue(){},log(){}});
  function send(route,body={jobId:'job',target:'F'}) { const res={status(n){this.code=n;return this;},json(v){this.body=v;return this;}};routes[route]({body},res);return res; }
  function ack() { for(const n of names){const c=state.activeConvoy,cmd=state.commands[n];state.statuses[n].seenAt=now;
    state.statuses[n].convoyNavigation={id:c.id,epoch:c.epoch,commandId:cmd.id,navigationRevision:cmd.navigationRevision,runtimeId:n,phase:'held'};} }
  function tick(time=now){now=time;return engine.step(state,now);}
  tick();return {state,send,ack,tick};
}
for(const purpose of ['monster-hunt','shared-walk-return','event-return','empty-spawn-recovery']) {
  test(purpose+' pauses all members, collects once, and resumes its destination',()=>{
    const f=fixture(purpose),s=f.state,c=s.activeConvoy;
    c.walkingParents={F:{revision:1,parentId:9,command:{id:9,type:'event-return-town',cycleId:'return'}}};
    const parents=structuredClone(c.walkingParents),destination=structuredClone(c.location),prior=s.commands.F;
    assert.equal(f.send('handoff').body.waiting,true);assert.equal(s.commands.F,prior);
    f.tick();assert.equal(s.commands.F.phase,'shared-hold');
    assert.equal(f.send('handoff').body.waiting,true);
    f.ack();f.tick();assert.equal(f.send('handoff').body.ok,true);
    const handoff=s.commands.F;assert.equal(handoff.type,'merchant-handoff');assert.equal(handoff.convoyContinuation.convoyId,c.id);
    f.send('handoff');assert.equal(s.commands.F,handoff,'duplicate requests do not reissue collection');
    f.tick();assert.notEqual(c.phase,'failed');
    f.send('complete',{jobId:'job',character:'F',commandId:handoff.id});
    f.tick();f.ack();f.tick();assert.equal(c.phase,'shared-prepare');
    assert.equal(c.merchantInterruption,undefined);assert.deepEqual(c.location,destination);assert.deepEqual(c.walkingParents,parents);
    assert.ok(c.epoch>7);assert.equal(s.commands.F.type,'party-monster-travel');
  });
}
test('commerce pauses, timeout waits for stopped acknowledgement, and stale completion cannot clear travel',()=>{
  const f=fixture(),s=f.state;s.merchantCurrent.reason='merchant commerce';s.merchantCurrent.order={sources:{F:[]}};
  f.send('order');f.tick();f.ack();f.tick();f.send('order');const old=s.commands.F;
  f.tick(62000);assert.equal(s.commands.F.phase,'shared-hold');assert.ok(s.activeConvoy.merchantInterruption);
  f.ack();f.tick();assert.equal(s.activeConvoy.phase,'shared-prepare');const current=s.commands.F;
  f.send('orderComplete',{jobId:'job',character:'F',commandId:old.id,sent:[]});assert.equal(s.commands.F,current);
});
test('manual navigation supersedes the saved merchant continuation',()=>{
  const f=fixture(),s=f.state;f.send('handoff');f.tick();
  s.navigationIntents.F.revision++;s.commands.F={id:999,type:'character-travel'};
  f.tick();assert.equal(s.commands.F.id,999);assert.equal(s.activeConvoy.merchantInterruption,undefined);assert.equal(s.activeConvoy.phase,'failed');
});
test('merchant collection cannot replace the event-return parent between walking legs',()=>{
  const f=fixture(),s=f.state;s.activeConvoy=null;s.commands.F={id:42,type:'event-return-town',cycleId:'return'};
  assert.equal(f.send('handoff').body.waiting,true);assert.equal(s.commands.F.id,42);
});
test('another recipient must wait for the first collection to release the convoy',()=>{
  const f=fixture(),s=f.state;f.send('handoff');f.tick();f.ack();f.tick();f.send('handoff');
  s.merchantCurrent.reason='merchant commerce';s.merchantCurrent.order={sources:{P:[]}};
  assert.equal(f.send('order',{jobId:'job',target:'P'}).body.waiting,true);assert.equal(s.commands.P.type,'party-monster-travel');
});
test('a persisted interrupted convoy resumes with fresh commands after restart',()=>{
  const f=fixture(),s=f.state;f.send('handoff');f.tick();f.ack();f.tick();f.send('handoff');
  Object.assign(s,initialCommandState({activeConvoy:structuredClone(s.activeConvoy)},()=>2000));
  f.tick(2000);f.ack();f.tick();assert.equal(s.activeConvoy.phase,'communication-hold');
  for(let time=3000;time<=7000;time+=1000){f.tick(time);f.ack();f.tick();}
  f.ack();f.tick();assert.equal(s.activeConvoy.phase,'shared-prepare');assert.equal(s.activeConvoy.merchantInterruption,undefined);
});
test('collection during assembly initializes stop acknowledgements before the first shared route',()=>{
  const f=fixture(),s=f.state;s.activeConvoy.phase='assemble';s.activeConvoy.runtimes=null;
  f.send('handoff');f.tick();f.ack();f.tick();f.send('handoff');assert.equal(s.commands.F.type,'merchant-handoff');
  f.send('complete',{jobId:'job',character:'F',commandId:s.commands.F.id});f.tick();f.ack();f.tick();
  assert.equal(s.activeConvoy.phase,'assemble');assert.equal(s.activeConvoy.merchantInterruption,undefined);
});
for (const map of ['main','winterland']) test('orphaned Snowman exit in '+map+' releases recovery without losing the checkpoint',()=>{
  const names=['L','F','P'],cycleId='snowman-return',checkpoint={map:'halloween',x:-509,y:-626};
  const state={nextCommandId:100,merchantCharacter:'M',eventReturnLast:null,deferredEventReturns:{},townCycle:null,anniversary:{},eventSessions:{},commands:{},
    eventReturn:{cycleId,event:'snowman',participants:names.slice(),pending:[],checkpoint,waypoints:Object.fromEntries(names.map(n=>[n,{revision:1,location:checkpoint}]))},
    statuses:Object.fromEntries(names.map(n=>[n,{map,seenAt:1000}])),
    activeConvoy:{id:'old',phase:'failed',purpose:'shared-walk-return',walkingActivity:'event-return',participants:names,
      walkingParents:Object.fromEntries(names.map(n=>[n,{revision:1,command:{cycleId,type:'event-return-town'}}]))}};
  for(const n of names)state.commands[n]={id:2,type:'party-monster-travel',convoyId:'old'};
  let dispatched=0;
  const service=createCoordinatorEventReturns(state,{now:()=>1000,activeNames:()=>names,enabled:()=>true,checkpoint:()=>checkpoint,
    cancelConvoy(){state.activeConvoy=null;},startConvoy:()=>false,anniversaryParticipants:()=>[],persist(){},
    navigation:{capture:()=>Object.fromEntries(names.map(n=>[n,{revision:1,location:checkpoint}])),
      dispatch(owner){dispatched++;assert.deepEqual(owner.checkpoint,checkpoint);owner.returnDispatchedAt=1000;return true;},reconcile:()=>true,finish(){}}});
  service.reconcile();assert.equal(state.activeConvoy,null);
  if(map==='main'){assert.equal(dispatched,1);service.reconcile();assert.equal(state.eventReturn,null);}
  else {assert.deepEqual(state.eventReturn.pending,names);assert.equal(state.commands.F.type,'event-return-town');assert.equal(dispatched,0);}
});

test('merchant resumption processes combat before waiting for held reports',()=>{
 const f=fixture(),s=f.state;f.send('handoff');f.tick();f.ack();f.tick();f.send('handoff');
 f.send('complete',{jobId:'job',character:'F',commandId:s.commands.F.id});
 f.tick();f.ack();for(const status of Object.values(s.statuses))status.convoyNavigation.phase='defending';
 let calls=0;
 const engine=createSharedConvoyNavigation(legacy,(state,now,make)=>{
   calls++;for(const n of state.activeConvoy.participants)state.statuses[n].convoyNavigation.phase='held';
   return true;
 });
 engine.step(s,1000);assert.equal(calls,1);assert.ok(s.activeConvoy.merchantInterruption);
 f.tick();assert.equal(s.activeConvoy.phase,'shared-prepare');assert.equal(s.activeConvoy.merchantInterruption,undefined);
});
