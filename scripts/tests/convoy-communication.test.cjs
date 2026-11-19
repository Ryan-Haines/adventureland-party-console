const test=require('node:test'),assert=require('node:assert/strict');

const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture,client,initialAssemblyCommunication}=require('./fixtures/convoy-communication-scenario.cjs');
scenarioTable('a lost heartbeat or a network failure holds the whole convoy and resumes only after a stable window (MOV-130)', fixture, [
 ['arrived completion retry does not become a shared communication hold', f=>{
 const c=f.p.activeConvoy;f.report(1000,'arrived');
 f.p.statuses.F.convoyNavigation.communication={operation:'/convoy-complete',kind:'timeout',since:900};
 f.step(1000);assert.equal(c.communicationHold,undefined);
 }],
 ['hours without reports do not consume movement budgets; the hold ends on the first round of fresh held reports', ()=>{
 // A report up to two of the member's own report
 // intervals late, with no attacker known, keeps the walk going. Past that, `runtime-lost` lets
 // the member go and the walk goes on without it.
 const late=fixture(),walk=late.p.activeConvoy;
 for(const s of Object.values(late.p.statuses))Object.assign(s,{reportIntervalMs:2000,groupedCombat:{currentAttackers:[],currentAttackersAt:1000}});
 late.step(4500);assert.notEqual(walk.phase,'communication-hold');assert.deepEqual(walk.participants,['L','F']);
 late.p.statuses.L.seenAt=5100;late.step(5100);assert.notEqual(walk.phase,'communication-hold');
 assert.deepEqual(walk.participants,['L']);assert.equal(late.p.commands.F,undefined);
 const known=fixture(),attacked=known.p.activeConvoy;
 for(const s of Object.values(known.p.statuses))Object.assign(s,{reportIntervalMs:2000,groupedCombat:{currentAttackers:[{id:'m',mtype:'bee',target:'L',map:'main'}],currentAttackersAt:1000}});
 known.step(4500);assert.equal(attacked.phase,'communication-hold');
 // Members whose reports stop during the hold leave too; the walk ends without spending a budget.
 const silent=fixture(),gone=silent.p.activeConvoy;silent.lose(5000);silent.step(5000);assert.equal(gone.phase,'communication-hold');
 silent.step(36000000);assert.equal(silent.p.activeConvoy,null);assert.deepEqual(gone.participants,[]);
 assert.equal(gone.ladderRung,undefined);assert.equal(gone.walkingFailures,2);assert.equal(silent.p.monsterHunt.returnRetries,3);
 const f=fixture(),c=f.p.activeConvoy;f.lose(5000);f.step(5000);assert.equal(c.phase,'communication-hold');
 f.lose(36000000);f.step(36000000);assert.equal(c.phase,'communication-hold');assert.equal(c.ladderRung,undefined);assert.equal(f.p.monsterHunt.returnRetries,3);
 f.report(36001000);f.step(36001000);assert.equal(c.phase,'shared-prepare');assert.equal(c.communicationHold,undefined);
 assert.equal(c.ladderRung,undefined);assert.equal(c.walkingFailures,2);assert.equal(f.p.monsterHunt.returnRetries,3);
 assert.equal(f.p.combatLogs.L.filter(l=>l.message==='Convoy communication lost').length,1);
 assert.equal(f.p.combatLogs.L.filter(l=>l.message==='Convoy communication restored').length,1);
 }],
 ['healthy travel restored after coordinator restart uses communication recovery rather than Hunt retries', f=>{
 f.restart(5000);f.seen(6000);f.step(6000);f.stable(7000);
 assert.equal(f.p.activeConvoy.phase,'shared-prepare');assert.equal(f.p.monsterHunt.returnRetries,3);
 }],
 ['restart with partially acknowledged arrival rebinds every participant', f=>{
 f.p.activeConvoy.completed=['F'];delete f.p.commands.F;f.restart(5000);f.seen(6000);f.step(6000);
 assert.ok(f.p.commands.F);f.stable(7000);assert.equal(f.p.activeConvoy.phase,'shared-prepare');
 assert.equal(f.p.activeConvoy.failureCode,undefined);assert.equal(f.p.monsterHunt.returnRetries,3);
 }],
 // A replaced runtime ends the walk with `runtime-lost` (movement-rules.test.cjs), and
 // the task's next request starts it over with the runtime now reporting.
 ['each restart resumes on the first round of fresh held reports, and a replacement runtime ends the walk with T5 runtime-lost', f=>{
 f.lose(5000);f.step(5000);f.report(6000);f.step(6000);f.restart(6500);f.step(6500);
 f.stable(7000);assert.equal(f.p.activeConvoy.communicationHold,undefined);
 f.restart(13000);f.step(13000);assert.equal(f.p.activeConvoy.phase,'communication-hold');
 f.report(14000);f.step(14000);assert.equal(f.p.activeConvoy.phase,'shared-prepare');
 f.p.statuses.F.combatSelection.runtimeId='replacement';f.step(14500);
 assert.equal(f.p.activeConvoy.phase,'failed');assert.equal(f.p.activeConvoy.failureCode,'runtime-lost');
 assert.equal(f.p.activeConvoy.walkingFailures,2);assert.equal(f.p.monsterHunt.returnRetries,3);
 }],
...['id','epoch','commandId','navigationRevision','runtimeId','routeVersion','manual','cancel'].map(mismatch=>['contradictory communication report cannot recover stale '+mismatch,f=>{
 const c=f.p.activeConvoy,report=f.p.statuses.F.convoyNavigation;
 Object.assign(report,{phase:'route-ready',failure:'Shared route coordinator signal expired',
  communication:{operation:'/status',kind:'expired-signal',since:900}});
 if(mismatch==='manual')f.p.commands.F={id:999,type:'character-travel'};
 else if(mismatch==='cancel')f.p.navigationIntents.F.cancelled=true;
 else report[mismatch]='old';
 f.step(1000);assert.equal(c.communicationHold,undefined);
 if(mismatch==='manual')assert.equal(f.p.commands.F.id,999);
}]),
...['manual','cancel','revision'].map(change=>['communication recovery respects '+change,f=>{
 f.lose(5000);f.step(5000);
 if(change==='manual')f.p.commands.F={id:999,type:'character-travel'};
 if(change==='cancel')f.p.navigationIntents.F.cancelled=true;
 if(change==='revision')f.p.navigationIntents.F.revision++;
 f.step(6000);assert.equal(f.p.activeConvoy.failureCode,'owner-lost');assert.equal(f.p.activeConvoy.communicationHold,undefined);
 if(change==='manual')assert.equal(f.p.commands.F.id,999);
}]),
...['moving','realm','dead','unacknowledged'].map(change=>['communication hold waits for '+change+' participant',f=>{
 f.lose(5000);f.step(5000);
 for(let t=6000;t<=14000;t+=1000){f.report(t);
  if(change==='moving')f.p.statuses.F.moving=true;
  if(change==='realm')f.p.statuses.F.server='EUI';
  if(change==='dead')f.p.statuses.F.rip=true;
  if(change==='unacknowledged')f.p.statuses.F.convoyNavigation.commandId--;
  f.step(t);
 }assert.equal(f.p.activeConvoy.phase,'communication-hold');
}]),
]);

// Native completion-request and completion-response loss journeys cover network recovery.
scenarioTable('an arrival acknowledgement retries only itself and a permanent error stays a failure (MOV-068)', client, [
 // No backoff and no jitter; each failed or waiting acknowledgement rides on the next report.
 ['a failed or waiting acknowledgement asks again after the next report, once per report', async f=>{
 let requests=0;f.r.request=async()=>{requests++;if(requests===1)throw Object.assign(Error('offline'),{partyRequest:{kind:'network'}});return requests===2?{waiting:true}:{ok:true};};
 const pending=f.start();await new Promise(setImmediate);await new Promise(setImmediate);
 assert.equal(requests,1,'no second request before the next report');
 await f.advance();assert.equal(requests,2,'the next report asks again');
 await f.advance();await pending;assert.equal(requests,3,'a waiting answer asks again after the following report');
 }],
 ['arrival retry is cancelled without another HTTP request', async f=>{
 let requests=0;f.r.request=async()=>{requests++;throw Object.assign(Error('offline'),{partyRequest:{kind:'network'}});};
 const pending=f.start();await new Promise(setImmediate);f.cancel();await f.advance();await pending;assert.equal(requests,1);
 }],
 ['permanent completion errors remain failures', async f=>{
 f.r.request=async()=>{throw Object.assign(Error('bad request'),{partyRequest:{kind:'http',status:400}});};
 await assert.rejects(f.start(),/bad request/);assert.equal(f.convoy.communication,undefined);
 }],
 ['permanent error after a transient failure cannot inherit the communication hold', async f=>{
 let requests=0;
 f.r.request=async()=>{requests++;throw Object.assign(Error(requests===1?'offline':'bad request'),{partyRequest:requests===1?{kind:'network'}:{kind:'http',status:400}});};
 const pending=assert.rejects(f.start(),/bad request/);await new Promise(setImmediate);
 for(let i=0;i<20&&requests<2;i++)await f.advance();await pending;assert.equal(f.convoy.communication,undefined);
 }],
...[{kind:'timeout',status:0},{kind:'http',status:408},{kind:'http',status:429},{kind:'http',status:503}].map(failure=>['arrival survives '+JSON.stringify(failure)+' and retries only the acknowledgement',async f=>{
 let requests=0;
 f.r.request=async(path,options)=>{assert.equal(path,'/convoy-complete');assert.equal(options.timeout,5000);requests++;
  if(requests===1)throw Object.assign(Error('connection failed'),{partyRequest:failure});return {ok:true};};
 const pending=f.start();await new Promise(setImmediate);assert.equal(f.convoy.phase,'arrived');assert.ok(f.convoy.communication);
 for(let i=0;i<20&&requests<2;i++)await f.advance();await pending;
 assert.equal(requests,2);assert.equal(f.convoy.phase,'arrived');assert.equal(f.convoy.communication,undefined);
}]),
]);


// One identity tuple check (design 8b item 5, sameWalk): a report that differs from the walk in any
// identity field, or one whose walk lost its owner, never recovers the walk's communication hold.
test('initial assembly communication rejects mismatched identity, owner, realm and operation fields',()=>{
// A report stamped ahead of the coordinator's clock is not repaired either: it counts as late
// so `runtime-lost` lets its member go as for any late report,
// and the follower follows its leader in place of the walk's command.
for(const mismatch of ['id','epoch','commandId','navigationRevision','runtimeId','expectedRuntime','observedRuntime','routeVersion','future','manual','cancel','realm','operation']){
 const f=initialAssemblyCommunication(),c=f.p.activeConvoy,s=f.p.statuses.F,n=s.convoyNavigation;
 if(mismatch==='expectedRuntime')c.expected.F.runtimeId='old';
 else if(mismatch==='observedRuntime')s.combatSelection.runtimeId='new';
 else if(mismatch==='future')s.seenAt=2000;
 else if(mismatch==='manual')f.p.commands.F={id:999,type:'character-travel'};
 else if(mismatch==='cancel')f.p.navigationIntents.F.cancelled=true;
 else if(mismatch==='realm')s.server='EU';
 else if(mismatch==='operation')n.communication.operation='/convoy-complete';
 else n[mismatch]='old';
 f.step(1000);
 assert.equal(c.communicationHold,undefined,mismatch);
 if(mismatch==='future'){assert.deepEqual(c.participants,['L'],mismatch);assert.equal(f.p.commands.F.type,'return-leader',mismatch);}
}
});
// The live reconnect row: a follower whose reports stop on the player's walk is let go (code
// `runtime-lost`), and the walk goes on with its leader. The follower's slot holds a return-leader
// command, so its first report after the reconnect follows the leader to the walk's end.
test('a follower let go for stopped reports on a player walk follows its leader once it reports again',()=>{
 const f=initialAssemblyCommunication(),c=f.p.activeConvoy,leaderCommand=f.p.commands.L;
 f.p.statuses.L.seenAt=10000;f.step(10000);
 assert.deepEqual(c.participants,['L']);assert.equal(f.p.commands.L,leaderCommand,'the leader keeps the walk');
 assert.equal(f.p.commands.F?.type,'return-leader','red before: the slot was empty and the follower stayed where it reconnected');
 assert.equal(f.p.commands.F.purpose,'farming-follow');
});
// A walk no player asked for lets a silent member go with no command: its own task brings it back.
test('a silent member of a walk no player asked for gets no follow command',()=>{
 const f=initialAssemblyCommunication(),c=f.p.activeConvoy;c.purpose='monster-hunt';
 f.p.statuses.L.seenAt=10000;f.step(10000);
 assert.deepEqual(c.participants,['L']);assert.equal(f.p.commands.F,undefined);
});

test('initial assembly planner timeout enters existing fresh hold recovery before runtimes are initialized',()=>{
 const f=initialAssemblyCommunication(),c=f.p.activeConvoy;f.step(1000);
 assert.equal(c.phase,'communication-hold');assert.equal(f.p.commands.F.phase,'shared-hold');
 f.stable(2000);assert.equal(c.phase,'shared-prepare');assert.equal(c.communicationHold,undefined);
 assert.equal(c.location.x,120);
});
test('completion receipt survives restart and cannot delete replacement commands',()=>{
 const {createConvoyAcknowledgementRoutes}=require('../../runtime/movement/coordinator/routes.ts');
 const {initialCommandState}=require('../../runtime/settings/coordinator/initial.ts');
 const f=fixture(),p=f.p,c=p.activeConvoy;
 c.participants=['L'];p.statuses.L.x=120;f.report(1000,'arrived');
 const cmd=p.commands.L;
 const body={character:'L',convoyId:'c',epoch:c.epoch,commandId:cmd.id,runtimeId:'L',navigationRevision:cmd.navigationRevision,routeVersion:c.routeVersion};
 let valid=true,persists=0;const routes=createConvoyAcknowledgementRoutes(p,{now:()=>1000,owned:()=>true,valid:()=>valid,persist:()=>persists++});
 const res=()=>({status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
 assert.equal(routes.complete({body},res()).body.ok,true);assert.equal(p.activeConvoy,null);
 Object.assign(p,initialCommandState(JSON.parse(JSON.stringify({convoyCompletionReceipts:p.convoyCompletionReceipts,commands:p.commands})),()=>2000));p.commands.L={id:999,type:'character-travel'};valid=false;
 assert.equal(routes.complete({body},res()).body.ok,true);assert.equal(p.commands.L.id,999);
});
test('missing heartbeat cannot silently remove a participant from the held Hunt',()=>{
 const {reconcileCurrentHuntParty}=require('../../runtime/hunting/coordinator/hunt.ts');
 const f=fixture();
 f.step(5000);f.p.statuses.L.seenAt=20000;
 assert.equal(reconcileCurrentHuntParty(f.p.monsterHunt,f.p,20000,()=>assert.fail('must retain convoy')),false);
 assert.deepEqual(f.p.monsterHunt.participants,['L','F']);
});
test('saved arrived completion-network hold migrates once without clearing actual movement counters',()=>{
 const f=fixture(),c=f.p.activeConvoy;
 Object.assign(c,{phase:'failed',failureCode:'route-failed',retryExhausted:true,
  failure:'Travel failed: F: POST /convoy-complete · network',
  failureDetails:{failureContext:{phase:'arrived',convoyId:'c',position:{...c.location},destination:{...c.location}}}});
 f.restart(5000);f.step(6000);f.stable(7000);
 const recovered=f.p.activeConvoy;assert.equal(recovered.phase,'shared-prepare');assert.equal(recovered.retryExhausted,false);
 assert.equal(recovered.communicationLegacyRecovered,true);assert.equal(recovered.walkingFailures,2);assert.equal(f.p.monsterHunt.returnRetries,3);
});
test('unrelated legacy route failure is not converted to communication recovery',()=>{
 const f=fixture(),c=f.p.activeConvoy;c.phase='failed';c.failure='Stalled walking movement';c.failureCode='route-failed';c.retryExhausted=true;
 f.step(5000);assert.equal(c.phase,'failed');assert.equal(c.communicationHold,undefined);
});
test('late route-ready after signal failure recovers a split Daisy return without spending retries',()=>{
 const f=fixture(),c=f.p.activeConvoy;
 f.report(1000,'arrived');f.p.statuses.L.x=120;
 Object.assign(f.p.statuses.F.convoyNavigation,{phase:'route-ready',routeReady:true,
  failure:'Shared route coordinator signal expired',communication:{operation:'/status',kind:'expired-signal',since:900}});
 f.step(1000);assert.equal(c.phase,'communication-hold');assert.equal(f.p.commands.L.phase,'shared-hold');
 f.stable(2000);assert.equal(c.phase,'shared-prepare');assert.equal(c.communicationHold,undefined);
 assert.equal(c.location.x,120);assert.equal(c.walkingFailures,2);assert.equal(f.p.monsterHunt.returnRetries,3);
 const {publishSharedRoute}=require('../../runtime/movement/coordinator/route-store.ts');
 const cmd=f.p.commands.L;
 assert.equal(publishSharedRoute(f.p,{character:'L',convoyId:c.id,epoch:c.epoch,commandId:cmd.id,
  navigationRevision:cmd.navigationRevision,runtimeId:'L',routeVersion:c.routeVersion,
  route:{version:c.routeVersion,geometry:{version:1,fingerprint:'test'},origin:c.rally,destination:c.location,
   plot:[c.location],source:'remainder'}},7000),null);
 for(const s of Object.values(f.p.statuses))s.x=120;
 for(let observedAt=7000;observedAt<=20000 && f.p.activeConvoy;observedAt+=500){
  const departed=c.departAt && observedAt>=c.departAt;
  f.report(observedAt,departed?'arrived':'route-ready');
  for(const s of Object.values(f.p.statuses))Object.assign(s.convoyNavigation,{routeReady:true,departedAt:departed?c.departAt:null});
  f.step(observedAt);
 }
 assert.equal(f.p.activeConvoy,null,'all participants must reach Daisy before completion');
});
test('minimush travel recovers a restarted phoenix interruption through defense, loot and regroup',()=>{
 const defense=require('../../runtime/movement/coordinator/defense.ts');
 const {updateHuntTravel}=require('../../runtime/coordinator/targeting/hunt-travel.ts');
 require('./helpers/requesters.cjs').publishPresence();
 const f=fixture(defense.step),p=f.p;
 Object.assign(p.activeConvoy,{continuousReturn:undefined,returnRouting:false,huntTarget:'minimush',label:'minimush',requester:{kind:'group-walk',owner:'monster-hunt',tier:'hunt-mission'}});
 p.passiveHunting={rules:{phoenix:{enabled:true,keepMoving:false,priority:100}}};
 p.monsterHunt.stage='mission-travel';p.monsterHunt.target='minimush';
 const destination=JSON.stringify(p.activeConvoy.location);
 const phoenix={id:'old-phoenix',mtype:'phoenix',map:'main',in:'main',server:'USII',x:20,y:0,hp:100};
 function observations(at){for(const s of Object.values(p.statuses)){
  s.in='main';s.groupedCombat||={currentAttackers:[],sightings:[],travelCandidates:[],deaths:[]};
  s.groupedCombat.currentAttackersAt=at;s.groupedCombat.observationAt=at;
 }}
 observations(1000);p.statuses.L.groupedCombat.travelCandidates=[phoenix];
 f.step(1000);assert.equal(p.activeConvoy.phase,'defending');
 f.restart(2000);f.step(2000);
 // Fresh combat reports cannot substitute for the command's held acknowledgement.
 for(let t=3000;t<=9000;t+=1000){f.report(t,'defending');observations(t);f.step(t);}
 assert.equal(p.activeConvoy.phase,'communication-hold');assert.match(p.activeConvoy.failure,/L:.*held.*defending/);
 for(let t=10000;t<=15000;t+=1000){f.report(t);observations(t);f.step(t);}
 assert.equal(p.activeConvoy.communicationHold,undefined);assert.equal(p.activeConvoy.phase,'defending');
 assert.equal(p.commands.L.phase,'defending');
 p.statuses.L.groupedCombat.deaths=[{...phoenix,at:15001}];
 // Keep the dead sighting and passive-stop reason, as seen in the restored snapshot.
 p.activeConvoy.defenseTargets=[{...phoenix,at:1000},{...phoenix,id:'inactive-hawk',mtype:'hawk',at:1000}];
 f.report(16000);observations(16000);f.step(16000);
 assert.equal(p.activeConvoy.huntTravel.reason,undefined);assert.deepEqual(p.activeConvoy.huntTravel.committed,[]);
 assert.ok(p.activeConvoy.loot);assert.equal(p.activeConvoy.phase,'defending');
 const members=Object.entries(p.statuses).map(([name,status])=>({name,status,ctype:'warrior',revision:2}));
 updateHuntTravel(p.activeConvoy,members,16000,undefined,p.passiveHunting,()=>true);
 assert.equal(p.activeConvoy.huntTravel.primary,null,'stale phoenix cannot reacquire');
 p.statuses.L.convoyLoot={...p.activeConvoy.loot,complete:true,observedAt:16001};
 f.report(16001);observations(16001);f.step(16001);assert.equal(p.activeConvoy.phase,'shared-hold');
 for(let t=17000;t<=22000;t+=1000){f.report(t);observations(t);f.step(t);}
 assert.equal(p.activeConvoy.phase,'shared-prepare');assert.equal(JSON.stringify(p.activeConvoy.location),destination);
 assert.equal(p.monsterHunt.target,'minimush');assert.equal(p.monsterHunt.stage,'mission-travel');
});
