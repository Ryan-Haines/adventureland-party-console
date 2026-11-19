const test=require('node:test'),assert=require('node:assert/strict');
const huntPolicy=require('../../runtime/hunting/coordinator/hunt.ts');
const {priority}=require('../../runtime/tasks/api.ts');
// The status line, which labelHunt keeps beside the Hunt record.
const {huntMessage}=require('../../runtime/hunting/coordinator/record.ts');
const {events}=require('./fixtures/coordinator-core.cjs');
// The rows drive the hunting owner's Hunt service (hunt.ts `createHunt`) through the names they were written on:
// a member's death reaches it as survival's `died` notice, and the Daisy step is a tick at Daisy.
function fixture(options={}) {
 let time=100000,convoys=[];
 const names=['W','P','M'], farm={map:'main',x:500,y:500}, destination={map:'tunnel',x:0,y:-1000};
 const party={leader:'W',followers:{P:true,M:true},targetMode:'hunt',monsterFocus:['snake'],monsterHunterLocation:{map:'main',x:126,y:-413},
  commands:{},nextCommandId:1,monsterSearchRadiusByCharacter:{W:400},activeConvoy:null,monsterHunt:null,
  // The Hunt's spawns are the catalog's (hunt.ts `coordinatorHuntDestination`); each quest's spawn is the row's destination.
  monsterChoices:['mole','rat','ghost','snake','bee'].map(id=>({id,locations:[destination]})),
  statuses:Object.fromEntries(names.map((name,i)=>[name,{name,hp:100,rip:false,seenAt:time,server:'II',map:'tunnel',x:0,y:-1000,monsterHunt:{id:['mole','rat','ghost'][i],count:10,remainingMs:1000000}}]))};
 events.party=()=>party;
 const r={party,huntPolicy,Date:{now:()=>time},huntTurnInOwnsTravel:priority,
  farmingNavigation:{intent:()=>({cancelled:false}),authorize(){}},
  startPartyMonsterConvoy:(location,label,participants,purpose)=>{convoys.push({location,purpose});party.activeConvoy={id:String(convoys.length),participants,purpose,phase:'assemble'};return true;}};
 require('./helpers/travel-observations.cjs').observeTravel(party.statuses);
 for(const s of Object.values(party.statuses))s.convoyProtocol=4;
 const service=huntPolicy.createHunt(party,{now:()=>time,participants:()=>names,online:()=>true,persist(){},
  cancelConvoy:()=>{party.activeConvoy=null;},selectedDestination:()=>({location:farm}),
  start:(...args)=>r.startPartyMonsterConvoy(...args),ownsTravel:priority,
  navigation:{intent:name=>r.farmingNavigation.intent(name),authorize:(...args)=>r.farmingNavigation.authorize(...args)}});
 Object.assign(r,{monsterHuntTick:service.tick,processHuntsAtDaisy:()=>service.tick(),startHuntConvoy:service.start,beginMonsterHuntCycle:(policy,location)=>service.begin(policy,location)});
 if (options.quests) for (const name of names) party.statuses[name].monsterHunt=options.quests[name] || null;
 party.huntBlacklist=options.blacklist || {};
 r.beginMonsterHuntCycle('auto',farm);
 const hunt=party.monsterHunt;party.activeConvoy=null;hunt.convoyId=null;hunt.stage='farming';
 return {r,party,hunt,convoys,destination,farm,service,advance(ms){time+=ms;for(const s of Object.values(party.statuses))s.seenAt=time;},
  die(name){party.statuses[name].rip=true;party.statuses[name].lastDeath={at:time};service.died({name,at:time});r.monsterHuntTick();}};
}

function collectFinalLoot(t) {
 t.r.monsterHuntTick();
 if(!t.hunt.loot)return;
 assert.equal(t.hunt.loot.complete,false);assert.match(huntMessage(t.hunt),/Pending Hunt loot/);
 t.advance(1);
 t.party.statuses[t.party.leader].huntLoot={...t.hunt.loot,observedAt:t.r.Date.now(),complete:true};
 t.r.monsterHuntTick();
}

test('reselected Hunt discards the old normal-farming convoy instead of calling it event travel',()=>{
 const t=fixture(),mission=t.hunt.missions[0];t.hunt.stage='farming';
 t.party.anniversary={eventCycle:{endsAt:399000,returnCompletedAt:99900}};
 // The Hunt death limit's farming walk carries its purpose (modes.ts, 'hunt-fallback').
 t.party.activeConvoy={id:'old-fallback',purpose:'hunt-fallback',label:"the leader's configured farming focus",location:t.farm};
 t.r.monsterHuntTick();
 assert.equal(t.party.activeConvoy,null);assert.equal(t.hunt.stage,'farming');assert.equal(t.hunt.missions[0],mission);
});

test('mission destination stays pinned as nearest spawn changes; combat outside radius cannot start regroup convoy',()=>{
 const t=fixture(),count=t.convoys.length;t.hunt.originArrivedAt=99900;t.destination.y=-300;t.party.statuses.W.y=-1450;t.party.statuses.W.target={hp:100,mtype:'mole'};t.r.monsterHuntTick();
 assert.equal(t.convoys.length,count);assert.equal(t.hunt.missions[0].destination.y,-1000);
 t.party.statuses.W.target=null;t.party.statuses.P.threats=[{hp:100}];t.r.monsterHuntTick();assert.equal(t.convoys.length,count);
});

for(const second of ['M','P']) test('multiple deaths on the failed quest still allow the next member: '+second,()=>{
 const t=fixture();t.die('M');t.party.statuses.M.rip=false;t.advance(5000);t.die(second);
 assert.equal(t.party.huntFailures.mole.deaths,2);assert.equal(t.party.targetMode,'hunt');assert.deepEqual(t.party.monsterFocus,['snake']);
 t.party.statuses[second].rip=false;t.advance(5000);t.r.monsterHuntTick();
 assert.equal(t.hunt.owner,'P');assert.equal(t.hunt.target,'rat');assert.equal(t.hunt.stage,'mission-travel');
});



test('manual navigation cancellation while awaiting respawn prevents fallback from reviving movement',()=>{
 const t=fixture();t.die('M');t.party.statuses.M.rip=false;t.advance(5000);t.die('P');
 const count=t.convoys.length;t.r.farmingNavigation.intent=()=>({cancelled:true});t.party.statuses.P.rip=false;t.r.monsterHuntTick();
 assert.match(huntMessage(t.hunt),/paused/);assert.equal(t.convoys.length,count);
});

test('a follower quest cannot replace a missing leader quest',()=>{
 const t=fixture({quests:{P:{id:'rat',count:50,remainingMs:900000}}});assert.equal(t.hunt.target,null);assert.equal(t.convoys.length,1);assert.deepEqual(t.convoys[0].location,t.party.monsterHunterLocation);
});
test('return planning waits for compatible runtimes without consuming retries',()=>{
 const t=fixture();delete t.party.statuses.W.convoyProtocol;
 t.party.statuses.W.monsterHunt.count=0;collectFinalLoot(t);
 assert.equal(t.party.activeConvoy,null);assert.equal(t.hunt.returnRetries,undefined);
 assert.match(huntMessage(t.hunt),/load the return-routing update/);
 t.party.statuses.W.convoyProtocol=4;t.r.monsterHuntTick();
 assert.equal(t.party.activeConvoy.returnRouting,true);
});

for (const remainingMs of [180001,180000,179999,60000,1,0]) test('unfinished leader farms until expiry despite optional fighting: '+remainingMs,()=>{
 const t=fixture(); t.party.statuses.W.monsterHunt.remainingMs=remainingMs;
 t.party.statuses.P.monsterHunt.remainingMs=1;
 t.party.statuses.W.target={hp:100,mtype:'mole'};
 t.r.monsterHuntTick();
 assert.equal(t.hunt.stage,remainingMs<=0?'daisy-sync-travel':'farming');
 if(remainingMs<=0)assert.deepEqual(t.convoys.at(-1).location,t.party.monsterHunterLocation);
 else assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),false);
});

test('pending follower reward retains turn-in ownership and yields to an event before quest refill',()=>{
 const t=fixture(); t.party.statuses.W.monsterHunt.count=0; t.party.statuses.P.monsterHunt.count=0;
 collectFinalLoot(t);
 t.party.activeConvoy=null;t.hunt.stage='at-daisy';
 for(const s of Object.values(t.party.statuses))Object.assign(s,t.party.monsterHunterLocation);
 t.r.processHuntsAtDaisy(t.hunt);
 assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),true);
 t.party.statuses.W.monsterHunt=null;t.r.processHuntsAtDaisy(t.hunt);
 assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),true,'follower reward still pending');
 t.party.statuses.P.monsterHunt=null;t.party.statuses.M.huntEventPending=true;
 t.r.processHuntsAtDaisy(t.hunt); assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),false);
 t.advance(3000);t.r.processHuntsAtDaisy(t.hunt);assert.equal(Object.keys(t.party.commands).length,0,'event goes before refilling');
 t.party.statuses.M.huntEventPending=false;t.r.processHuntsAtDaisy(t.hunt);
 assert.equal(t.party.commands.W.action,'assign');
});

test('unfinished leader already at Daisy under the old policy resumes farming instead of waiting for expiry',()=>{
 const t=fixture(); t.party.statuses.W.monsterHunt.remainingMs=180000;
 // A return saved under the previous policy can already be at Daisy.
 t.hunt.turnIn={owner:'W',phase:'returning'};t.party.activeConvoy=null;t.hunt.stage='at-daisy';
 for(const s of Object.values(t.party.statuses))Object.assign(s,t.party.monsterHunterLocation);
 t.r.processHuntsAtDaisy(t.hunt);assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),false);
 t.advance(3000);t.r.processHuntsAtDaisy(t.hunt);assert.equal(t.hunt.stage,'mission-travel');
 assert.equal(t.convoys.at(-1).location.map,'tunnel');
});

// 01 step 5 (01 design 4.2, "Daisy return held"): a failed protected turn-in climbs the turn-in's
// task ladder, so it restarts from where the party stands and holds nothing for Retry. It keeps
// ownership, one failure restarts it once, and a manual cancellation still stops it.
test('a failed protected turn-in restarts from where the party stands without releasing ownership',()=>{
 const t=fixture();t.party.statuses.W.monsterHunt.count=0;collectFinalLoot(t);
 t.hunt.turnIn=JSON.parse(JSON.stringify(t.hunt.turnIn));
 t.party.activeConvoy.phase='failed';t.party.activeConvoy.failure='Coordinator restarted; request a fresh convoy';t.party.activeConvoy.failureCode='runtime-lost';
 const before=t.convoys.length,convoy=t.party.activeConvoy;convoy.recoveryAttempts=1;convoy.retryExhausted=true;
 t.r.monsterHuntTick();
 assert.equal(t.convoys.length,before+1,'the return starts again');assert.equal(t.hunt.stage,'returning');
 assert.notEqual(t.party.activeConvoy,convoy);assert.doesNotMatch(huntMessage(t.hunt)||'',/Retry return/);
 assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),true);assert.deepEqual(t.convoys.at(-1).location,t.party.monsterHunterLocation);
 t.r.monsterHuntTick();assert.equal(t.convoys.length,before+1,'one failure restarts the return once');
 t.party.activeConvoy.phase='failed';t.party.activeConvoy.failure='runtime lost';
 t.advance(6000);t.r.farmingNavigation.intent=()=>({cancelled:true});t.r.monsterHuntTick();
 assert.equal(t.convoys.length,before+1,'manual cancellation cannot revive a route');
});

test('leadership switches targets and releases a turn-in owner who leaves the party',()=>{
 const t=fixture(); t.party.leader='P';t.party.followers.W=true;t.r.monsterHuntTick();
 assert.equal(t.hunt.owner,'P');assert.equal(t.hunt.target,'rat');
 t.party.activeConvoy=null;t.hunt.stage='farming';t.party.statuses.P.monsterHunt.count=0;collectFinalLoot(t);
 t.party.leader='M';t.party.followers.P=false;t.r.monsterHuntTick();assert.equal(t.hunt.turnIn,undefined);
 assert.ok(!t.hunt.participants.includes('P'));
 assert.equal(t.hunt.owner,'M');assert.equal(t.hunt.target,'ghost');
});

test('lost same-map return routes back into the shaped hunt zone',()=>{
 const t=fixture();t.destination.shapes=[{boundary:[-100,-1100,100,-900]}];
 t.hunt.missions[0].destination={...t.destination};
 for(const s of Object.values(t.party.statuses))Object.assign(s,{x:0,y:0});
 const before=t.convoys.length;t.r.monsterHuntTick();
 assert.equal(t.hunt.stage,'mission-travel');assert.equal(t.convoys.length,before+1);
});

test('new hunt departs directly from Daisy even when the generic shortcut would choose Town',()=>{
 const t=fixture();
 for(const status of Object.values(t.party.statuses))Object.assign(status,t.party.monsterHunterLocation);
 t.r.startPartyMonsterConvoy=(location,label,participants,purpose)=>{
   t.party.activeConvoy={id:'new-hunt',participants,purpose,townFirst:true};return true;
 };
 t.r.startHuntConvoy(t.hunt,{map:'main',x:520,y:753},'New hunt','mission-travel');
 assert.equal(t.party.activeConvoy.townFirst,false);
 assert.equal(t.hunt.stage,'mission-travel');assert.equal(t.party.activeConvoy.participants.length,3);
 t.party.activeConvoy=null;
 t.party.statuses.W.monsterHunt.count=0;
 t.r.huntPolicy.beginTurnIn(t.hunt,'W');
 t.r.startHuntConvoy(t.hunt,t.party.monsterHunterLocation,'Turn in','returning');
 assert.equal(t.party.activeConvoy,null,'already at Daisy: no convoy or Town needed');
 assert.equal(t.party.commands.W.action,'claim');
});

test('a completed hunt goes straight to the protected Daisy turn-in',()=>{
 const t=fixture();t.party.statuses.W.monsterHunt.count=0;
 collectFinalLoot(t);
 assert.equal(t.hunt.stage,'returning');assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),true);
});

for (const remainingMs of [1500000, 1500001, 1499999]) test('missing follower quests never cause a pickup detour: '+remainingMs,()=>{
 const t=fixture({quests:{W:{id:'rat',count:10,remainingMs}}});
 assert.equal(t.convoys[0].location.map,'tunnel');
 assert.equal(!!t.hunt.pickupPending,false);
});

test('any older quest skips missing pickup, even when another quest is fresh',()=>{
 const t=fixture({quests:{W:{id:'rat',count:10,remainingMs:1700000},P:{id:'ghost',count:10,remainingMs:1499999}}});
 assert.equal(t.convoys[0].location.map,'tunnel');
});

// The 07 design's cause 18 (07-1.md) clears an unanswered assignment on the member's answer, not a clock.
test('an unanswered assignment holds past fresh reports and is issued again after its failure receipt',()=>{
 const t=fixture({quests:{}});
 for(const status of Object.values(t.party.statuses))Object.assign(status,t.party.monsterHunterLocation);
 t.hunt.stage='assigning';t.party.activeConvoy=null;t.r.processHuntsAtDaisy(t.hunt);
 const id=t.party.commands.W.id;t.r.processHuntsAtDaisy(t.hunt);assert.equal(t.party.commands.W.id,id);
 t.advance(16000);t.r.processHuntsAtDaisy(t.hunt);assert.equal(t.party.commands.W.id,id);
 huntPolicy.completeHuntInteraction(t.party,'W',{commandId:id,cycleId:t.hunt.cycleId,success:false,error:'busy'});
 t.r.processHuntsAtDaisy(t.hunt);assert.notEqual(t.party.commands.W.id,id);
});


test('blacklisted followers are skipped while a nearly expired eligible quest is still farmed',()=>{
 const t=fixture({blacklist:{mole:{},rat:{}}});assert.equal(t.hunt.target,'ghost');assert.equal(t.hunt.owner,'M');
 const h=fixture({blacklist:{mole:{}},quests:{W:{id:'mole',count:10,remainingMs:1000000},P:{id:'rat',count:10,remainingMs:1000},M:{id:'ghost',count:10,remainingMs:900000}}});
 assert.equal(h.hunt.owner,'P');assert.equal(h.convoys.at(-1).location.map,'tunnel');
 assert.equal(h.r.huntTurnInOwnsTravel(h.hunt),false);
});

test('all active quests blacklisted retains Hunt and travels to backup instead of Daisy',()=>{
 const t=fixture({blacklist:{mole:{},rat:{},ghost:{}}});t.r.monsterHuntTick();assert.equal(t.party.targetMode,'hunt');assert.deepEqual(t.convoys[0].location,t.farm);assert.ok(t.hunt.backup);
});

function backupFixture(){
 const t=fixture({blacklist:{mole:{},rat:{},ghost:{}}});
 for(const s of Object.values(t.party.statuses))Object.assign(s,t.farm);
 t.r.monsterHuntTick();return t;
}
function collectBatch(t){
 const h=t.party.monsterHunt;if(h.stage!=='batch-loot')return;
 t.r.monsterHuntTick();assert.ok(h.loot);assert.equal(t.party.activeConvoy,null);
 t.advance(1);t.party.statuses.W.huntLoot={...h.loot,observedAt:t.r.Date.now(),complete:true};t.r.monsterHuntTick();
}
test('backup boundary drift cannot start travel while a nomination or attack remains valid',()=>{
 const t=backupFixture();for(const s of Object.values(t.party.statuses))s.x=2000;
 t.party.statuses.W.groupedCombat={candidates:[{id:'hound',map:'main',in:'main'}]};
 t.r.monsterHuntTick();assert.equal(t.convoys.length,0);assert.equal(t.hunt.stage,'backup-farming');
 t.party.statuses.W.groupedCombat={retentions:[{id:'hound',eligible:true}]};
 t.r.monsterHuntTick();assert.equal(t.convoys.length,0);
 t.party.statuses.W.groupedCombat={};require('./helpers/travel-observations.cjs').observeTravel(t.party.statuses);t.r.monsterHuntTick();assert.equal(t.convoys.length,1);
 t.r.monsterHuntTick();assert.equal(t.convoys.length,1);
});
test('backup arrival releases only its own convoy once; defense retains ownership',()=>{
 const t=backupFixture();t.hunt.stage='backup-travel';t.hunt.convoyId='backup';
 t.party.activeConvoy={id:'backup',purpose:'monster-hunt',phase:'travel'};
 t.r.monsterHuntTick();assert.equal(t.party.activeConvoy,null);assert.equal(t.hunt.stage,'backup-farming');
 t.r.monsterHuntTick();assert.equal(t.convoys.length,0);
 t.hunt.convoyId='backup';t.party.activeConvoy={id:'backup',purpose:'monster-hunt',phase:'defending'};
 t.r.monsterHuntTick();assert.equal(t.party.activeConvoy.phase,'defending');
});
test('backup waits for all three expiries then assigns the whole batch before selecting a mission',()=>{
 const t=backupFixture();assert.equal(t.hunt.stage,'backup-farming');
 for(const name of ['W','P']) {t.party.statuses[name].monsterHunt=null;t.r.monsterHuntTick();assert.equal(t.convoys.length,0);}
 t.party.statuses.M.monsterHunt.remainingMs=1;t.r.monsterHuntTick();assert.equal(t.convoys.length,0);
 t.party.statuses.M.monsterHunt=null;t.r.monsterHuntTick();assert.equal(t.convoys.length,0);collectBatch(t);assert.equal(t.convoys.length,1);assert.equal(t.hunt.batchPickup,true);
 t.r.monsterHuntTick();assert.equal(t.convoys.length,1);
 t.party.activeConvoy=null;t.hunt.stage='at-daisy';
 for(const s of Object.values(t.party.statuses))Object.assign(s,t.party.monsterHunterLocation);
 t.r.processHuntsAtDaisy(t.hunt);assert.equal(Object.keys(t.party.commands).length,3);
 t.party.statuses.W.monsterHunt={id:'bee',count:50,remainingMs:1800000};
 t.r.processHuntsAtDaisy(t.hunt);assert.ok(t.party.commands.W,'old observation cannot acknowledge assignment');
 t.advance(1);t.r.processHuntsAtDaisy(t.hunt);assert.equal(t.convoys.length,1);
 for(const name of ['P','M'])t.party.statuses[name].monsterHunt={id:'bee',count:50,remainingMs:1800000};
 // The hand-in waits for each member's report stamped after it (hunt.ts `eventsPending`).
 t.advance(1);t.r.processHuntsAtDaisy(t.hunt);t.advance(1);t.r.processHuntsAtDaisy(t.hunt);assert.equal(t.hunt.batchPickup,false);assert.equal(t.hunt.target,'bee');assert.equal(t.convoys.length,2);
});
test('offline members do not block batch readiness; restart and event return preserve the current batch',()=>{
 const t=backupFixture();for(const s of Object.values(t.party.statuses))s.monsterHunt=null;
 t.party.statuses.M.seenAt=0;t.r.monsterHuntTick();assert.equal(t.convoys.length,0);assert.deepEqual(t.hunt.participants,['W','P']);
 t.party.monsterHunt=JSON.parse(JSON.stringify(t.hunt));t.advance(1);
 t.party.eventReturn={};t.r.monsterHuntTick();assert.equal(t.convoys.length,0);assert.equal(t.party.monsterHunt.stage,'batch-loot');
 t.party.eventReturn=null;t.r.monsterHuntTick();collectBatch(t);assert.equal(t.convoys.length,1);assert.equal(t.party.monsterHunt.batchPickup,true);
});
test('backup preserves explicit cancellation and resumes a newly unblacklisted quest',()=>{
 const t=backupFixture();t.r.farmingNavigation.intent=()=>({cancelled:true});
 for(const s of Object.values(t.party.statuses))s.monsterHunt=null;
 t.r.monsterHuntTick();assert.equal(t.convoys.length,0);
 const u=backupFixture();delete u.party.huntBlacklist.rat;u.r.monsterHuntTick();assert.equal(u.hunt.target,'rat');assert.equal(u.hunt.backup,undefined);
});
test('explicit roster removal releases only that member from the expiry batch',()=>{
 const t=backupFixture();t.party.statuses.W.monsterHunt=null;t.party.statuses.P.monsterHunt=null;
 t.party.statuses.M.seenAt=0;t.r.monsterHuntTick();assert.equal(t.convoys.length,0);
 delete t.party.followers.M;t.r.monsterHuntTick();collectBatch(t);assert.equal(t.convoys.length,1);assert.deepEqual(t.hunt.participants,['W','P']);
});
test('another entirely blacklisted batch returns to backup without ending Hunt',()=>{
 const t=backupFixture();for(const s of Object.values(t.party.statuses))s.monsterHunt=null;t.r.monsterHuntTick();collectBatch(t);
 t.party.activeConvoy=null;t.hunt.stage='at-daisy';for(const s of Object.values(t.party.statuses))Object.assign(s,t.party.monsterHunterLocation);
 t.r.processHuntsAtDaisy(t.hunt);t.advance(1);
 for(const s of Object.values(t.party.statuses))s.monsterHunt={id:'mole',count:30,remainingMs:1800000};
 t.r.processHuntsAtDaisy(t.hunt);t.advance(1);t.r.processHuntsAtDaisy(t.hunt);assert.equal(t.party.targetMode,'hunt');assert.ok(t.hunt.backup);assert.equal(t.hunt.stage,'backup-travel');
 t.r.monsterHuntTick();const count=t.convoys.length;t.r.monsterHuntTick();assert.equal(t.convoys.length,count);
});
test('blacklist survives cycle restart and clearing entry makes it eligible again',()=>{
 const t=fixture();t.die('M');t.party.statuses.M.rip=false;t.r.beginMonsterHuntCycle('auto',t.farm);assert.notEqual(t.party.monsterHunt.target,'mole');
 delete t.party.huntBlacklist.mole;t.r.beginMonsterHuntCycle('auto',t.farm);assert.equal(t.party.monsterHunt.target,'mole');
});


test('failed leader gets a fresh follower quest; only all three blacklisted quests trigger fallback',()=>{
 const t=fixture({quests:{W:{id:'mole',count:10,remainingMs:900000}}});
 t.die('M');t.party.statuses.M.rip=false;t.advance(5000);t.r.monsterHuntTick();
 assert.equal(t.party.targetMode,'hunt');assert.equal(t.hunt.owner,'P');assert.equal(t.hunt.stage,'daisy-sync-travel');
 const arrive=()=>{t.party.activeConvoy=null;t.hunt.convoyId=null;t.hunt.stage='assigning';for(const s of Object.values(t.party.statuses))Object.assign(s,t.party.monsterHunterLocation);t.r.processHuntsAtDaisy(t.hunt);};
 arrive();assert.equal(t.party.commands.P.action,'assign');assert.equal(t.party.commands.M,undefined);
 t.party.statuses.P.monsterHunt={id:'rat',count:10,remainingMs:1800000};t.r.processHuntsAtDaisy(t.hunt);
 assert.equal(t.hunt.target,'rat');assert.equal(t.hunt.owner,'P');
 t.party.activeConvoy=null;t.hunt.convoyId=null;t.hunt.stage='farming';t.advance(5000);t.die('M');
 t.party.statuses.M.rip=false;t.advance(5000);t.r.monsterHuntTick();
 assert.equal(t.hunt.owner,'M');assert.equal(t.party.targetMode,'hunt');
 arrive();assert.equal(t.party.commands.M.action,'assign');
 t.party.statuses.M.monsterHunt={id:'ghost',count:10,remainingMs:1800000};t.r.processHuntsAtDaisy(t.hunt);
 assert.equal(t.hunt.target,'ghost');
 t.party.activeConvoy=null;t.hunt.convoyId=null;t.hunt.stage='farming';t.advance(5000);t.die('M');
 t.party.statuses.M.rip=false;t.advance(5000);t.r.monsterHuntTick();
 t.r.monsterHuntTick();assert.equal(t.party.targetMode,'hunt');assert.deepEqual(t.convoys.at(-1).location,t.farm);
 assert.equal(Object.keys(t.party.huntBlacklist).length,3);
});

test('receiving an already blacklisted quest immediately assigns only the next member',()=>{
 const t=fixture({quests:{},blacklist:{mole:{}}});
 for(const s of Object.values(t.party.statuses))Object.assign(s,t.party.monsterHunterLocation);
 t.party.activeConvoy=null;t.hunt.stage='assigning';t.r.processHuntsAtDaisy(t.hunt);
 assert.equal(t.party.commands.W.action,'assign');
 t.party.statuses.W.monsterHunt={id:'mole',count:10,remainingMs:1800000};t.r.processHuntsAtDaisy(t.hunt);
 assert.equal(t.party.commands.W,undefined);assert.equal(t.party.commands.P.action,'assign');assert.equal(t.party.commands.M,undefined);
});
function arrivalFixture() {
 const t=fixture();t.hunt.stage='mission-travel';t.hunt.convoyId='arrival';
 t.r.farmingNavigation.intent=()=>({revision:7,cancelled:false});
 for(const s of Object.values(t.party.statuses)){s.map='main';s.combatSelection={runtimeId:'runtime'};}
 const follower={id:55,type:'event-resume-travel',convoyHandoff:'arrival'};t.party.commands.P=follower;
 const accepted=huntPolicy.acceptArrival(t.hunt,{id:'arrival',epoch:8,purpose:'monster-hunt',location:t.destination},
   {character:'W',runtimeId:'runtime',navigationRevision:7,target:{mtype:'mole'}},100000);
 assert.equal(accepted,true);assert.equal(t.hunt.stage,'farming');
 return {...t,follower};
}
test('old early handoff receipt does not bypass full-party origin arrival',()=>{
 const t=arrivalFixture(),before=t.convoys.length;t.r.monsterHuntTick();
 assert.equal(t.convoys.length,before+1);assert.equal(t.hunt.stage,'mission-travel');
});

test('arrival grace expires and permits recovery from a genuine outside position',()=>{
 const t=arrivalFixture(),before=t.convoys.length;t.advance(10000);t.r.monsterHuntTick();
 assert.equal(t.convoys.length,before+1);assert.equal(t.hunt.stage,'mission-travel');
});
for(const mutate of [t=>t.hunt.cycleId='new',t=>t.hunt.currentIndex++,
 t=>t.party.statuses.W.combatSelection.runtimeId='new',t=>t.r.farmingNavigation.intent=()=>({revision:8,cancelled:false})])
test('superseded arrival receipt does not suppress recovery: '+mutate.toString(),()=>{
 const t=arrivalFixture(),before=t.convoys.length;mutate(t);t.r.monsterHuntTick();
 assert.equal(t.convoys.length,before+1);
});
test('arrival grace cannot delay a completed hunt turn-in or revive cancelled navigation',()=>{
 const t=arrivalFixture();t.party.statuses.W.monsterHunt.count=0;collectFinalLoot(t);
 assert.equal(t.hunt.stage,'returning');assert.equal(t.hunt.arrivalHandoff,undefined);
 const u=arrivalFixture(),before=u.convoys.length;u.r.farmingNavigation.intent=()=>({revision:8,cancelled:true});
 u.r.monsterHuntTick();assert.equal(u.convoys.length,before);
});

test('an expired unfinished quest is blacklisted before acquiring the next quest',()=>{
 const t=fixture();t.hunt.stage='waiting-expiry';t.hunt.waitForExpiry=true;t.party.activeConvoy=null;
 for(const s of Object.values(t.party.statuses))Object.assign(s,t.party.monsterHunterLocation);
 t.party.statuses.W.monsterHunt=null;t.r.processHuntsAtDaisy(t.hunt);
 assert.match(t.party.huntBlacklist.mole.reason,/expired/);assert.equal(t.party.commands.W.action,'assign');
 assert.equal(t.party.huntBlacklist.mole.expirations,1);
 t.r.processHuntsAtDaisy(t.hunt);assert.equal(t.party.huntBlacklist.mole.expirations,1);
});


for(const enabled of [false])test('death below threshold resumes the same Hunt; enabled='+enabled,()=>{
 const t=fixture();t.party.huntSettings={...require('../../runtime/hunting/saved-fields.ts').defaultHuntSettings,blacklistDeaths:enabled,deathThreshold:2};
 t.die('M');assert.equal(t.party.huntBlacklist.mole,undefined);assert.equal(!!t.hunt.missions[0].skipped,false);assert.equal(t.hunt.recovering,true);
 t.party.statuses.M.rip=false;t.advance(5000);t.r.monsterHuntTick();assert.equal(t.hunt.target,'mole');assert.equal(t.hunt.recovering,false);
 t.die('M');assert.equal(t.party.huntFailures.mole.deaths,2);assert.equal(!!t.party.huntBlacklist.mole,enabled);
});
