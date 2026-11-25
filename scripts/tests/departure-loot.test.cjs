const test=require('node:test'),assert=require('node:assert/strict');
const {createDepartureLoot,installLootClient}=require('../../runtime/hunting/character/loot.ts');
const {createHunt}=require('../../runtime/hunting/coordinator/hunt.ts');
const {huntMessage}=require('../../runtime/hunting/coordinator/record.ts');
const {huntLootId}=require('../../runtime/hunting/rules.ts');
// The loot client runs under the lifecycle owner's run scope, whose game window draws each frame at once here, and
// collects through the items owner's loot pass (items/api.ts `loot`), which each row plants as lootPass.
require('./helpers/run-scope.cjs').processScope();
globalThis.parent.draw_trigger=callback=>callback();
let lootPass=async()=>true;
globalThis.partyItems={loot:{pass:()=>lootPass()}};
const socket=()=>({on(){},off(){}});
// The hunting owner's character door loot ports (shared.js `partyHunting.lootPorts`) for W at :USII main (0,0).
const gamePorts=over=>()=>({name:()=>'W',quest:()=>null,positions:()=>[],clockOffset:()=>0,
 character:()=>({name:'W',map:'main',in:'main',x:0,y:0}),frame:()=>({server_region:'US',server_identifier:'II',entities:{}}),
 navigationCancelled:()=>false,escaping:()=>false,eventJoined:()=>false,defending:()=>false,passing:()=>false,engaged:()=>false,
 chests:()=>[],socket,...over});
test('historical completed loot releases farming and cannot return through a delayed report',()=>{
 let api;
 try {
  const mission={cycleId:'old',currentIndex:0,stage:'farming',target:'bee',participants:['W'],missions:[{target:'bee',owners:['W']}]};
  mission.loot={id:huntLootId(mission),complete:true};
  api=installLootClient({},{lootPorts:gamePorts({quest:()=>({id:'bee',count:0})})});
  api.accept({serverNow:1,targetMode:'hunt',monsterHunt:mission});assert.equal(api.huntPending(),true);
  for(const [index,stage] of ['ended','backup-travel','backup-farming'].entries()) {
   api.accept({serverNow:index+2,targetMode:stage==='ended'?'farming':'hunt',monsterHunt:{...mission,stage}});
   assert.equal(api.huntPending(),false);api.accept({serverNow:1,targetMode:'hunt',monsterHunt:mission});assert.equal(api.huntPending(),false);
  }
  api.accept({serverNow:6,targetMode:'farming',monsterHunt:mission});assert.equal(api.huntPending(),false);
 } finally {api?.stop();}
});
function client(){
 let now=100,defense=false,cancelled=false,calls=0,fail=false,observe,collect;
 const position={realm:':USII',map:'main',in:'main',x:0,y:0},chests=['drop'];
 const ports={now:()=>++now,position:()=>position,cancelled:()=>cancelled,defending:()=>defense,
  loot:async()=>{calls++;if(fail)throw Error('loot_no_space');await new Promise(r=>collect=r);},
  nextObservation:()=>new Promise(r=>observe=r),chests:()=>chests};
 lootPass=ports.loot;
 const api=createDepartureLoot(ports),control={id:'hunt:0',after:99,...position};api.accept(control,100);
 return {api,control,position,chests,calls:()=>calls,collect:async()=>{collect();await Promise.resolve();await Promise.resolve();},
  observe:()=>observe(),defend:v=>defense=v,cancel:()=>cancelled=true,fail:()=>fail=true};
}
test('loot acknowledgement waits for collection and a fresh observation; no fixed departure timer',async()=>{
 const r=client(),pass=r.api.tick();assert.equal(r.api.blocks(),true);assert.equal(r.api.report(),null);
 await r.collect();assert.equal(r.api.report(),null);r.chests.length=0;r.observe();await pass;
 assert.equal(r.api.report().complete,true);assert.equal(r.api.blocks(),false);assert.equal(r.calls(),1);
});
test('failed collection stays pending and retryable, defense and cancellation take priority',async()=>{
 const r=client();r.defend(true);await r.api.tick();assert.equal(r.calls(),0);
 r.defend(false);r.fail();await r.api.tick();assert.equal(r.api.report().complete,false);assert.match(r.api.report().error,/loot_no_space/);
 await r.api.tick();assert.equal(r.calls(),2);r.cancel();await r.api.tick();assert.equal(r.calls(),2);assert.equal(r.api.blocks(),false);
});
test('stale encounter, wrong realm, instance and location cannot regain loot ownership',async()=>{
 for(const change of [{realm:':EUI'},{in:'other'},{x:1000}]){
  const r=client();Object.assign(r.position,change);await r.api.tick();assert.equal(r.calls(),0);assert.equal(r.api.blocks(),false);
 }
 const r=client();r.api.accept(null,200);r.api.accept(r.control,100);r.api.accept(r.control,300);
 await r.api.tick();assert.equal(r.calls(),0);
});
test('an in-flight collection result cannot acknowledge a replaced encounter',async()=>{
 const r=client(),pass=r.api.tick();r.api.accept(null,200);await r.collect();await pass;assert.equal(r.api.report(),null);
});
// The departure barrier through the hunting owner's Hunt service (hunt.ts `createHunt`): pending() ticks it and
// reads whether the barrier still holds.
function coordinator(){
 const mission={target:'snake',owners:['P'],destination:{map:'main',x:0,y:0},destinationVersion:1};
 const hunt={cycleId:'cycle',stage:'farming',target:'snake',missions:[mission],currentIndex:0,participants:['W','P'],policyVersion:3,owner:'W',selectionLeader:'W',originArrivedAt:50};
 const state={leader:'W',followers:{P:true},nextCommandId:1,monsterHunt:hunt,targetMode:'hunt',commands:{},navigationIntents:{W:{revision:1},P:{revision:1}},monsterHunterLocation:{map:'main',x:500,y:500},
  monsterSearchRadiusByCharacter:{},combatLogs:{},monsterChoices:[{id:'snake',locations:[mission.destination]}],statuses:{}};
 for(const [n,q] of [['W',{id:'bee',count:5,remainingMs:900000}],['P',{id:'snake',count:0,remainingMs:900000}]])
  state.statuses[n]={seenAt:100,map:'main',in:'main',server:'USII',x:0,y:0,hp:100,convoyProtocol:4,monsterHunt:q};
 require('./helpers/travel-observations.cjs').observeTravel(state.statuses);
 const r={hunt,state,starts:[],ownsTravel:false,persist(){}};
 const service=createHunt(state,{now:()=>100,participants:()=>['W','P'],online:()=>true,ownsTravel:()=>r.ownsTravel,persist:()=>r.persist(),
  cancelConvoy(){state.activeConvoy=null;},selectedDestination:()=>null,
  start(location){r.starts.push(location);state.activeConvoy={id:'walk',phase:'assemble',purpose:'monster-hunt',location,participants:['W','P']};return true;},
  navigation:{authorize(){},intent:n=>state.navigationIntents[n]}});
 r.pending=()=>{service.tick();return !!state.monsterHunt?.loot&&!state.monsterHunt.loot.complete;};
 return r;
}
test('completed Hunt returns to Daisy without a departure loot hold',()=>{
 const r=coordinator();r.ownsTravel=true;r.state.statuses.W.monsterHunt.count=0;
 r.hunt.loot={id:'old',complete:false};r.pending();
 assert.equal(r.starts.length,1);assert.equal(r.hunt.stage,'returning');assert.equal(r.hunt.loot,undefined);assert.ok(r.hunt.turnIn);
});

test('explicit Hunt loot barrier requires a matching fresh acknowledgement, not delivery',()=>{
 const r=coordinator();r.state.activeConvoy={id:'race',purpose:'monster-hunt'};r.hunt.convoyId='race';
 assert.equal(r.pending(),true);
 assert.equal(r.state.activeConvoy,null);assert.match(huntMessage(r.hunt),/Pending Hunt loot/);
 assert.equal(r.pending(),true);
 const p={...r.hunt.loot,observedAt:101,complete:true};
 for(const bad of [{id:'old'},{realm:':EUI'},{in:'other'},{observedAt:100}]){
  r.state.statuses.W.huntLoot={...p,...bad};assert.equal(r.pending(),true);
 }
 r.state.statuses.W.huntLoot=p;assert.equal(r.pending(),false);
 assert.equal(r.hunt.missions[0].target,'snake');
});
test('pending loot never blocks explicit cancellation or an unfinished mission',()=>{
 const r=coordinator();r.state.statuses.P.monsterHunt.count=1;assert.equal(r.pending(),false);
 const c=coordinator();c.state.navigationIntents.W.cancelled=true;assert.equal(c.pending(),false);
});

test('fresh collector outside the old loot location releases an inherited hunt barrier',()=>{
 for(const change of [{x:500},{map:'cave',in:'cave'},{server:'EUI'}]){
  const r=coordinator();
  assert.equal(r.pending(),true);
  r.hunt.stage='checking-quests';r.hunt.cycleId='new-cycle';
  Object.assign(r.state.statuses.W,change);
  assert.equal(r.pending(),false);
  assert.equal(r.hunt.loot,undefined);
 }
});

test('an inherited barrier remains pending at its location and stale location reports cannot discard it',()=>{
 const r=coordinator();
 assert.equal(r.pending(),true);
 r.hunt.stage='checking-quests';r.hunt.cycleId='new-cycle';
 assert.equal(r.pending(),true);
 r.state.statuses.W.x=500;r.state.statuses.W.seenAt=-10000;
 assert.equal(r.pending(),true);assert.ok(r.hunt.loot);
});

test('final ghost kill blocks the queued neutral before quest count delivery, only for the mission owner',()=>{
 
 let quest={id:'ghost',count:1},name='P';
 const mission={cycleId:'cycle',missionRevision:1,currentIndex:0,target:'ghost',stage:'farming',missions:[{target:'ghost',owners:['P']}]};
 let api;
 try{
  api=installLootClient({},{lootPorts:gamePorts({name:()=>name,quest:()=>quest})});
  api.accept({serverNow:100,monsterHunt:mission});assert.equal(!!api.huntPending(),false);
  api.finalKill('ghost');assert.equal(api.huntPending(),true);
  quest.count=0;assert.equal(api.huntPending(),true);
  name='W';assert.equal(!!api.huntPending(),false,'another member with an incidental completed quest cannot stall the mission');
  name='P';api.accept({serverNow:101,monsterHunt:{...mission,missionRevision:2}});quest.count=5;
  assert.equal(!!api.huntPending(),false,'a new assignment cannot inherit the previous final kill');
 }finally{api?.stop();}
});

test('client ignores a selected neutral when deciding whether it must defend before loot',()=>{
 // Both reads are targeting's (threat.ts); the context reads them from its module (helpers/targeting-module.cjs).
 const {targetingContext}=require('./helpers/targeting-module.cjs');
 const entity={id:'next',type:'monster',visible:true};
 const c=targetingContext({root:{},parent:{entities:{next:entity}},character:{map:'main',in:'main'},reunionRealm:()=> 'USII',
  groupedCombat:{target:{...entity,state:'planned'},fights:[]},isAttackingPartyMember:t=>t.target==='W'});
 assert.equal(c.departureCombatPending(),false);entity.target='W';assert.equal(c.departureCombatPending(),true);
});

test('temporary convoy communication hold suspends collection without retiring its loot identity',async()=>{
 let api,calls=0,now=100;
 const position={realm:':USII',map:'main',in:'main',x:0,y:0};
 const loot={...position,id:'convoy-loot',after:90};
 try {
  lootPass=async()=>{calls++;if(calls===1)throw {reason:'openning'};return true;};
  api=installLootClient({},{lootPorts:gamePorts({socket:()=>({on(event,fn){if(event==='entities')queueMicrotask(fn);},off(){}})})});
  api.accept({serverNow:100,convoySignal:{phase:'defending',loot}});await api.convoy.tick();
  assert.equal(api.convoy.report().error,'openning');
  api.accept({serverNow:200,convoySignal:{phase:'communication-hold',loot}});await api.convoy.tick();
  assert.equal(calls,1);
  api.accept({serverNow:300,convoySignal:{phase:'defending',loot}});await api.convoy.tick();
  assert.equal(calls,2);assert.equal(api.convoy.report().complete,true);
 } finally {api?.stop();}
});
