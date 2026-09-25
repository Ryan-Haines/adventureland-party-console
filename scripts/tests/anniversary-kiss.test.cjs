const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../../characters/shared.js'),'utf8');
const approachCode = source.slice(source.indexOf('  async function anniversaryApproach('), source.indexOf('  function anniversaryWithTimeout('));
const code = source.slice(source.indexOf('  function anniversaryRoundAborted('),source.indexOf('  async function runAnniversaryHandoff('));
const settle = () => new Promise(resolve=>setImmediate(resolve));
function fixture(options={}) {
  let now=1000000, slices=0;
  const calls=[];
  const event={active:true,live:true,round:'round',target:options.designated?'F':'DxMerchant',id:'target-id',map:'main',x:0,y:0,expires:1300000};
  const character={name:'F',ctype:options.merchant?'merchant':'warrior',map:'main',x:0,y:0,stand:!!options.stand,
    s:{anniversary_visit:{round:'round'},...(options.oldBuff?{anniversary_kiss:{ms:100000}}:{})}};
  const r=vm.createContext({
    merchantEventWorkReserved: () => false, eventSelected: () => true, escapeOwns: () => false, huntTurnInPriority: false,
    eventTravelAllowed: async () => !r.huntTurnInPriority,
    root:{}, character, Date:{now:()=>now},
    setTimeout:fn=>{now+=200;queueMicrotask(fn);},
    eventStatus:()=>({anniversary:event}), anniversaryRoundId:e=>e.round, anniversaryEpoch:x=>Number(x)||0,
    anniversaryPlan:{abortedRounds:{},partyFeatured:!!options.partyFeatured,
      eventCycle:{id:'round',startsAt:now-(options.elapsed||0),endsAt:1300000}},
    anniversaryBusy:false, anniversaryStaging:false, merchantForceStand:false, partyTownActive:false,
    convoyTraveling:null, forceTraveling:false, townTraveling:null, partyConvoyActive:false,
    anniversaryMerchantFeaturedHold:false, anniversaryMerchantRetryAt:0, anniversaryMerchantMode:'idle',
    anniversaryStage:'',anniversaryMerchantAttemptAt:0, anniversaryLastAttemptAt:0, anniversaryRound:null,
    anniversaryCompletedRounds:{},anniversarySliceNames:['slice'],anniversaryKissResponses:[],
    anniversaryReturnLocation:null,anniversaryStagingReported:null,anniversaryReturnReported:null,
    anniversaryPendingHandoff:null, followingLeader:false,combatTargetId:null,
    anniversaryFeaturedCombatHoldMs:30000,
    navigationIntent:{revision:0},runtimeGeneration:1,runtimeCurrent:()=>true,
    eventsEnabled:!!options.combatEvent,joinedEvent:null,eventTraveling:false,eventReturnPending:false,
    activeCombatEvent:()=>options.combatEvent ? {name:options.combatEvent} : null,
    rawServerLiveEvents:()=>options.combatEvent?[{name:options.combatEvent}]:[],
    inventoryQuantity:()=>slices,
    anniversaryFeaturedEntity:()=>options.missing?null:{id:'DxMerchant',name:'DxMerchant',map:'main',x:options.approach?200:0,y:0},
    can_move_to:()=>true, navigationDestinationLabel:()=>'',
    xmove:async()=>{calls.push(['move']);if(options.move)await options.move();},
    smart_move:async()=>calls.push(['smart']), stop:async action=>calls.push(['stop',action]),
    close_stand:async()=>{calls.push(['close-stand']);character.stand=false;},
    use_skill:()=>{calls.push(['kiss']);return Promise.resolve();},
    anniversaryWithTimeout:async()=>{
      now+=8000;
      if(options.skill)await options.skill();
      if(options.newSlice)slices++;
      if(options.newBuff)character.s.anniversary_kiss={ms:300000};
      if(!options.resolves)throw new Error('Anniversary kiss timed out after 8 seconds');
    },
    reportAnniversaryReturn:round=>calls.push(['return',round]), reportAnniversaryStaging:()=>{},
    anniversaryReturnToTown:async()=>calls.push(['anniversary-town']),
    game_log:()=>{},say:()=>{},pollEvents:()=>calls.push(['poll-events']),
    request:async(url,options)=>{
      calls.push([url,options?.body]);
      if(url==='/hunt-event-permission')return {allowed:true};
      if(url==='/anniversary/attempt')return {attempt:calls.filter(x=>x[0]==='/anniversary/attempt').length};
      if(url==='/anniversary/failure' && options.body.attempt >= 2 && options.body.failureReason)return {anniversary:{abortedRounds:{round:{reason:options.body.failureReason}}}};
      return {};
    },
  });
  vm.runInContext(approachCode + code,r);
  return {r,calls,event,run:()=>r.runAnniversaryKiss()};
}

test('featured party checks a live combat event immediately without a thirty-second hold',async()=>{
  for(const role of [{designated:true},{partyFeatured:true}]) {
    const t=fixture({...role,combatEvent:'goobrawl',elapsed:30000});await t.run();await settle();
    assert.equal(t.r.anniversaryStaging,false);
    assert.equal(t.calls.some(x=>x[0]==='poll-events'),true);
    assert.equal(t.calls.some(x=>x[0]==='kiss'),false);
  }
});
test('featured character yields even before the old thirty-second cutoff',async()=>{
  const t=fixture({designated:true,combatEvent:'goobrawl',elapsed:29999});await t.run();
  await settle();
  assert.equal(t.r.anniversaryStaging,false);
  assert.equal(t.calls.some(x=>x[0]==='poll-events'),true);
});

test('featured party releases after one minute without interrupting its return convoy',async()=>{
  for(const role of [{designated:true},{partyFeatured:true},{designated:true,merchant:true}]) {
    const t=fixture({...role,elapsed:60000});t.r.partyConvoyActive=true;
    await t.run();await t.run();
    assert.equal(t.r.anniversaryStaging,false);
    assert.equal(t.calls.some(x=>x[0]==='anniversary-town'||x[0]==='kiss'),false);
    if(role.merchant)assert.equal(t.r.anniversaryMerchantMode,'complete');
    else assert.ok(t.calls.some(x=>x[0]==='return'));
  }
});

test('featured player still holds just before one minute',async()=>{
  const t=fixture({designated:true,elapsed:59999});await t.run();
  assert.equal(t.r.anniversaryStaging,true);
  assert.equal(t.calls.some(x=>x[0]==='return'),false);
});

test('a completed featured hold does not suppress a later merchant kiss round',async()=>{
 const t=fixture({merchant:true,partyFeatured:true,elapsed:60000,newSlice:true});
 await t.run();assert.equal(t.calls.some(x=>x[0]==='kiss'),false);
 t.r.anniversaryPlan.partyFeatured=false;
 Object.assign(t.r.anniversaryPlan.eventCycle,{returnCompletedAt:1000000});
 Object.assign(t.event,{round:'next-round',target:'Other',expires:1400000});
 t.r.character.s.anniversary_visit={round:'next-round'};
 await t.run();assert.equal(t.calls.filter(x=>x[0]==='kiss').length,1);
 assert.ok(t.calls.some(x=>x[0]==='/anniversary/claim' && x[1].round==='next-round'));
});

test('merchant closes an open stand before travelling or kissing',async()=>{
  const t=fixture({merchant:true,stand:true,newBuff:true,resolves:true});
  await t.run();
  const closeIndex=t.calls.findIndex(x=>x[0]==='close-stand');
  const moveIndex=t.calls.findIndex(x=>x[0]==='move'||x[0]==='smart');
  const kissIndex=t.calls.findIndex(x=>x[0]==='kiss');
  assert.ok(closeIndex>=0);
  if(moveIndex>=0)assert.ok(closeIndex<moveIndex);
  assert.ok(kissIndex>=0&&closeIndex<kissIndex);
  assert.equal(t.r.character.stand,false);
});

test('missing target produces a terminal report after the visibility wait and releases merchant ownership',async()=>{
  const t=fixture({missing:true,merchant:true});await t.run();
  assert.equal(t.calls.find(x=>x[0]==='/anniversary/failure')[1].failureReason,'target-missing');
  assert.equal(t.calls.some(x=>x[0]==='kiss'),false);
  assert.equal(t.r.anniversaryMerchantMode,'skipped');assert.equal(t.r.anniversaryBusy,false);
  assert.equal(t.r.root.__partyAnniversaryKissOperation,null);
  const count=t.calls.length;await t.run();assert.equal(t.calls.length,count);
});
test('eight second timeout without new success aborts; an old buff does not conceal it',async()=>{
  for(const oldBuff of [false,true]) {
    const t=fixture({oldBuff});await t.run();
    const failure=t.calls.find(x=>x[0]==='/anniversary/failure')[1];
    assert.equal(failure.failureReason,'kiss-timeout');assert.equal(failure.round,'round');
    assert.equal(failure.navigationRevision,0);assert.equal(t.r.anniversaryBusy,false);
  }
});
test('new slice or new buff proves success despite an unresolved skill promise',async()=>{
  for(const options of [{newSlice:true,oldBuff:true},{newBuff:true},{newBuff:true,oldBuff:true}]) {
    const t=fixture(options);await t.run();
    assert.equal(t.calls.some(x=>x[0]==='/anniversary/failure'),false);
    assert.equal(t.calls.some(x=>x[0]==='/anniversary/claim'),true);
    assert.ok(t.r.anniversaryCompletedRounds.round);
  }
});
test('merchant recovers a consumed anniversary ticket after the reward interrupted its operation',async()=>{
  const t=fixture({merchant:true});
  delete t.r.character.s.anniversary_visit;
  t.r.character.s.anniversary_kiss={ms:300000};
  t.r.root.__partyAnniversaryAttempt={round:'round',before:{slice:0},buffMsBefore:null};
  await t.run();
  assert.equal(t.r.anniversaryMerchantMode,'complete');
  assert.equal(t.calls.some(x=>x[0]==='/anniversary/claim'),true);
  assert.equal(t.calls.some(x=>x[0]==='/anniversary/failure'),false);
});
test('out of range after approach produces a terminal unreachable report',async()=>{
  const t=fixture({approach:true});await t.run();
  assert.equal(t.calls.find(x=>x[0]==='/anniversary/failure')[1].failureReason,'target-unreachable');
});
for(const pending of ['move','skill'])test('abort retires a pending '+pending+' without late claims or kisses',async()=>{
  let release;
  const wait=new Promise(resolve=>release=resolve);
  const t=fixture(pending==='move'?{approach:true,move:()=>wait}:{skill:()=>wait,newBuff:true});
  const run=t.run();await settle();
  t.r.anniversaryPlan.abortedRounds.round={reason:'target-missing'};
  await t.r.applyAnniversaryAbort();
  // A newer route owner must not be stopped by the old callback.
  t.r.convoyTraveling={id:'return'};const count=t.calls.length;
  release();await run;
  assert.equal(t.calls.slice(count).every(x=>x[0]==='/hunt-event-permission' && x[1].kissOperation.phase==='end'),true);
  assert.equal(t.calls.some(x=>x[0]==='/anniversary/claim'),false);
  assert.equal(t.r.anniversaryBusy,false);
});
test('persisted skip blocks the same round after reload but allows the next round',async()=>{
  const t=fixture();t.r.anniversaryPlan=JSON.parse(JSON.stringify({abortedRounds:{round:{startsAt:1000000}}}));
  await t.run();assert.equal(t.calls.length,0);
  t.event.round='new';assert.equal(t.r.anniversaryRoundAborted(t.event),false);
  assert.equal(t.r.anniversaryRoundAborted({live:false,next:1000000}),true);
  assert.equal(t.r.anniversaryRoundAborted({live:false,next:2000000}),false);
});

test('first failed kiss gets one more approach before the terminal report',async()=>{
 const t=fixture();await t.run();
 assert.equal(t.calls.filter(x=>x[0]==='kiss').length,2);
 assert.deepEqual(t.calls.filter(x=>x[0]==='/anniversary/failure').map(x=>x[1].attempt),[1,2]);
});
test('second kiss can succeed and does not report a terminal failure',async()=>{
 const t=fixture({resolves:true});let kisses=0;
 t.r.use_skill=()=>{kisses++;if(kisses===2)t.r.character.s.anniversary_kiss={ms:300000};return Promise.resolve();};
 await t.run();assert.equal(kisses,2);assert.ok(t.r.anniversaryCompletedRounds.round);
 assert.equal(t.calls.some(x=>x[0]==='/anniversary/failure'&&x[1].attempt===2),false);
});
test('disabled anniversary starts no approach or kiss',async()=>{
 const t=fixture();t.r.eventSelected=()=>false;await t.run();assert.equal(t.calls.length,0);
});
test('arrival advances despite an unresolved movement promise',async()=>{
 const t=fixture({missing:true});const operation={navigationRevision:0};t.r.root.__partyAnniversaryKissOperation=operation;
 t.r.xmove=()=>new Promise(()=>{});
 await t.r.anniversaryApproach({map:'main',x:0,y:0},true,t.event,operation,()=>{});
 assert.equal(t.calls.filter(x=>x[0]==='stop').length,2);
});

test('a disabled raw combat event cannot shorten the featured hold',async()=>{
 const t=fixture({designated:true,combatEvent:'crabxx',elapsed:30000});
 t.r.activeCombatEvent=()=>null;await t.run();
 assert.equal(t.r.anniversaryStaging,true);assert.equal(t.calls.some(x=>x[0]==='poll-events'),false);
});

test('unavailable anniversary target retries the unfinished Winterland to Main staging leg',async()=>{
 const t=fixture();t.event.available=false;
 Object.assign(t.r.character,{map:'winterland',x:0,y:0});
 await t.run();await t.run();
 assert.equal(t.calls.filter(x=>x[0]==='anniversary-town').length,2);
 assert.equal(t.r.anniversaryStaging,true);
 assert.equal(t.r.anniversaryStage,'returning to Main for anniversary');
 t.r.character.map='main';await t.run();
 assert.equal(t.r.anniversaryStage,'waiting for DxMerchant to become available');
 assert.equal(t.calls.some(x=>x[0]==='kiss'),false);
});

test('featured staging never reports Main arrival while still at Winterland town',async()=>{
 const t=fixture({designated:true});t.r.character.map='winterland';
 await t.run();
 assert.equal(t.r.anniversaryStage,'returning to Main for anniversary');
});
test('pre-round waiting yields before travelling to the square',async()=>{
 const t=fixture({combatEvent:'crabxx'});t.event.live=false;t.event.next=1005000;
 await t.run();await settle();
 assert.equal(t.calls.some(x=>x[0]==='anniversary-town'),false);
 assert.equal(t.calls.some(x=>x[0]==='poll-events'),true);
});

test('completed anniversary cannot restage or keep the featured character pending',async()=>{
 const t=fixture({designated:true});t.r.anniversaryPlan.eventCycle.returnCompletedAt=999999;
 t.r.anniversaryStaging=true;await t.run();
 assert.equal(t.calls.some(x=>x[0]==='anniversary-town'),false);assert.equal(t.r.anniversaryStaging,false);
 vm.runInContext(source.slice(source.indexOf('  function huntEventPending('),source.indexOf('  async function eventTravelAllowed(')),t.r);
 assert.equal(t.r.huntEventPending(),false);
});
test('completed-cycle reconciliation cancels only its retained staging route',async()=>{
 const t=fixture({designated:true});t.r.anniversaryPlan.eventCycle.returnCompletedAt=999999;
 const old=t.r.root.__partyAnniversaryStagingOperation={revision:0,cancelled:false};t.r.anniversaryBusy=true;
 await t.run();assert.equal(old.cancelled,true);assert.equal(t.r.anniversaryBusy,false);
 assert.equal(t.calls.some(x=>x[0]==='stop'),true);
});
