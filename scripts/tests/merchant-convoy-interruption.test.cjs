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
 test(purpose+' continues unchanged while the merchant collects alongside travel',()=>{
  const f=fixture(purpose),s=f.state,c=s.activeConvoy;
  s.statuses.F.merchantServiceProtocol=1;
  const route=structuredClone(c),commands=structuredClone(s.commands);
  assert.equal(f.send('handoff').body.ok,true);
  const service=s.merchantCurrent.recipientServices.F;
  assert.equal(service.concurrentService,true);assert.equal(service.type,'merchant-handoff');
  f.send('handoff');assert.equal(s.merchantCurrent.recipientServices.F,service);
  assert.deepEqual(s.commands,commands);assert.deepEqual(c,route);
  f.send('complete',{jobId:'job',character:'F',commandId:service.id});
  assert.equal(s.merchantCurrent.recipientServices.F,undefined);
  assert.deepEqual(s.commands,commands);assert.deepEqual(c,route);
 });
}
test('legacy and stale clients defer merchant service without pausing navigation',()=>{
 const f=fixture(),s=f.state,route=structuredClone(s.activeConvoy),commands=structuredClone(s.commands);
 assert.equal(f.send('handoff').body.waiting,true);
 s.statuses.F.merchantServiceProtocol=1;s.statuses.F.seenAt=-10000;
 assert.equal(f.send('handoff').body.waiting,true);
 assert.deepEqual(s.commands,commands);assert.deepEqual(s.activeConvoy,route);
});
test('stale service receipts cannot complete a newer service and completed collection is not reissued',()=>{
 const f=fixture(),s=f.state;s.statuses.F.merchantServiceProtocol=1;
 f.send('handoff');const service=s.merchantCurrent.recipientServices.F;
 assert.equal(f.send('complete',{jobId:'job',character:'F',commandId:service.id-1}).code,409);
 assert.equal(s.merchantCurrent.recipientServices.F,service);
 assert.equal(f.send('complete',{jobId:'job',character:'F',commandId:service.id}).body.ok,true);
 f.send('handoff');assert.equal(s.merchantCurrent.recipientServices.F,undefined);
});
test('commerce completion never deletes a newer navigation command',()=>{
 const f=fixture(),s=f.state;s.statuses.F.merchantServiceProtocol=1;
 s.merchantCurrent.reason='merchant commerce';s.merchantCurrent.order={sources:{F:[]}};
 f.send('order');const service=s.merchantCurrent.recipientServices.F;
 s.commands.F={id:999,type:'character-travel'};
 f.send('orderComplete',{jobId:'job',character:'F',commandId:service.id,sent:[]});
 assert.equal(s.commands.F.id,999);assert.equal(s.merchantCurrent.recipientServices.F,undefined);
});
test('legacy collection cannot replace the event-return parent between walking legs',()=>{
 const f=fixture(),s=f.state;s.activeConvoy=null;s.commands.F={id:42,type:'event-return-town',cycleId:'return'};
 assert.equal(f.send('handoff').body.waiting,true);assert.equal(s.commands.F.id,42);
});
for(const phase of ['stopping','ready','collecting','resuming'])test('persisted merchant '+phase+' releases without waiting for the merchant',()=>{
 const f=fixture(),s=f.state,c=s.activeConvoy;
 c.merchantInterruption={jobId:'job',recipient:'F',phase,deadline:61000,resumePhase:'assemble',revisions:{L:1,F:1,P:1}};
 const destination=structuredClone(c.location);f.tick();
 assert.equal(c.merchantInterruption,undefined);assert.equal(c.phase,'assemble');assert.deepEqual(c.location,destination);
 assert.equal(s.commands.F.type,'party-monster-travel');
});
test('superseded persisted merchant holds cannot resume cancelled navigation',()=>{
 const f=fixture(),s=f.state,c=s.activeConvoy;
 c.merchantInterruption={jobId:'job',recipient:'F',phase:'ready',resumePhase:'travel',revisions:{L:1,F:1,P:1}};
 s.navigationIntents.F={revision:2,cancelled:true};s.commands.F={id:999,type:'character-travel'};
 f.tick();assert.equal(s.commands.F.id,999);assert.equal(c.phase,'failed');assert.equal(c.merchantInterruption,undefined);
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
