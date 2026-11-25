const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createMerchantDispatcher,coordinatorReadyFacts}=require('../../runtime/merchant-jobs/coordinator/dispatch.ts');
const {selectMerchantJob}=require('../../runtime/merchant-jobs/rules.ts');
const {partyHooks}=require('../../runtime/hooks/index.ts');
// No Cave run owns a member here.
partyHooks().publish({name:'core:merchant-party-realm-reads',folder:'core',author:'test',summary:'No Cave run owns a member.',
 hooks:{'cave.state':()=>({owned:false})}});
function fixture(headless=true){
 let now=100000;
 const state={queue:[],current:null}, logs=[],travel=[],commands=[];
 const statuses={M:{seenAt:now,server:'USII'},P:{seenAt:now,server:'USIV'}};
 const policy={now,priority:j=>j.priority,capacityBlocked:()=>false,collectionReady:()=>true};
 const ports={now:()=>now,merchant:()=> 'M',status:n=>statuses[n],headless:()=>headless,
  travel:async realm=>{travel.push(realm);},persist(){},log:(...args)=>logs.push(args),
  nextCommand:()=>now,returningHome:()=>false,ensureHome(){throw Error('party visit must not return home first');},
  routineNeedsHome:()=>true,bankboi:()=>false,
  anniversary:()=>({}),forcedStand:()=>false,manualEquipmentPending:()=>false,gatheringModes:()=>[],gathering:()=>[],gatheringNoTool:()=>({}),
  gatheringCooldown:()=>0,routinePriority:()=>0,priority:j=>j.priority,capacityBlocked:()=>false,collectionReady:()=>true,
  pick(){policy.now=now;const i=selectMerchantJob(state.queue,policy);return i===null?null:state.queue.splice(i,1)[0];},
  stamp:j=>j,planPonty:list=>list,
  inputs:()=>({merchant:'M',activeRealm:'SR_USII',npcSales:[],statScrolls:{},work:()=>({autoCompounds:[]}),restock:()=>({}),workingGold:0,visitWithdrawals:()=>[]}),
  command:(...args)=>commands.push(args),idle(){}};
 const records={merchantCharacter:'M',statuses,bankbois:{},withdrawals:{},nextCommandId:1};
 require('./helpers/coordinator-merchant.cjs').itemsDoor(records);
 // The coordinator composition reads the ready facts off its records; the fixture plants the same reader.
 ports.readyFacts=()=>coordinatorReadyFacts(records,ports);
 const dispatcher=createMerchantDispatcher(state,ports);
 function tick(ms=100){now+=ms;for(const s of Object.values(statuses))s.seenAt=now;dispatcher.dispatch();}
 return {state,statuses,ports,logs,travel,commands,tick,dispatcher,advance(ms){now+=ms;}};
}
const party=()=>({id:'party',reason:'inventory cleanout',target:'P',priority:95,queuedAt:1});
const ponty=()=>({id:'ponty',reason:'Ponty purchases',target:'M',priority:75,queuedAt:2,listings:[],pontyPlanned:true});

test('routine dispatch and realm travel wait for a gathering cast',()=>{
 const f=fixture();f.state.queue.push(party());f.statuses.M.gatheringPhase='cast';f.tick();
 assert.equal(f.state.current,null);assert.deepEqual(f.travel,[]);assert.equal(f.state.queue.length,1);
 f.statuses.M.gatheringPhase='cooldown';f.tick();assert.deepEqual(f.travel,['SR_USIV']);
});
test('headless party visit switches once, waits for new realm observation, then dispatches service',()=>{
 const f=fixture();f.state.queue.push(party());f.tick();
 assert.equal(f.state.current.phase,'switching party realm');assert.deepEqual(f.travel,['SR_USIV']);
 for(let i=0;i<20;i++)f.tick();assert.equal(f.travel.length,1);assert.equal(f.commands.length,0);
 f.statuses.M.server='SR_USIV';f.tick();assert.equal(f.state.current.phase,'assigned');
 assert.equal(f.commands[0][1].targetRealm,'USIV');assert.equal(f.travel.length,1);
});
test('Steam mismatch defers P95 and dispatches P75 Ponty in the same pass',()=>{
 const f=fixture(false);f.ports.routineNeedsHome=()=>false;f.state.queue.push(party(),ponty());f.tick();
 assert.equal(f.state.current.id,'ponty');assert.equal(f.travel.length,0);
 assert.equal(f.state.queue[0].realmError,'merchant job failed: wrong realm (target was on US IV)');
 const errors=f.logs.filter(e=>e[1]==='error').length;f.tick();assert.equal(f.logs.filter(e=>e[1]==='error').length,errors);
 f.state.current=null;f.statuses.P.server='USII';f.tick();assert.equal(f.state.current.id,'party');
});
test('offline target cannot starve eligible purchases',()=>{
 const f=fixture();delete f.statuses.P;f.ports.routineNeedsHome=()=>false;f.state.queue.push(party(),ponty());f.tick();
 assert.equal(f.state.current.id,'ponty');assert.match(f.state.queue[0].realmBlockedReason,/fresh/);
});
// Realm half: no count blocks a party visit's realm switch; each missed window requeues it on
// v1.5.0's 10 s and books a ladder failure at its next claim (the old row asserted
// the block after three, 00-method answer 3).
test('realm timeouts retry at every count, book the ladder, and allow other work',()=>{
 const f=fixture();f.ports.routineNeedsHome=()=>false;f.state.queue.push(party());
 for(let attempt=0;attempt<4;attempt++){
  f.tick(10000);assert.equal(f.state.current.phase,'switching party realm');
  f.tick(60001);assert.equal(f.state.current,null);
  assert.equal(f.state.queue[0].ladderDue,'realm-switch');assert.equal(f.state.queue[0].realmAttempts,attempt+1);
 }
 assert.equal(f.travel.length,4);assert.equal(f.state.queue[0].realmRetryExhausted,undefined);
 // The party visit's retry time is ahead, so the Ponty job runs first.
 f.state.queue.push(ponty());assert.ok(f.state.queue.find(job=>job.id==='party').retryAt>0);f.tick(100);assert.equal(f.state.current.id,'ponty');
});
test('same-realm visit skips reconnect and accepts normalized realm names',()=>{
 const f=fixture();f.statuses.P.server='SR_USII';f.state.queue.push(party());f.tick();
 assert.equal(f.state.current.phase,'assigned');assert.equal(f.travel.length,0);
});
test('cancelled realm transition cannot resurrect a job when its restart later fails',async()=>{
 const f=fixture();let reject;f.ports.travel=()=>new Promise((_,r)=>reject=r);
 f.state.queue.push(party());f.tick();f.state.current=null;reject(Error('late'));await Promise.resolve();
 assert.deepEqual(f.state.queue,[]);
});
test('target changing realm during reconnect defers the job rather than dispatching stale coordinates',()=>{
 const f=fixture();f.state.queue.push(party());f.tick();
 f.statuses.M.server='USIV';f.statuses.P.server='USV';f.tick();
 assert.equal(f.state.current,null);assert.equal(f.commands.length,0);assert.equal(f.travel.length,1);
 f.tick(10000);assert.deepEqual(f.travel,['SR_USIV','SR_USV']);
});
test('realm retry commits completed improvements and preserves only undelivered improved items',()=>{
 const {fixture:completionFixture}=require('./helpers/coordinator-completion.cjs');
 const {createMerchantCompletion}=require('../../runtime/merchant-jobs/coordinator/endings.ts');
 const f=completionFixture({job:{reason:'inventory cleanout'}}),name=f.state.merchantCurrent.target;
 const item={name:'ring',level:3};
 createMerchantCompletion(f.state,f.ports).complete(f.state.merchantCurrent,{
  success:false,error:'merchant job failed: wrong realm (target was on US IV)',
  upgradesResolved:true,upgradeMarksResolved:[{name:'sword'}],compoundsResolved:true,purchasesResolved:true,
  pendingImprovedDeliveries:[{item}],
 });
 assert.equal(f.state.merchantCurrent,null);assert.equal(f.state.merchantQueue.length,1);
 assert.equal(f.state.merchantQueue[0].retryAt,110000);assert.deepEqual(f.state.purchases[name],[]);
 assert.deepEqual(f.state.compounds[name],[]);assert.ok(f.calls.some(c=>c[0]==='upgrades'));
 assert.ok(f.state.merchantDeliveries[name].some(mark=>mark.item.name==='ring'&&mark.item.level===3));
});
