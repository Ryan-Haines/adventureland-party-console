const test = require('node:test'), assert = require('node:assert/strict');
const {createSharedConvoyNavigation} = require('../../runtime/coordinator/navigation/shared-navigation.ts');
const {createMerchantHandoffRoutes} = require('../../runtime/coordinator/http/merchant-handoff.ts');
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

test('merchant collection waits for communication recovery without capturing its internal phase',()=>{
 const f=fixture(),s=f.state;f.tick(5000);
 assert.equal(s.activeConvoy.phase,'communication-hold');
 assert.equal(f.send('handoff').body.waiting,true);
 assert.equal(s.activeConvoy.merchantInterruption,undefined);
 for(let time=6000;time<=12000;time+=1000){f.ack();f.tick(time);}
 f.ack();f.tick();assert.equal(s.activeConvoy.communicationHold,undefined);
 assert.equal(f.send('handoff').body.waiting,true);
 assert.equal(s.activeConvoy.merchantInterruption.resumePhase,'shared-prepare');
});

test('legacy merchant continuation captured during communication recovery prepares a new route',()=>{
 const f=fixture(),s=f.state,c=s.activeConvoy,destination=c.location;
 f.send('handoff');c.merchantInterruption.resumePhase='communication-hold';
 f.tick();f.ack();f.tick();f.send('handoff');
 f.send('complete',{jobId:'job',character:'F',commandId:s.commands.F.id});
 f.tick();f.ack();f.tick();
 assert.equal(c.phase,'shared-prepare');assert.equal(c.location,destination);
 for(const command of Object.values(s.commands))assert.equal(command.phase,'shared-prepare');
 assert.equal(c.merchantInterruption,undefined);
});
for(const purpose of ['shared-walk-return','event-return','empty-spawn-recovery']) {
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


for(const purpose of ['monster-hunt','shared-walk-return','event-return','empty-spawn-recovery']) {
 for(const reason of ['failure','timeout','clear','force','realm'])test(purpose+' resumes after merchant '+reason+' without accepting a late handoff',()=>{
  const f=fixture(purpose),s=f.state,c=s.activeConvoy,destination=structuredClone(c.location);
  f.send('handoff');f.tick();f.ack();f.tick();f.send('handoff');const old=s.commands.F;
  if(reason==='timeout') {s.merchantCurrent=null;delete s.commands.F;}
  else if(reason==='realm')require('../../runtime/coordinator/merchant/realm-pause.ts').pauseMerchantForRealm(Object.assign(s,{merchantQueue:[]}),()=>1000,j=>j);
  else if(['clear','force'].includes(reason)) {
   const routes=require('../../runtime/coordinator/http/merchant-control.ts').createMerchantControlRoutes(Object.assign(s,{merchantQueue:[]}),{nextCommand:()=>999,now:()=>1000,stamp:j=>j,log(){},persist(){},returnHome(){}});
   routes[reason]({body:{enabled:true}},{json(){}});
  } else {
   const base=require('./helpers/coordinator-completion.cjs').fixture({});
   Object.assign(base.state,s);
   require('../../runtime/coordinator/merchant/completion.ts').createMerchantCompletion(base.state,base.ports).complete(base.state.merchantCurrent,{success:false,error:'Merchant died during rendezvous'});
   s.merchantCurrent=base.state.merchantCurrent;
  }
  f.tick();f.ack();f.tick();assert.equal(c.phase,'shared-prepare');assert.deepEqual(c.location,destination);
  const next=s.commands.F;
  const reply=f.send('complete',{jobId:'job',character:'F',commandId:old.id});
  assert.equal(reply.body.stale,true);assert.equal(s.commands.F,next);assert.equal(c.merchantInterruption,undefined);
 });
}

test('job release keeps newer commands and equipment ownership intact',()=>{
 const {releaseMerchantInterruption}=require('../../runtime/coordinator/navigation/merchant-interruption.ts');
 const f=fixture(),s=f.state;f.send('handoff');f.tick();f.ack();f.tick();f.send('handoff');
 s.commands.F={id:999,type:'character-travel'};s.navigationIntents.F.revision++;
 releaseMerchantInterruption(s,'job');s.merchantCurrent=null;f.tick();assert.equal(s.commands.F.id,999);assert.equal(s.activeConvoy.phase,'failed');
});

test('late commerce receipt for an ended job does not overwrite the next job',()=>{
 const f=fixture(),s=f.state;s.merchantCurrent={id:'next',target:'F'};s.commands.F={id:99,type:'character-travel'};
 const reply=f.send('orderComplete',{jobId:'job',character:'F',commandId:1,sent:[]});
 assert.equal(reply.body.stale,true);assert.equal(s.merchantCurrent.orderHandoff,undefined);assert.equal(s.commands.F.id,99);
});

for(const outcome of ['complete','job failure'])test('failed convoy permits stopped collection and preserves failure after '+outcome,()=>{
 const f=fixture(),s=f.state,c=s.activeConvoy;
 c.phase='failed';c.failure='Route exhausted';c.failureCode='route-failed';c.retryExhausted=true;c.recoveryAttempts=3;c.failedAt=900;
 const destination=structuredClone(c.location);
 assert.equal(f.send('handoff').body.waiting,true);
 f.tick();assert.equal(s.commands.F.phase,'shared-hold');
 f.ack();s.statuses.L.moving=true;f.tick();assert.equal(f.send('handoff').body.waiting,true);
 s.statuses.L.moving=false;s.statuses.L.seenAt=-5000;f.tick();assert.equal(s.commands.F.type,'party-monster-travel');
 f.ack();f.tick();assert.equal(f.send('handoff').body.ok,true);assert.equal(s.commands.F.type,'merchant-handoff');
 if(outcome==='complete')f.send('complete',{jobId:'job',character:'F',commandId:s.commands.F.id});
 else {require('../../runtime/coordinator/navigation/merchant-interruption.ts').releaseMerchantInterruption(s,'job');s.merchantCurrent=null;}
 f.tick();f.ack();f.tick();
 assert.equal(c.phase,'failed');assert.equal(c.failure,'Route exhausted');assert.equal(c.failureCode,'route-failed');
 assert.equal(c.retryExhausted,true);assert.equal(c.recoveryAttempts,3);assert.equal(c.failedAt,900);
 assert.deepEqual(c.location,destination);assert.equal(c.merchantInterruption,undefined);
 assert.equal(s.commands.F.phase,'hold');
});

test('failed non-preemptible convoy still refuses collection',()=>{
 const f=fixture(),s=f.state;s.activeConvoy.phase='failed';s.activeConvoy.nonPreemptible=true;
 assert.equal(f.send('handoff').body.deferred,true);assert.equal(s.activeConvoy.merchantInterruption,undefined);
});
