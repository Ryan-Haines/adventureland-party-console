// Gathering as a holder of the runner's one record (runtime/merchant-jobs/character/gathering.ts): the module runs over the ports shared.js gives it in play
// (helpers/merchant-gathering.cjs).
const {installGathering} = require('./helpers/merchant-gathering.cjs');
const {installEventAnniversary} = require('../../runtime/events/character/anniversary.ts');
const test = require('node:test');
const assert = require('node:assert/strict');
function deferred() { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
function fixture(mode = 'fishing') {
 const cast=deferred(), logs=[], c={root:{},
  character:{ctype:'merchant',level:30,map:'main',x:0,y:0,slots:{},items:[],moving:false},
  // The game's skill records (G.skills): the level gate and the session tool read them.
  G:{skills:{fishing:{reuse_cooldown:10000,level:16,wtype:['rod']},mining:{reuse_cooldown:10000,level:16,wtype:['pickaxe']}},items:{}},
  freeInventorySlots:()=>10,is_on_cooldown:()=>false,can_use:()=>true,
  // The items owner's stand holder, which the runner's leaveStand closes
  // through.
  partyItems:{stand:{close:async()=>{}}},
  ensureGatheringTool:async()=>true,equipGatheringTool:async()=>{},
  smart_move:async(p)=>{if(typeof p!=='string')Object.assign(c.character,p);},
  use_skill:()=>cast.promise,request:async(url,options)=>{if(url==='/merchant/gather-status')logs.push(options.body.message);return {};},
  game_log:()=>{},reportMerchantCommand:(...args)=>logs.push(args),
  // The settle stops the walk by name; a command's stop ends the cast.
  stop:async action=>{if(!action)cast.reject(new Error('interrupted'));},
  sleep:async()=>{}};
 // A stop before the cast starts rejects a cast no one awaits.
 cast.promise.catch(()=>{});
 const g=installGathering(c);
 // The fixture chooses the mode while the merchant banks, so choosing starts no attempt and no timer
 // (a holder now defers the choice itself).
 c.banking=true;g.choose([mode]);g.halt();c.banking=false;
 // The merchant stands on the spot, so a tick settles at once and casts.
 Object.assign(c.character,g.gatheringDestination(mode));
 return {c,g,cast,logs};
}
// The settle waits for 500 ms of stillness by the clock (3.12), so a cast starts about 0.5 s in.
async function phase(c,want) { for(let i=0;i<300 && c.root.__merchantHolder?.phase!==want;i++) await new Promise(r=>setTimeout(r,5)); assert.equal(c.root.__merchantHolder?.phase,want); }
async function casting(c) { await phase(c,'cast'); }

test('both gathering modes approach precisely despite a nearby client access indicator',async()=>{
 for(const mode of ['fishing','mining']) {
  const {c,g,cast}=fixture(mode),moves=[];
  const destination=g.gatheringDestination(mode);
  Object.assign(c.character,mode==='fishing'?{map:'main',x:-1590,y:555}:{map:'tunnel',x:267,y:-96});
  c.smart_move=async(p,callback,options)=>{moves.push(options);Object.assign(c.character,p);};
  const work=g.gatheringTick();await casting(c);
  assert.equal(moves.length,1);assert.equal(moves[0].arrivalTolerance,1);
  assert.deepEqual({map:c.character.map,x:c.character.x,y:c.character.y},destination);
  cast.resolve({found:false});await work;g.halt();
 }
});

test('a short gathering arrival never casts and reports its actual position',async()=>{
 const {c,g}=fixture();let casts=0;
 Object.assign(c.character,{x:-1590,y:555});
 // The game's client access indicator (parent.quirks) reads true near the spot, yet only the
 // precise arrival casts.
 c.parent={quirks:{fishing:true}};
 c.smart_move=async()=>{};c.use_skill=async()=>{casts++;};
 const reports=[];c.request=async(url,options)=>{if(url==='/merchant/gather-status')reports.push(options.body);return {};};
 await g.gatheringTick();g.halt();assert.equal(casts,0);
 const failure=reports.find(r=>r.level==='error');assert.equal(failure.details.position.x,-1590);assert.equal(failure.details.access,true);
 // A failed step waits v1.5.0's 15 s before the next attempt.
 await g.gatheringTick();g.halt();assert.equal(c.root.__merchantGatheringBlockedReason,'retry delay');
});

test('fishing and mining retain the broom across map travel and approach, equipping only after settling',async()=>{
 for(const mode of ['fishing','mining']) {
  const {c,g,cast}=fixture(mode),travel=deferred(),settled=deferred(),steps=[];
  const destination=g.gatheringDestination(mode);
  Object.assign(c.character,{map:'bank',x:0,y:0});c.character.slots.mainhand={name:'broom'};
  c.smart_move=async target=>{
   assert.equal(c.character.slots.mainhand.name,'broom');steps.push(typeof target==='string'?'map':'approach');
   await travel.promise;c.character.map=destination.map;if(typeof target!=='string')Object.assign(c.character,target);
  };
  c.stop=async action=>{if(action==='smart'){steps.push('settle');assert.equal(c.character.slots.mainhand.name,'broom');await settled.promise;}};
  c.equipGatheringTool=async()=>{steps.push('equip');c.character.slots.mainhand={name:mode==='fishing'?'rod':'pickaxe'};};
  c.can_use=()=>{assert.equal(c.character.slots.mainhand.name,mode==='fishing'?'rod':'pickaxe');return true;};
  const work=g.gatheringTick();
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.deepEqual(steps,['map']);assert.equal(c.character.slots.mainhand.name,'broom');
  travel.resolve();for(let i=0;i<8;i++)await Promise.resolve();
  assert.deepEqual(steps,['map','approach','settle']);
  settled.resolve();await casting(c);assert.deepEqual(steps,['map','approach','settle','equip']);
  cast.resolve({found:false});await work;g.halt();
 }
});

test('interrupted gathering travel never replaces the broom with a tool',async()=>{
 const {c,g}=fixture(),travel=deferred();let equips=0,casts=0;
 c.character.map='bank';c.character.slots.mainhand={name:'broom'};
 c.smart_move=()=>travel.promise;c.equipGatheringTool=async()=>{equips++;};c.use_skill=async()=>{casts++;};
 const work=g.gatheringTick();for(let i=0;i<8;i++)await Promise.resolve();
 c.root.__merchantHolder.cancelled='manual travel';travel.resolve();await work;g.halt();
 assert.equal(equips,0);assert.equal(casts,0);assert.equal(c.character.slots.mainhand.name,'broom');
});

test('active cast survives repeated mode selection and routine work, then switches after completion',async()=>{
 const {c,g,cast,logs}=fixture();
 c.banking=true;g.choose(['fishing','mining']);g.halt();c.banking=false;
 const work=g.gatheringTick();await casting(c);
 g.selectGatheringMode();g.selectGatheringMode();
 assert.equal(c.root.__merchantHolder.mode,'fishing');
 for(const type of ['merchant-service','merchant-idle','merchant-stand-sync']) assert.equal(await g.meetCommand({type,id:7}),false);
 // The runner's accept runs a merchant-gather at once and leaves the cast its holder.
 assert.equal(await c.merchantRunner.accept({type:'merchant-gather',id:8}),true);assert.equal(c.root.__merchantHolder.mode,'fishing');
 // The deferred job command stays in the slot and goes next: no attempt starts while the slot holds it.
 c.coordinatorCommand={id:7,type:'merchant-service'};c.lastCommand=6;
 // A catch starts fishing's cooldown, so the next choice is mining.
 cast.resolve({found:true});await work;g.halt();
 assert.equal(c.root.__merchantGatheringSession.mode,'mining');assert.ok(logs.includes('Caught an item'));
 assert.equal(c.root.__merchantHolder,null);assert.equal(c.root.__merchantGatheringBlockedReason,'deferred command');
 c.lastCommand=7;await g.gatheringTick();g.halt();assert.notEqual(c.root.__merchantGatheringBlockedReason,'deferred command');
});

test('explicit movement cancels a cast and waits for release without inventing cooldown',async()=>{
 const {c,g}=fixture();const work=g.gatheringTick();await casting(c);
 assert.equal(await g.meetCommand({type:'force-travel',id:9}),true);await work;g.halt();
 // The command that ended the attempt holds the merchant on its release.
 assert.deepEqual([c.root.__merchantHolder.kind,c.root.__merchantHolder.commandId],['command',9]);
 assert.equal(g.active(),false);assert.equal(c.root.__merchantGatheringCooldowns.fishing,0);
});

test('cancellation during equipment or settling prevents the skill from starting',async()=>{
 for(const step of ['equip','settle']) {
  const {c,g}=fixture(), gate=deferred();let casts=0;
  if(step==='equip')c.equipGatheringTool=()=>gate.promise;else c.stop=action=>action==='smart'?gate.promise:Promise.resolve();
  c.use_skill=async()=>{casts++;};
  const work=g.gatheringTick();for(let i=0;i<8;i++)await Promise.resolve();
  c.root.__merchantHolder.cancelled='command travel';gate.resolve();await work;g.halt();
  assert.equal(casts,0);
 }
});

test('a code reload ends the old attempt, and its release leaves a newer holder alone',async()=>{
 const {c,g,cast}=fixture();const work=g.gatheringTick();await casting(c);
 const old=c.root.__merchantHolder;
 // The new runtime's module, over the same root, ends the attempt it finds.
 const reloaded={...c};delete reloaded.merchantRunner;const g2=installGathering(reloaded);
 assert.equal(old.cancelled,'code reload');
 const newer={kind:'job',jobId:'J',commandId:3};c.root.__merchantHolder=newer;
 cast.reject(new Error('interrupted'));await work;g.halt();g2.halt();
 assert.equal(c.root.__merchantHolder,newer);
});

test('movement rejection reconciles server cooldown and releases ownership',async()=>{
 const {c,g,cast,logs}=fixture();const work=g.gatheringTick();await casting(c);
 c.parent={next_skill:{fishing:new Date(Date.now()+20000)}};cast.reject({reason:'moving'});await work;g.halt();
 assert.ok(c.root.__merchantGatheringSession.cooldownUntil>Date.now());assert.equal(c.root.__merchantHolder,null);
 assert.ok(logs.some(x=>typeof x==='string'&&x.includes('during cast: movement')));
});

test('disabling gathering interrupts only the active attempt',async()=>{
 const {c,g}=fixture();const work=g.gatheringTick();await casting(c);
 g.choose([]);await work;g.halt();
 // The hands go back to normal under the gathering holder's `restoring` phase, then it lets go.
 assert.equal(c.root.__merchantHolder?.phase,'restoring');
 for(let i=0;i<20 && c.root.__merchantHolder;i++) await new Promise(r=>setImmediate(r));
 assert.equal(c.root.__merchantGatheringSession,null);assert.equal(c.root.__merchantHolder,null);
});

test('coordinator cast reservation requires a fresh casting observation',()=>{
 const {gatheringCastActive}=require('../../runtime/merchant-jobs/coordinator/dispatch.ts');
 assert.equal(gatheringCastActive({seenAt:20000,gatheringPhase:'cast'},25000),true);
 assert.equal(gatheringCastActive({seenAt:10000,gatheringPhase:'cast'},25000),false);
 assert.equal(gatheringCastActive({seenAt:20000,gatheringPhase:'travel'},25000),false);
 assert.equal(gatheringCastActive({seenAt:20000},25000),false);
});

test('every job command ends the gathering holder before it runs, and the runner never holds two',async()=>{
 for(const type of ['merchant-service','merchant-ponty-buy','merchant-join-giveaway','merchant-npc-sale','merchant-commerce']) {
  const {c,g}=fixture(),gate=deferred();c.smart_move=()=>gate.promise;c.character.map='bank';
  c.recoverLuckyUpgrade=async()=>{};c.freeInventorySlots=()=>10;c.tidyLuckySlot=async()=>{};c.close_stand=async()=>{};
  const work=g.gatheringTick();await phase(c,'travel');
  const handed=g.meetCommand({type,id:11,jobId:'J'+type});
  gate.resolve();assert.equal(await handed,true);await work;
  assert.deepEqual([c.root.__merchantHolder.kind,c.root.__merchantHolder.commandId],['command',11]);
  const seen=[];await c.merchantRunner.runJob({type,id:11,jobId:'J'+type},type,async()=>{seen.push(c.root.__merchantHolder.kind);
   // The tick finds the job holding the merchant and takes nothing.
   await g.gatheringTick();seen.push(c.root.__merchantHolder.kind,c.root.__merchantGatheringBlockedReason);});
  g.halt();assert.deepEqual(seen,['job','job','merchant job']);
 }
});

test('gathering waits for any running command, a travel and a manual equip, until its handler returns',async()=>{
 for(const command of [{type:'travel',id:21},{type:'equip',id:22}]) {
  const {c,g}=fixture();let casts=0;c.use_skill=async()=>{casts++;return {found:false};};
  c.merchantRunner.holdCommand(command);
  await g.gatheringTick();assert.equal(casts,0);assert.equal(c.root.__merchantGatheringBlockedReason,'command '+command.type);
  c.merchantRunner.releaseCommand(command.id);
  await g.gatheringTick();g.halt();assert.equal(casts,1);
 }
 // A service visit with a next leg leaves its itinerary holding the merchant: a command runs and
 // hands it back, and the hold lapses at its bound.
 const {c,g}=fixture();let casts=0;c.use_skill=async()=>{casts++;return {found:false};};
 c.request=async()=>({});c.recoverLuckyUpgrade=async()=>{};c.freeInventorySlots=()=>10;c.tidyLuckySlot=async()=>{};
 await c.merchantRunner.runJob({type:'merchant-service',id:31,jobId:'S1'},'merchant service',async()=>{c.merchantRunner.collectAfter(30000);});
 await g.gatheringTick();assert.equal(casts,0);assert.equal(c.root.__merchantGatheringBlockedReason,'logistics handoff');
 c.merchantRunner.holdCommand({type:'travel',id:32});c.merchantRunner.releaseCommand(32);
 assert.equal(c.merchantRunner.record().kind,'collection');
 c.root.__merchantHolder.until=Date.now()-1;
 await g.gatheringTick();g.halt();assert.equal(casts,1);
});

// The merchant had no signal that an itinerary ended, so the hold sat out 30 s after the last leg.
// The reply names the open itinerary: a reply naming none ends the hold at once, a reply naming one
// keeps it past its first bound, and COLLECTION_HOLD_MS reports only when replies stop.
test('the itinerary hold follows the reply and its bound fires only on coordinator silence',async()=>{
 const status=require('../../runtime/status/api.ts');
 const fired=()=>status.boundsPending().filter(f=>f.bound==='COLLECTION_HOLD_MS').length;
 const service=async(c,id)=>{c.request=async()=>({});c.recoverLuckyUpgrade=async()=>{};c.freeInventorySlots=()=>10;c.tidyLuckySlot=async()=>{};
  await c.merchantRunner.runJob({type:'merchant-service',id,jobId:'S'+id},'merchant service',async()=>{c.merchantRunner.collectAfter(30000);});};
 status.boundsSent(status.boundsPending().length);
 for(const [row,steps] of [
  ['the reply naming none ends the hold',async c=>{
   c.merchantRunner.standReply({merchantItinerary:null});
   assert.equal(c.merchantRunner.record(),null);}],
  ['a reply naming none ends a hold behind a running command',async c=>{
   c.merchantRunner.holdCommand({type:'travel',id:42});c.merchantRunner.standReply({merchantItinerary:null});
   c.merchantRunner.releaseCommand(42);assert.equal(c.merchantRunner.record(),null);}],
  ['it holds while the reply names an open itinerary',async c=>{
   c.root.__merchantHolder.until=Date.now()+5;c.merchantRunner.standReply({merchantItinerary:'leg-2'});
   assert.ok(c.root.__merchantHolder.until>=Date.now()+29000);assert.equal(c.merchantRunner.record().kind,'collection');}],
  ['a reply without the field leaves the hold',async c=>{
   c.merchantRunner.standReply({});assert.equal(c.merchantRunner.record().kind,'collection');}],
 ]) {
  const {c,g}=fixture();await service(c,50);await steps(c);
  // A freed merchant starts a gathering attempt, whose cast would land in a later row's fixture, so
  // the row ends gathering.
  await new Promise(setImmediate);g.choose([]);g.halt();
  assert.equal(fired(),0,row+': no silence, no firing');
 }
 const {c,g}=fixture();await service(c,60);
 c.root.__merchantHolder.until=Date.now()-1;
 assert.equal(c.merchantRunner.record(),null);assert.equal(c.merchantRunner.record(),null);g.halt();
 assert.equal(fired(),1,'silence past the bound reports once');
 status.boundsSent(status.boundsPending().length);
});

// A bag at the reserve with the session's catch banks the catch and casts again; a bag full of
// other items waits and walks nowhere.
test('a full bag banks the session catch, then the next cast; a bag of other items waits',async()=>{
 for(const caught of [true,false]){
  const {c,g}=fixture();let casts=0,free=3;const walks=[];
  c.use_skill=async()=>{casts++;return {found:false};};
  c.character.items=[{name:caught?'seashell':'wbook0',q:5}];
  c.root.__merchantGatheringSession.baseline=caught?[]:[{item:{name:'wbook0',q:5},quantity:5}];
  c.freeInventorySlots=()=>free;c.inventoryAmount=item=>c.character.items.filter(i=>i&&i.name===item.name).reduce((n,i)=>n+i.q,0);
  c.findItem=wanted=>c.character.items.findIndex(i=>i&&i.name===wanted.name);
  c.bankStoreFully=async slot=>{c.character.items[slot]=null;free=10;};
  const move=c.smart_move;c.smart_move=async p=>{if(typeof p==='string')walks.push(p);return move(p);};
  await g.gatheringTick();g.halt();
  assert.deepEqual([walks,casts,c.character.items[0]&&c.character.items[0].name||null],caught?[['bank'],1,null]:[[],0,'wbook0']);
  if(!caught)assert.equal(c.root.__merchantGatheringBlockedReason,'inventory capacity');
 }
});

test('post-status wake respects a newly accepted job and an obsolete runtime',async()=>{
 for(const obsolete of [false,true]) {
  const {c,g}=fixture();let casts=0;c.use_skill=async()=>{casts++;};c.runtimeCurrent=()=>!obsolete;
  c.root.__merchantHolder={kind:'job',jobId:'new'};
  g.wakeGatheringAfterStatus();await Promise.resolve();g.halt();
  assert.equal(casts,0);assert.equal(c.root.__merchantHolder.jobId,'new');
 }
});

// The merchant's slice collection (character/anniversary.ts `collect`), reached through the
// anniversary tick with no round and the anniversary unselected, so the kiss, the advert and the
// repayment pass and the tick runs the handoff. A wait moves the clock, and `c.report` ends the
// merchant's wait for its next report: true for a report, false for the report-freshness bound.
function handoffFixture() {
 let now=1_000_000;
 const moves=[], c={busy:()=>anniversary.busy(),gathering:()=>false,withTimeout:async p=>p,
  plan:{handoffTargets:[{name:'bankboi0',ctype:'merchant',seenAt:now,server:'USII',map:'main',x:168,y:-134}]}};
 const character={name:'M',ctype:'merchant',map:'main',x:0,y:0,stand:false};
 const anniversary=installEventAnniversary({now:()=>now,character:()=>character,root:()=>({}),current:()=>true,generation:()=>1,
  round:()=>null,epoch:value=>Number(value)||0,nextReport:()=>new Promise(resolve=>{c.report=resolve;}),
  attend:{selected:()=>false,allowed:()=>true,active:()=>null,traveling:()=>null,joined:()=>null,poll(){}},
  exitPending:()=>false,eventsEnabled:()=>false,paused:()=>false,escaping:()=>false,caveOwns:()=>false,huntTurnIn:()=>false,
  merchant:{reserved:()=>false,holder:()=>null,gathering:()=>c.gathering(),forceStand:()=>false,errand:()=>false,wake:()=>moves.push('wake')},
  walk:{revision:()=>0,command:()=>0,townActive:()=>false,townTraveling:()=>false,forceTraveling:()=>false,convoy:()=>null,convoying:()=>false,
   convoyActive:()=>false,held:()=>false,yieldConvoy:async()=>true,endFollow:async()=>{},
   request:{kind:'anniversary'},returnRequest:{kind:'anniversary-return'},
   stop:async()=>moves.push('stop'),smart:async p=>moves.push(p),direct:async()=>undefined,leave:async()=>undefined,toMain:async()=>undefined,landed:()=>false},
  farmingLabel:()=>'farming',
  game:{entities:()=>({}),player:()=>null,joinedInstance:()=>false,canMoveTo:()=>true,useSkill:async()=>undefined,say:async()=>undefined,
   send:async()=>undefined,closeStand:async()=>undefined,quantity:()=>0,slot:()=>-1,realm:()=>'USII'},
  clearTarget(){},request:async()=>({}),withTimeout:(promise,ms,label)=>c.withTimeout(promise,ms,label),
  wait:async ms=>{now+=ms;},later:action=>action(),log(){}});
 anniversary.receive(c.plan);
 c.tick=()=>anniversary.tick();
 return {c,moves};
}
// The coordinator leaves stale holders off the handoff list (coordinator-anniversary-snapshot.test.cjs
// 'handoffs exclude ... stale ...'), so the merchant only sees a listed bank merchant to skip.
test('bankboi cannot reserve merchant gathering',async()=>{
 const {c,moves}=handoffFixture();
 await c.tick();assert.deepEqual(moves,[]);assert.equal(c.busy(),false);
});
test('slice collection cannot steal active fishing or mining movement',async()=>{
 for(const mode of ['fishing','mining']){
  const {c,moves}=handoffFixture();c.plan.handoffTargets[0].ctype='priest';
  c.gathering=()=>!!mode;
  await c.tick();assert.deepEqual(moves,[]);assert.equal(c.busy(),false);
 }
});
// The merchant waits at the fighter while the coordinator lists it; its own state (here gathering)
// ends the wait, wakes its job owner and marks the entry tried until the fighter's report changes.
test("a collection the merchant's own work ends releases the reservation and waits for a changed report",async()=>{
 const {c,moves}=handoffFixture();c.plan.handoffTargets[0].ctype='priest';
 const collecting=c.tick();await new Promise(setImmediate);
 assert.equal(c.busy(),true);assert.equal(moves.length,1);
 c.gathering=()=>true;c.report(true);await collecting;
 assert.equal(c.busy(),false);assert.deepEqual(moves.slice(1),['wake']);
 c.gathering=()=>false;
 await c.tick();assert.equal(moves.length,2);
 c.plan.handoffTargets[0].x=200;
 const again=c.tick();await new Promise(setImmediate);
 assert.equal(moves.length,3);assert.deepEqual(moves[2],{map:'main',x:200,y:-134});
 c.gathering=()=>true;c.report(true);await again;
});

// A fighter report with no send ends the wait. The fighter walks off toward an event while still
// listed, so its entry names a new position; the merchant stops waiting there and tries the fighter
// at the changed position on its next tick.
test("a fighter report that moves without a send ends the merchant's wait",async()=>{
 const {c,moves}=handoffFixture();c.plan.handoffTargets[0].ctype='priest';
 const collecting=c.tick();await new Promise(setImmediate);
 assert.equal(c.busy(),true);assert.equal(moves.length,1);
 c.plan.handoffTargets[0].x=400;c.report(true);
 const ended=await Promise.race([collecting.then(()=>true),new Promise(r=>setImmediate(()=>setImmediate(()=>r(false))))]);
 assert.equal(ended,true,'the moved report ends the wait');
 assert.equal(c.busy(),false);assert.deepEqual(moves.slice(1),['wake']);
 const again=c.tick();await new Promise(setImmediate);
 assert.deepEqual(moves[2],{map:'main',x:400,y:-134},'the changed report is tried again');
 c.gathering=()=>true;c.report(true);await again;
});

// The handoff list comes with the merchant's own report's reply, so reports that fall silent end the
// wait at the fighter with the bound movement's report wait reports (reportSilence). Isolated: a live
// row cannot stall the merchant's report loop during one handoff.
test("the merchant's wait at a fighter ends when its own reports fall silent",async()=>{
 const {c,moves}=handoffFixture();c.plan.handoffTargets[0].ctype='priest';
 const collecting=c.tick();await new Promise(setImmediate);
 assert.equal(c.busy(),true);
 c.report(false);
 const ended=await Promise.race([collecting.then(()=>true),new Promise(r=>setImmediate(()=>setImmediate(()=>r(false))))]);
 assert.equal(ended,true,'the wait outlived the silence');
 assert.equal(c.busy(),false);assert.deepEqual(moves.slice(1),['wake']);
});

test('one command id runs once, a command letting go runs the pass at once, and a mode choice swaps no tool under a command',async()=>{
 const {c,g}=fixture();let casts=0,restores=0;c.use_skill=async()=>{casts++;return {found:false};};
 c.restoreGatheringEquipment=async()=>{restores++;return true;};c.runtimeCurrent=()=>true;
 assert.equal(c.merchantRunner.admit(31),true);assert.equal(c.merchantRunner.admit(31),false);
 c.merchantRunner.holdCommand({type:'travel',id:31});
 await g.gatheringTick();assert.equal(casts,0);
 // The release to none runs the pass with no tick between.
 c.merchantRunner.releaseCommand(31);assert.equal(c.merchantRunner.admit(31),true);c.merchantRunner.releaseCommand(31);
 for(let i=0;i<300 && !casts;i++) await new Promise(r=>setTimeout(r,5));
 assert.equal(casts,1);
 for(let i=0;i<20 && c.root.__merchantHolder;i++) await new Promise(r=>setImmediate(r));
 // A mode choice while a command holds waits: the session keeps its mode and catch baseline, and the
 // hands stay with that command's settle. The command letting go runs the choice.
 c.merchantRunner.holdCommand({type:'travel',id:32});g.choose(['mining']);
 assert.equal(c.root.__merchantGatheringSession.mode,'fishing');
 g.choose([]);g.halt();
 assert.equal(restores,0);assert.equal(c.root.__merchantHolder.commandId,32);
 c.merchantRunner.releaseCommand(32);await new Promise(r=>setImmediate(r));
 assert.equal(restores,1);
});

// (489), e2e/gathering-handoff-failures.md: the job owner's half of the handoff. A Ponty command
// with no attempt reaches the hands' settle at once; a cast defers it, reported, until the cast
// releases, and it then reaches settle; a merchant-gather never reaches settle. Settle's own
// restore of both hands is the hands owner's (gathering-equipment-restore.test.cjs).
test('handoff: Ponty reaches settle at once or after the cast, a gather command never does',async()=>{
 const {c,g,cast,logs}=fixture(),settled=[];c.merchantHands={settle:async command=>{settled.push(command.id);return true;}};
 assert.equal(await c.merchantRunner.accept({type:'merchant-ponty-buy',id:41,jobId:'P1'}),true);
 assert.deepEqual(settled,[41]);c.merchantRunner.releaseCommand(41);
 const work=g.gatheringTick();await casting(c);
 const ponty={type:'merchant-ponty-buy',id:42,jobId:'P2'};
 assert.equal(await c.merchantRunner.accept(ponty),false);
 assert.deepEqual([settled,c.root.__merchantHolder.kind],[[41],'gathering']);
 assert.ok(logs.some(entry=>Array.isArray(entry)&&entry[0]===ponty&&entry[1]==='deferred'));
 cast.resolve({found:false});await work;g.halt();
 assert.equal(await c.merchantRunner.accept(ponty),true);assert.deepEqual(settled,[41,42]);
 c.merchantRunner.releaseCommand(42);
 assert.equal(await c.merchantRunner.accept({type:'merchant-gather',id:43}),true);assert.deepEqual(settled,[41,42]);
});

// In v1.5.0's shared.js, a job command whose hands settle
// could not bring back to normal waits, reported deferred, and is not accepted; any other command
// runs.
test('a job command waits while the hands are not back to normal, a travel runs',async()=>{
 const {c}=fixture();c.merchantHands={settle:async()=>false};
 const ponty={type:'merchant-ponty-buy',id:51,jobId:'P5'};
 assert.equal(await c.merchantRunner.accept(ponty),false);
 assert.deepEqual([c.root.__merchantCommandReport.commandId,c.root.__merchantCommandReport.state],[51,'deferred']);
 c.merchantRunner.releaseCommand(51);
 assert.equal(await c.merchantRunner.accept({type:'travel',id:52}),true);c.merchantRunner.releaseCommand(52);
});

// (490): a manual equip that ends a cast holds the merchant through the cast's release, so the mode
// choice at that release waits; the equip letting go runs the choice, which rotates.
test('manual inventory ownership survives gathering mode rotation at cast release',async()=>{
 const {c,g}=fixture();
 c.banking=true;g.choose(['fishing','mining']);g.halt();c.banking=false;
 const work=g.gatheringTick();await casting(c);
 c.is_on_cooldown=mode=>mode==='fishing';
 assert.equal(await c.merchantRunner.accept({type:'equip',id:22}),true);await work;
 assert.deepEqual([c.root.__merchantGatheringSession.mode,c.root.__merchantHolder.kind,c.root.__merchantHolder.commandId],['fishing','command',22]);
 c.merchantRunner.releaseCommand(22);
 for(let i=0;i<300 && c.root.__merchantGatheringSession.mode!=='mining';i++) await new Promise(r=>setTimeout(r,5));
 g.halt();assert.equal(c.root.__merchantGatheringSession.mode,'mining');
});

// The game's signals that end gathering's waits: a status line goes out when it changes, a level
// failure retries once the merchant reaches the level, and an older client's cast outcome ends on
// the character's update (`player`) that shows the channel's end and the cooldown.
test('gathering status goes out on change, a level failure retries at the level, an older client cast ends on the game update',async()=>{
 const {EventEmitter}=require('node:events');
 const {c,g,logs}=fixture();
 g.gatheringStatus('Fishing waiting for banking');g.gatheringStatus('Preparing to go fishing');g.gatheringStatus('Fishing waiting for banking');
 assert.equal(logs.filter(x=>x==='Fishing waiting for banking').length,2);
 c.character.level=10;await g.gatheringTick();g.halt();
 await g.gatheringTick();g.halt();assert.equal(c.root.__merchantGatheringBlockedReason,'retry delay');
 c.character.level=30;
 const socket=new EventEmitter(),window=globalThis.parent,previous=window.socket;window.socket=socket;
 let castDone;c.use_skill=()=>new Promise(resolve=>{castDone=resolve;});
 try{
  const work=g.gatheringTick();assert.equal(c.root.__merchantGatheringBlockedReason,null);await casting(c);
  for(let i=0;i<300&&!castDone;i++) await new Promise(r=>setTimeout(r,5));
  // The older client resolves the cast at the channel's start, with no `found`.
  c.character.c={fishing:{ms:5000}};castDone(undefined);await new Promise(r=>setTimeout(r,20));socket.emit('player',{});
  const ended=Date.now();c.character.c={};c.parent={next_skill:{fishing:new Date(Date.now()+10000)}};socket.emit('player',{});
  await work;g.halt();
  assert.ok(Date.now()-ended<500,'the outcome follows the update, not a timer');
  assert.ok(logs.includes('Caught an item'));
 }finally{window.socket=previous;}
});
