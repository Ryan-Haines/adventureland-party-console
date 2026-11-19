const test = require('node:test'), assert = require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/merchant-convoy-interruption-scenario.cjs');
// The rows from 'merchant collection waits for communication recovery' to 'collection during
// assembly' are rows cut with no removal line. A replaced member's walk now ends by `owner-lost`
// (walk.ts, `replaced`), where v1.5.0 kept it `failed`.
scenarioTable('a merchant collection resumes the convoy only after every member stopped', fixture, [
 ['failed convoy permits stopped collection and preserves failure after complete', f=>{
 const s=f.state,c=s.activeConvoy,outcome='complete';
 c.phase='failed';c.failure='Route exhausted';c.failureCode='route-failed';c.retryExhausted=true;c.failedAt=900;
 const destination=structuredClone(c.location);
 assert.equal(f.send('handoff').body.waiting,true);
 f.tick();assert.equal(s.commands.F.phase,'shared-hold');
 f.ack();s.statuses.L.moving=true;f.tick();assert.equal(f.send('handoff').body.waiting,true);
 // L's report is 3.5 s old: inside two of its 2 s intervals it keeps L in the walk, but past the 3 s report age it does not count as stopped.
 s.statuses.L.moving=false;s.statuses.L.reportIntervalMs=2000;s.statuses.L.seenAt=-2500;f.tick();
 assert.deepEqual(c.participants,['L','F','P']);assert.equal(s.commands.F.type,'party-monster-travel');
 f.ack();f.tick();assert.equal(f.send('handoff').body.ok,true);assert.equal(s.commands.F.type,'merchant-handoff');
 if(outcome==='complete')f.send('complete',{jobId:'job',character:'F',commandId:s.commands.F.id});
 else {require('../../runtime/movement/coordinator/defense.ts').releaseMerchantInterruption(s,'job');s.merchantCurrent=null;}
 f.tick();f.ack();f.tick();
 assert.equal(c.phase,'failed');assert.equal(c.failure,'Route exhausted');assert.equal(c.failureCode,'route-failed');
 assert.equal(c.retryExhausted,true);assert.equal(c.ladderRung,undefined);assert.equal(c.failedAt,900);
 assert.deepEqual(c.location,destination);assert.equal(c.merchantInterruption,undefined);
 assert.equal(s.commands.F.phase,'hold');
 }],
 ['failed convoy permits stopped collection and preserves failure after job failure', f=>{
 const s=f.state,c=s.activeConvoy,outcome='job failure';
 c.phase='failed';c.failure='Route exhausted';c.failureCode='route-failed';c.retryExhausted=true;c.failedAt=900;
 const destination=structuredClone(c.location);
 assert.equal(f.send('handoff').body.waiting,true);
 f.tick();assert.equal(s.commands.F.phase,'shared-hold');
 f.ack();s.statuses.L.moving=true;f.tick();assert.equal(f.send('handoff').body.waiting,true);
 // L's report is 3.5 s old: inside two of its 2 s intervals it keeps L in the walk, but past the 3 s report age it does not count as stopped.
 s.statuses.L.moving=false;s.statuses.L.reportIntervalMs=2000;s.statuses.L.seenAt=-2500;f.tick();
 assert.deepEqual(c.participants,['L','F','P']);assert.equal(s.commands.F.type,'party-monster-travel');
 f.ack();f.tick();assert.equal(f.send('handoff').body.ok,true);assert.equal(s.commands.F.type,'merchant-handoff');
 if(outcome==='complete')f.send('complete',{jobId:'job',character:'F',commandId:s.commands.F.id});
 else {require('../../runtime/movement/coordinator/defense.ts').releaseMerchantInterruption(s,'job');s.merchantCurrent=null;}
 f.tick();f.ack();f.tick();
 assert.equal(c.phase,'failed');assert.equal(c.failure,'Route exhausted');assert.equal(c.failureCode,'route-failed');
 assert.equal(c.retryExhausted,true);assert.equal(c.ladderRung,undefined);assert.equal(c.failedAt,900);
 assert.deepEqual(c.location,destination);assert.equal(c.merchantInterruption,undefined);
 assert.equal(s.commands.F.phase,'hold');
 }],
 ['commerce pauses, timeout waits for stopped acknowledgement, and stale completion cannot clear travel', f=>{
 const s=f.state;s.merchantCurrent.reason='merchant commerce';s.merchantCurrent.order={sources:{F:[]}};
  f.send('order');f.tick();f.ack();f.tick();f.send('order');const old=s.commands.F;
  // The members keep reporting through the pause; a silent one would leave the walk (`runtime-lost`).
  f.seen(62000);f.tick(62000);assert.equal(s.commands.F.phase,'shared-hold');assert.ok(s.activeConvoy.merchantInterruption);
  f.ack();f.tick();assert.equal(s.activeConvoy.phase,'shared-prepare');const current=s.commands.F;
  f.send('orderComplete',{jobId:'job',character:'F',commandId:old.id,sent:[]});assert.equal(s.commands.F,current);
 }],
 ['merchant collection waits for communication recovery without capturing its internal phase', f=>{
  const s=f.state;
  // F's own report names the hold, which defense.ts communicationReport reads while the report is fresh.
  f.ack();Object.assign(s.statuses.F.convoyNavigation,{phase:'communication-hold',communication:{operation:'/status',kind:'expired-signal'}});
  f.tick();assert.equal(s.activeConvoy.phase,'communication-hold');
  assert.equal(f.send('handoff').body.waiting,true);assert.equal(s.activeConvoy.merchantInterruption,undefined);
  for(let time=1000;time<=8000;time+=1000){f.ack();f.tick(time);}
  assert.equal(s.activeConvoy.communicationHold,undefined);
  assert.equal(f.send('handoff').body.waiting,true);assert.equal(s.activeConvoy.merchantInterruption.resumePhase,'shared-prepare');
 }],
 ['legacy merchant continuation captured during communication recovery prepares a new route', f=>{
  const s=f.state,c=s.activeConvoy,destination=c.location;
  f.send('handoff');c.merchantInterruption.resumePhase='communication-hold';
  f.tick();f.ack();f.tick();f.send('handoff');
  f.send('complete',{jobId:'job',character:'F',commandId:s.commands.F.id});
  f.tick();f.ack();f.tick();
  assert.equal(c.phase,'shared-prepare');assert.equal(c.location,destination);
  for(const command of Object.values(s.commands))assert.equal(command.phase,'shared-prepare');
  assert.equal(c.merchantInterruption,undefined);
 }],
 ['manual navigation supersedes the saved merchant continuation', f=>{
  const s=f.state;f.send('handoff');f.tick();
  s.navigationIntents.F.revision++;s.commands.F={id:999,type:'character-travel'};
  f.tick();assert.equal(s.commands.F.id,999);assert.equal(s.activeConvoy,null,'the walk ends replaced, its interruption with it');
 }],
 ['merchant collection cannot replace the event-return parent between walking legs', f=>{
  const s=f.state;s.activeConvoy=null;s.commands.F={id:42,type:'event-return-town',cycleId:'return'};
  assert.equal(f.send('handoff').body.waiting,true);assert.equal(s.commands.F.id,42);
 }],
 ['another recipient must wait for the first collection to release the convoy', f=>{
  const s=f.state;f.send('handoff');f.tick();f.ack();f.tick();f.send('handoff');
  s.merchantCurrent.reason='merchant commerce';s.merchantCurrent.order={sources:{P:[]}};
  assert.equal(f.send('order',{jobId:'job',target:'P'}).body.waiting,true);assert.equal(s.commands.P.type,'party-monster-travel');
 }],
 ['collection during assembly initializes stop acknowledgements before the first shared route', f=>{
  const s=f.state;s.activeConvoy.phase='assemble';s.activeConvoy.runtimes=null;
  f.send('handoff');f.tick();f.ack();f.tick();f.send('handoff');assert.equal(s.commands.F.type,'merchant-handoff');
  f.send('complete',{jobId:'job',character:'F',commandId:s.commands.F.id});f.tick();f.ack();f.tick();
  assert.equal(s.activeConvoy.phase,'assemble');assert.equal(s.activeConvoy.merchantInterruption,undefined);
 }],
]);

// v1.5.0's walk purposes beside the Hunt walk: each pauses, collects once and resumes where it
// was going.
scenarioTable('every walk purpose pauses all members, collects once, and resumes its destination', fixture,
 ['shared-walk-return','event-return','empty-spawn-recovery'].map(purpose=>[purpose, f=>{
  const s=f.state,c=s.activeConvoy;
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
 }, purpose]));

// The merchant job owner's endings of a job during a collection (owner.ts endMerchantJob):
// each one releases the walk to its destination, and the collection's late reply is stale. the
// earlier console's 20 rows over four walk purposes cut them with no removal line.
const {pauseCurrentJob}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
const {createMerchantControlRoutes}=require('../../runtime/merchant-jobs/coordinator/routes.ts');
const {createMerchantCompletion}=require('../../runtime/merchant-jobs/coordinator/endings.ts');
const ends={
 failure(s){
  const base=require('./helpers/coordinator-completion.cjs').fixture({});Object.assign(base.state,s);
  createMerchantCompletion(base.state,base.ports).complete(base.state.merchantCurrent,{success:false,error:'Merchant died during rendezvous'});
  s.merchantCurrent=base.state.merchantCurrent;
 },
 timeout(s){s.merchantCurrent=null;delete s.commands.F;},
 realm(s){pauseCurrentJob(s,'realm',()=>1000,j=>j);},
};
for(const route of ['clear','force'])ends[route]=s=>createMerchantControlRoutes(s,{nextCommand:()=>999,now:()=>1000,stamp:j=>j,log(){},persist(){},dispatch(){},
 automated:()=>false,write:()=>({ok:true}),realm:{want:()=>'here',release(){},retry(){}},realmLabel:r=>r})[route]({body:{enabled:true}},{status(){return this;},json(){}});
scenarioTable('a merchant job that ends during a collection resumes the walk and refuses the late handoff', fixture,
 ['monster-hunt','shared-walk-return','event-return','empty-spawn-recovery'].flatMap(purpose=>Object.keys(ends).map(end=>[purpose+' resumes after merchant '+end, f=>{
  const s=f.state,c=s.activeConvoy,destination=structuredClone(c.location);
  f.send('handoff');f.tick();f.ack();f.tick();f.send('handoff');const old=s.commands.F;
  Object.assign(s,{merchantQueue:[],merchantForceStand:false,gatheringModes:[],activeRealm:'USII'});
  ends[end](s);
  f.tick();f.ack();f.tick();assert.equal(c.phase,'shared-prepare');assert.deepEqual(c.location,destination);
  const next=s.commands.F,reply=f.send('complete',{jobId:'job',character:'F',commandId:old.id});
  assert.equal(reply.body.stale,true);assert.equal(s.commands.F,next);assert.equal(c.merchantInterruption,undefined);
 }, purpose])));

scenarioTable('a job end and a late receipt keep newer commands', fixture, [
 ['job release keeps newer commands and equipment ownership intact', f=>{
  const {releaseMerchantInterruption}=require('../../runtime/movement/coordinator/defense.ts');
  const s=f.state;f.send('handoff');f.tick();f.ack();f.tick();f.send('handoff');
  s.commands.F={id:999,type:'character-travel'};s.navigationIntents.F.revision++;
  releaseMerchantInterruption(s,'job');s.merchantCurrent=null;f.tick();
  assert.equal(s.commands.F.id,999);assert.equal(s.activeConvoy,null,'the replaced walk ends');
 }],
 ['late commerce receipt for an ended job does not overwrite the next job', f=>{
  const s=f.state;s.merchantCurrent={id:'next',target:'F'};s.commands.F={id:99,type:'character-travel'};
  const reply=f.send('orderComplete',{jobId:'job',character:'F',commandId:1,sent:[]});
  assert.equal(reply.body.stale,true);assert.equal(s.merchantCurrent.orderHandoff,undefined);assert.equal(s.commands.F.id,99);
 }],
]);

// The events owner's event return over a walk the merchant pause left failed (returns.ts
// reconcile): v1.5.0's two rows cut with no removal line. The members stand in Main
// Town, which the Town reading (occurrences.ts inMainTown) needs a position for.
const {createCoordinatorEventReturns}=require('../../runtime/events/coordinator/returns.ts');
const {installTasksOver}=require('./helpers/tasks-owner.cjs'),{createRegistry}=require('../../runtime/hooks/registry.ts');
function snowmanExit(map){
 const names=['L','F','P'],cycleId='snowman-return',checkpoint={map:'halloween',x:-509,y:-626};
 const state={nextCommandId:100,merchantCharacter:'M',leader:'L',followers:{F:true,P:true},eventReturnLast:null,deferredEventReturns:{},townCycle:null,anniversary:{},eventSessions:{},commands:{},
  eventReturn:{cycleId,event:'snowman',participants:names.slice(),pending:[],checkpoint,waypoints:Object.fromEntries(names.map(n=>[n,{revision:1,location:checkpoint}]))},
  statuses:Object.fromEntries(names.map(n=>[n,{map,x:0,y:0,seenAt:1000}])),
  activeConvoy:{id:'old',phase:'failed',purpose:'shared-walk-return',walkingActivity:'event-return',participants:names,
   walkingParents:Object.fromEntries(names.map(n=>[n,{revision:1,command:{cycleId,type:'event-return-town'}}]))}};
 for(const n of names)state.commands[n]={id:2,type:'party-monster-travel',convoyId:'old'};
 installTasksOver(state,{hooks:createRegistry(),now:()=>1000});
 const out={state,names,checkpoint,dispatched:0};
 out.service=createCoordinatorEventReturns(state,{now:()=>1000,nextCommand:()=>state.nextCommandId++,activeNames:()=>names,enabled:()=>true,checkpoint:()=>checkpoint,
  cancelConvoy(){state.activeConvoy=null;},startConvoy:()=>false,anniversaryParticipants:()=>[],persist(){},huntCycle:()=>false,
  navigation:{capture:()=>Object.fromEntries(names.map(n=>[n,{revision:1,location:checkpoint}])),
   dispatch(owner){out.dispatched++;assert.deepEqual(owner.checkpoint,checkpoint);owner.returnDispatchedAt=1000;return true;},reconcile:()=>true,finish(){}}});
 return out;
}
scenarioTable('an orphaned Snowman exit releases recovery without losing the checkpoint', snowmanExit, [
 ['in main the checkpoint walk starts at once', x=>{
  x.service.reconcile();assert.equal(x.state.activeConvoy,null);assert.equal(x.dispatched,1);
  x.service.reconcile();assert.equal(x.state.eventReturn,null);
 }, 'main'],
 ['in winterland every member casts Town first', x=>{
  x.service.reconcile();assert.equal(x.state.activeConvoy,null);
  assert.deepEqual(x.state.eventReturn.pending,x.names);assert.equal(x.state.commands.F.type,'event-return-town');assert.equal(x.dispatched,0);
 }, 'winterland'],
]);
