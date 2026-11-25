const {productionFunction} = require('./helpers/production-functions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// sharedMovementOptions names its walk through the movement requesters (runtime/movement/character/owner.ts).
const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
const timeout=()=>Object.assign(new Error('timeout'),{partyRequest:{path:'/movement-barrier',kind:'timeout',status:0}});
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/barrier-communication-scenario.cjs');
// The barrier rides on the member's reports. A lost
// send answers not ready after the member's next report and the executor asks again, so no backoff,
// count or budget bounds it; a rejection still fails at once.
scenarioTable('a barrier request holds on an outage and never hides a rejection (MOV-130)', fixture, [
 ['disabled Town is excluded from every shared walking planner including event retries', f=>{
 for(const extra of [{purpose:'shared-walk'},{purpose:'shared-walk-return'},
 {purpose:'monster-hunt',phase:'plan-return',allowTown:true},{routeRecovery:{relocation:'town'}}]){
  assert.equal(f.c.sharedMovementOptions({...f.command,continuousReturn:undefined,...extra,disableTown:true}).town,false);
 }
 assert.equal(f.c.sharedMovementOptions({...f.command,continuousReturn:undefined,purpose:'shared-walk'}).town,true);
 }, ()=>({ready:true})],
 ['legacy migration requires owned capture and communication-only failure history', ()=>{
 const {capturedCommunicationFailure}=require('../../runtime/movement/coordinator/defense.ts');
 const c={id:'C',epoch:2,phase:'failed',recoveryAttempts:1,failureDetails:{failureContext:{convoyId:'C',epoch:2}},failure:'Return route held after two planning cycles; first: GermanicHP: Shared route coordinator signal expired; latest: QwenTina: Error: Error: POST /movement-barrier · timeout'};
 assert.equal(capturedCommunicationFailure(c),true);assert.equal(capturedCommunicationFailure({...c,epoch:3}),false);assert.equal(capturedCommunicationFailure({...c,communicationLegacyRecovered:true}),false);
 assert.equal(capturedCommunicationFailure({...c,failure:c.failure.replace('Shared route coordinator signal expired','No path found')}),false);
 }],
 ['restart recovers a captured communication-only shared-walk failure into a communication hold', ()=>{
 const {initialCommandState}=require('../../runtime/settings/coordinator/initial.ts');
 const saved={id:'C',epoch:2,phase:'failed',purpose:'shared-walk',routeProtocol:4,continuousReturn:1,participants:['W'],expected:{W:{revision:4}},recoveryAttempts:1,retryExhausted:true,
 failureCode:'route-failed',failureDetails:{failureContext:{convoyId:'C',epoch:2}},failure:'Return route held after two planning cycles; first: GermanicHP: Shared route coordinator signal expired; latest: QwenTina: Error: Error: POST /movement-barrier · timeout'};
 const restored=initialCommandState({activeConvoy:saved},()=>1000).activeConvoy;
 assert.equal(restored.phase,'communication-hold');assert.equal(restored.communicationLegacyRecovered,true);
 }],
 ['permanent HTTP rejection does not retry', async f=>{
 await assert.rejects(f.run(false));assert.equal(f.calls(),1);
 }, ()=>{throw Object.assign(new Error('invalid'),{partyRequest:{kind:'http',status:409}});}],
 ['request preserves typed barrier rejection code through the HTTP boundary', async ()=>{
 let fail;
 // The request's refusal text is the status owner's (shared.js `root.partyStatus.diagnosticText`, telemetry.ts).
 const c=createMovementContext({api:'http://localhost',root:{partyStatus:{diagnosticText:require('../../runtime/status/character/telemetry.ts').diagnosticText}},
  Date,Number,String,Error,Promise,travelRequest:()=>({succeeded(){},failed(){}}),
  $:{ajax:()=>({done(){return this;},fail(fn){fail=fn;}})}});
 vm.runInContext(productionFunction('request'),c);
 const pending=c.request('/movement-barrier',{method:'POST'});
 const rejected=assert.rejects(pending,e=>e.partyRequest.code==='superseded' && e.partyRequest.status===409 && e.partyRequest.path==='/movement-barrier');
 fail({status:409,responseJSON:{error:'Stale movement barrier owner',code:'superseded'}},'error','Conflict');
 await rejected;
 }],
 ['an outage answers not ready after the next report, one send per ask (red: backs off and resends up to 10 s)', async f=>{
 assert.equal(await f.run(false),false);assert.equal(f.calls(),1);
 assert.equal(await f.run(false),false);assert.equal(f.calls(),2,'the executor\'s next ask sends once more');
 }, ()=>{throw timeout();}],
 ['late successful response cannot release a superseded transition', async f=>{
 await assert.rejects(f.run(false),/superseded/);assert.equal(f.calls(),1);
 }, (n,c)=>{c.groupWalk.travel.commandId=99;return {ready:true};}],
 ['superseded barrier metadata classifies cancellation without hiding other errors', ()=>{
 const {movementFailureCause}=require('../../runtime/movement/character/records.ts');
 for(const [path,status,code,expected] of [
  ['/movement-barrier',409,'superseded','superseded'],
  ['/movement-barrier',409,'invalid-step',undefined],
  ['/movement-plan',409,'superseded',undefined],
  ['/movement-barrier',503,'superseded','convoy-communication-hold'],
 ]) {
  const error=Object.assign(Error('rejected'),{partyRequest:{path,status,code,kind:'http'}});
  assert.equal(movementFailureCause(error).code,expected);
 }
 }],
 ...[false,true].map(completed=>{const bodies=[];return ['lost '+(completed?'arrival':'departure')+' response asks again with the same barrier identity on the next ask',async f=>{
  assert.equal(await f.run(completed),false,'the lost send answers not ready');
  assert.equal(await f.run(completed),true);assert.equal(f.calls(),2);assert.deepEqual(JSON.parse(JSON.stringify(bodies[0])),JSON.parse(JSON.stringify(bodies[1])));
 },(count,c,args)=>{bodies.push(args[1].body);if(count===1)throw timeout();return {ready:true};}];}),
 // A lease still on its way (missing or expired) is a missed report: not ready after the next report.
 // A newer owner's lease supersedes the barrier.
 ...['command','epoch','route','missing','expired'].map(change=>['barrier admission distinguishes ownership loss from lease loss: '+change,async f=>{
  if(change==='command')f.c.groupWalk.travel.commandId++;
  if(change==='epoch')f.c.groupWalk.signal.epoch++;
  if(change==='route')f.c.groupWalk.signal.routeVersion++;
  if(change==='missing')f.c.groupWalk.signal=null;
  if(change==='expired')f.c.groupWalk.signal.validUntil=0;
  if(['missing','expired'].includes(change))assert.equal(await f.run(false),false);
  else await assert.rejects(f.run(false),e=>e.partyRequest.kind==='aborted');
  assert.equal(f.calls(),0);
 },()=>assert.fail('must not send a stale barrier')]),
 ...[
  ['owned evacuation door',{purpose:'franky-exit',navigationExempt:true,combatHandoffAllowed:false},false,false,true,true],
  ['ordinary door',{purpose:'party-travel'},false,false,true,false],
  ['unexempt exit',{purpose:'franky-exit',combatHandoffAllowed:false},false,false,true,false],
  ['combat handoff exit',{purpose:'franky-exit',navigationExempt:true,combatHandoffAllowed:true},false,false,true,false],
  ['other exempt route',{purpose:'party-travel',navigationExempt:true,combatHandoffAllowed:false},false,false,true,false],
  ['evacuation Town',{purpose:'franky-exit',navigationExempt:true,combatHandoffAllowed:false},true,false,true,false],
  ['evacuation pending loot',{purpose:'franky-exit',navigationExempt:true,combatHandoffAllowed:false},false,true,true,false],
  ['evacuation unavailable Town',{purpose:'franky-exit',navigationExempt:true,combatHandoffAllowed:false},true,false,false,false],
 ].map(([label,flags,town,loot,canTown,expected])=>['living attacker transition readiness: '+label,async f=>{
  delete f.command.continuousReturn;Object.assign(f.command,flags);
  f.c.departureCombatPending=()=>true;f.c.eligibleDepartureChests=()=>loot?[{id:'loot'}]:[];f.c.can_use=()=>canTown;
  assert.equal(await f.c.sharedMovementOptions(f.command).barrier({map:'level2n',x:-416,y:0,transport:!town,town},0,false),expected);
 },(count,c,args)=>({ready:args[1].body.ready})]),
]);
