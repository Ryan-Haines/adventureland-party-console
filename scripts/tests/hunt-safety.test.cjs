const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const safety=require('../hunt-safety.cjs');
const source=require('./helpers/coordinator-source.cjs').coordinatorSource();
function fixture(options={}) {
 let time=100000,convoys=[];
 const names=['W','P','M'], farm={map:'main',x:500,y:500}, destination={map:'tunnel',x:0,y:-1000};
 const party={leader:'W',followers:{P:true,M:true},farmingPolicy:'hunt',monsterFocus:['snake'],monsterHunterLocation:{map:'main',x:126,y:-413},
  commands:{},nextCommandId:1,monsterSearchRadiusByCharacter:{W:400},statuses:Object.fromEntries(names.map((name,i)=>[name,{name,hp:100,rip:false,seenAt:time,map:'tunnel',x:0,y:-1000,monsterHunt:{id:['mole','rat','ghost'][i],count:10,remainingMs:1000000}}]))};
 const r={party,huntPolicy:require('../../runtime/hunt/policy.ts'),farmZones:require('../../.build/shared/farming-zones.cjs'),huntSafety:safety,Date:{now:()=>time},huntParticipants:()=>names,clearMonsterHuntState:()=>{party.monsterHunt=null;},cancelHuntConvoy:()=>{if(party.activeConvoy?.purpose==='monster-hunt')party.activeConvoy=null;},cancelActiveConvoy:()=>{party.activeConvoy=null;},
  farmingNavigation:{intent:()=>({cancelled:false}),authorize(){}},huntThreat:()=>({threat:1,hp:1}),monsterDestination:()=>({...destination}),selectedMonsterDestination:()=>({location:farm}),persistSettings(){},
  startPartyMonsterConvoy:(location,label,participants,purpose)=>{convoys.push({location,purpose});party.activeConvoy={id:String(convoys.length),participants,purpose};return true;}};
 require('./helpers/travel-observations.cjs').observeTravel(party.statuses);
 for(const s of Object.values(party.statuses))s.convoyProtocol=4;
 require('./helpers/coordinator-hunt.cjs').installHuntTick(r);
 if (options.quests) for (const name of names) party.statuses[name].monsterHunt=options.quests[name] || null;
 party.huntBlacklist=options.blacklist || {};
 r.beginMonsterHuntCycle('auto',farm);
 const hunt=party.monsterHunt;party.activeConvoy=null;hunt.convoyId=null;hunt.stage='farming';
 return {r,party,hunt,convoys,destination,farm,advance(ms){time+=ms;for(const s of Object.values(party.statuses))s.seenAt=time;},die(name){party.statuses[name].rip=true;party.statuses[name].lastDeath={at:time};r.monsterHuntTick();}};
}

function collectFinalLoot(t) {
 t.r.monsterHuntTick();
 if(!t.hunt.loot)return;
 assert.equal(t.hunt.loot.complete,false);assert.match(t.hunt.message,/Pending Hunt loot/);
 t.advance(1);
 t.party.statuses[t.party.leader].huntLoot={...t.hunt.loot,observedAt:t.r.Date.now(),complete:true};
 t.r.monsterHuntTick();
}
test('starting Hunt follows only the leader quest without visiting Daisy for followers',()=>{
 const t=fixture();assert.equal(t.hunt.target,'mole');assert.equal(t.hunt.missions.length,1);assert.equal(Object.keys(t.party.commands).length,0);assert.equal(t.convoys.at(-1).location.map,'tunnel');assert.equal(t.convoys.length,1);
});

test('completed featured kiss return resumes Hunt before the five-minute selection ends',()=>{
 const t=fixture(),mission=t.hunt.missions[0],cycle=t.hunt.cycleId;
 t.hunt.stage='paused-event';t.hunt.resumeStage='farming';
 t.party.anniversary={eventCycle:{target:'W',startsAt:99000,endsAt:399000,returnDispatchedAt:99500,returnCompletedAt:99900}};
 t.r.monsterHuntTick();
 assert.equal(t.hunt.stage,'farming');assert.equal(t.hunt.cycleId,cycle);assert.equal(t.hunt.missions[0],mission);
 assert.equal(t.party.activeConvoy,null);
});

test('reselected Hunt discards the old normal-farming convoy instead of calling it event travel',()=>{
 const t=fixture(),mission=t.hunt.missions[0];t.hunt.stage='paused-event';
 t.party.anniversary={eventCycle:{endsAt:399000,returnCompletedAt:99900}};
 t.party.activeConvoy={id:'old-fallback',purpose:null,label:"the leader's configured farming focus",location:t.farm};
 t.r.monsterHuntTick();
 assert.equal(t.party.activeConvoy,null);assert.equal(t.hunt.stage,'farming');assert.equal(t.hunt.missions[0],mission);
});

test('Hunt still waits for a genuine event return even when already standing in the Hunt zone',()=>{
 const t=fixture();t.party.anniversary={eventCycle:{endsAt:399000,returnDispatchedAt:99900}};
 t.party.activeConvoy={id:'event',purpose:'anniversary-return'};
 t.r.monsterHuntTick();assert.equal(t.hunt.stage,'paused-event');assert.equal(t.party.activeConvoy.id,'event');
 t.party.activeConvoy={id:'manual',purpose:'manual-navigation'};
 t.party.anniversary.eventCycle.returnCompletedAt=99999;t.r.monsterHuntTick();assert.equal(t.party.activeConvoy.id,'manual');
});
test('mission destination stays pinned as nearest spawn changes; combat outside radius cannot start regroup convoy',()=>{
 const t=fixture(),count=t.convoys.length;t.destination.y=-300;t.party.statuses.W.y=-1450;t.party.statuses.W.target={hp:100,mtype:'mole'};t.r.monsterHuntTick();
 assert.equal(t.convoys.length,count);assert.equal(t.hunt.missions[0].destination.y,-1000);
 t.party.statuses.W.target=null;t.party.statuses.P.threats=[{hp:100}];t.r.monsterHuntTick();assert.equal(t.convoys.length,count);
});
test('first death blacklists current mission, waits for respawn, and counts duplicate reports once',()=>{
 const t=fixture();t.die('M');assert.equal(t.hunt.deathCount,1);assert.equal(t.hunt.target,'mole');assert.equal(t.hunt.missions[0].skipped,true);assert.equal(t.hunt.recovering,false);assert.equal(t.party.huntBlacklist.mole.deaths,1);
 t.r.monsterHuntTick();assert.equal(t.hunt.deathCount,1);assert.equal(t.party.activeConvoy,null);
});
for(const second of ['M','P']) test('multiple deaths on the failed quest still allow the next member: '+second,()=>{
 const t=fixture();t.die('M');t.party.statuses.M.rip=false;t.advance(5000);t.hunt.deathObservations.M.dead=false;t.die(second);
 assert.equal(t.hunt.deathCount,2);assert.equal(t.party.farmingPolicy,'hunt');assert.deepEqual(t.party.monsterFocus,['snake']);
 t.party.statuses[second].rip=false;t.advance(5000);t.r.monsterHuntTick();
 assert.equal(t.hunt.owner,'P');assert.equal(t.hunt.target,'rat');assert.equal(t.hunt.stage,'mission-travel');
});

test('persisted death observations prevent recounting an old death after restart',()=>{
 const t=fixture();t.die('M');const restored=JSON.parse(JSON.stringify(t.hunt));assert.deepEqual(safety.recordDeaths(restored,t.party.statuses,100000),[]);assert.equal(restored.deathCount,1);
});

test('manual navigation cancellation while awaiting respawn prevents fallback from reviving movement',()=>{
 const t=fixture();t.die('M');t.party.statuses.M.rip=false;t.advance(5000);t.die('P');
 const count=t.convoys.length;t.r.farmingNavigation.intent=()=>({cancelled:true});t.party.statuses.P.rip=false;t.r.monsterHuntTick();
 assert.match(t.hunt.message,/paused/);assert.equal(t.convoys.length,count);
});

test('a follower quest cannot replace a missing leader quest',()=>{
 const t=fixture({quests:{P:{id:'rat',count:50,remainingMs:900000}}});assert.equal(t.hunt.target,null);assert.equal(t.convoys.length,1);assert.deepEqual(t.convoys[0].location,t.party.monsterHunterLocation);
});
test('return planning waits for compatible runtimes without consuming retries',()=>{
 const t=fixture();delete t.party.statuses.W.convoyProtocol;
 t.party.statuses.W.monsterHunt.count=0;collectFinalLoot(t);
 assert.equal(t.party.activeConvoy,null);assert.equal(t.hunt.returnRetries,0);
 assert.match(t.hunt.message,/load the return-routing update/);
 t.party.statuses.W.convoyProtocol=4;t.r.monsterHuntTick();
 assert.equal(t.party.activeConvoy.returnRouting,true);
});

for (const remainingMs of [180001,180000,179999]) test('leader cutoff before fighting deferrals: '+remainingMs,()=>{
 const t=fixture(); t.party.statuses.W.monsterHunt.remainingMs=remainingMs;
 t.party.statuses.P.monsterHunt.remainingMs=1;
 t.party.statuses.W.target={hp:100,mtype:'mole'};
 t.r.monsterHuntTick();
 assert.equal(t.hunt.stage,remainingMs<=180000?'returning':'farming');
 assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),remainingMs<=180000);
});

test('completed leader returns immediately and protects incidental follower claims until confirmed',()=>{
 const t=fixture(); t.party.statuses.W.monsterHunt.count=0; t.party.statuses.P.monsterHunt.count=0;
 collectFinalLoot(t); assert.equal(t.hunt.stage,'returning');
 t.party.activeConvoy=null;t.hunt.stage='at-daisy';
 for(const s of Object.values(t.party.statuses))Object.assign(s,t.party.monsterHunterLocation);
 t.r.processHuntsAtDaisy(t.hunt);
 assert.equal(t.party.commands.W.action,'claim');assert.equal(t.party.commands.P.action,'claim');
 assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),true);
 t.party.statuses.W.monsterHunt=null;t.r.processHuntsAtDaisy(t.hunt);
 assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),true,'follower reward still pending');
 t.party.statuses.P.monsterHunt=null;t.party.statuses.M.huntEventPending=true;
 t.r.processHuntsAtDaisy(t.hunt); assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),false);
 t.advance(3000);t.r.processHuntsAtDaisy(t.hunt);assert.equal(Object.keys(t.party.commands).length,0,'event goes before refilling');
 t.party.statuses.M.huntEventPending=false;t.r.processHuntsAtDaisy(t.hunt);
 assert.equal(t.party.commands.W.action,'assign');
});

test('unfinished leader releases event priority at Daisy without waiting for expiry',()=>{
 const t=fixture(); t.party.statuses.W.monsterHunt.remainingMs=180000;
 t.r.monsterHuntTick();t.party.activeConvoy=null;t.hunt.stage='at-daisy';
 for(const s of Object.values(t.party.statuses))Object.assign(s,t.party.monsterHunterLocation);
 t.r.processHuntsAtDaisy(t.hunt);assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),false);
 t.advance(3000);t.r.processHuntsAtDaisy(t.hunt);assert.equal(t.hunt.stage,'waiting-expiry');
});

test('restart resumes a failed protected turn-in without releasing events or reselecting hunts',()=>{
 const t=fixture();t.party.statuses.W.monsterHunt.count=0;collectFinalLoot(t);
 t.hunt.turnIn=JSON.parse(JSON.stringify(t.hunt.turnIn));
 t.party.activeConvoy.phase='failed';t.party.activeConvoy.failure='Coordinator restarted; request a fresh convoy';t.party.activeConvoy.failureCode='runtime-lost';
 const before=t.convoys.length;t.r.monsterHuntTick();
 assert.equal(t.convoys.length,before+1);assert.equal(t.hunt.stage,'returning');
 assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),true);assert.deepEqual(t.convoys.at(-1).location,t.party.monsterHunterLocation);
 t.party.activeConvoy.phase='failed';t.party.activeConvoy.failure='runtime lost';
 t.r.monsterHuntTick();assert.equal(t.convoys.length,before+1,'retry is throttled');
 t.advance(6000);t.r.farmingNavigation.intent=()=>({cancelled:true});t.r.monsterHuntTick();
 assert.equal(t.convoys.length,before+1,'manual cancellation cannot revive a route');
});

test('leadership switches targets but waits for an active turn-in to finish',()=>{
 const t=fixture(); t.party.leader='P';t.party.followers.W=true;t.r.monsterHuntTick();
 assert.equal(t.hunt.owner,'P');assert.equal(t.hunt.target,'rat');
 t.party.activeConvoy=null;t.hunt.stage='farming';t.party.statuses.P.monsterHunt.count=0;collectFinalLoot(t);
 t.party.leader='M';t.party.followers.P=false;t.r.monsterHuntTick();assert.equal(t.hunt.turnIn.owner,'P');
 assert.ok(t.hunt.participants.includes('P'),'retain the old owner until the claim finishes');
 assert.equal(t.hunt.owner,'P');assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),true);
});

for (const reason of ['kiss-timeout']) test('Hunt preserves anniversary return and resumes after '+reason,()=>{
 const t=fixture(), cycle={abortedAt:100000,abortReason:reason,returnDispatchedAt:100000};
 t.party.anniversary={eventCycle:cycle};
 const convoy=t.party.activeConvoy={id:'event-return',purpose:'anniversary-return',phase:'travel'};
 const before=t.convoys.length;
 t.r.monsterHuntTick();t.r.monsterHuntTick();
 assert.equal(t.party.activeConvoy,convoy);assert.equal(t.hunt.stage,'paused-event');assert.equal(t.convoys.length,before);
 t.party.activeConvoy=null;t.r.monsterHuntTick();
 assert.equal(t.convoys.length,before,'individual return commands also retain ownership');
 cycle.returnCompletedAt=100001;t.r.monsterHuntTick();
 assert.equal(t.hunt.stage,'farming');assert.equal(t.convoys.length,before,'already-arrived event return does not start another convoy');
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

test('event return releases a completed hunt straight to protected Daisy turn-in',()=>{
 const t=fixture();t.party.eventReturn={};t.party.statuses.W.monsterHunt.count=0;
 t.r.monsterHuntTick();assert.equal(t.hunt.stage,'paused-event');
 t.party.eventReturn=null;collectFinalLoot(t);
 assert.equal(t.hunt.stage,'returning');assert.equal(t.r.huntTurnInOwnsTravel(t.hunt),true);
});
test('no active quests sends party to Daisy for assignments',()=>{
 const t=fixture({quests:{}});assert.deepEqual(t.convoys[0].location,t.party.monsterHunterLocation);
});

for (const remainingMs of [1500000, 1500001, 1499999]) test('missing follower quests never cause a pickup detour: '+remainingMs,()=>{
 const t=fixture({quests:{W:{id:'rat',count:10,remainingMs}}});
 assert.equal(t.convoys[0].location.map,'tunnel');
 assert.equal(!!t.hunt.pickupPending,false);
});

test('resume preserves cycle and deaths without filling followers after leader received quest',()=>{
 const t=fixture({quests:{W:{id:'rat',count:10,remainingMs:1500000}}});
 t.hunt.deathCount=1;t.hunt.pickupPending=true;const cycle=t.hunt.cycleId;
 t.party.statuses.W.monsterHunt.remainingMs=1400000;
 t.party.statuses.P.seenAt=0;
 t.r.beginMonsterHuntCycle('auto',t.farm,true);
 assert.equal(t.party.monsterHunt.cycleId,cycle);assert.equal(t.hunt.deathCount,1);
 assert.equal(t.hunt.stage,'checking-quests');assert.match(t.hunt.message,/P/);
 t.advance(100);t.r.monsterHuntTick();assert.equal(t.hunt.stage,'mission-travel');
 assert.equal(t.hunt.pickupPending,false);assert.equal(t.hunt.owner,'W');
});

test('Daisy assigns only the leader and departs as soon as that quest is received',()=>{
 const t=fixture({quests:{}});t.hunt.stage='assigning';t.party.activeConvoy=null;
 t.r.processHuntsAtDaisy(t.hunt);assert.equal(Object.keys(t.party.commands).length,0);
 for(const status of Object.values(t.party.statuses))Object.assign(status,t.party.monsterHunterLocation);
 t.party.activeConvoy=null;t.hunt.stage='assigning';t.r.processHuntsAtDaisy(t.hunt);
 assert.equal(t.party.commands.W.action,'assign');assert.equal(t.party.commands.P,undefined);assert.equal(t.party.commands.M,undefined);
 t.party.statuses.W.monsterHunt={id:'rat',count:10,remainingMs:1700000};
 t.r.processHuntsAtDaisy(t.hunt);assert.equal(Object.keys(t.party.commands).length,0);
 assert.equal(t.hunt.pickupPending,false);assert.equal(t.hunt.target,'rat');
});

test('any older quest skips missing pickup, even when another quest is fresh',()=>{
 const t=fixture({quests:{W:{id:'rat',count:10,remainingMs:1700000},P:{id:'ghost',count:10,remainingMs:1499999}}});
 assert.equal(t.convoys[0].location.map,'tunnel');
});

test('legacy interrupted assigning stage is resumed even without a stored pickup flag',()=>{
 const t=fixture({quests:{W:{id:'rat',count:10,remainingMs:1400000}}});
 t.hunt.stage='assigning';delete t.hunt.pickupPending;t.hunt.deathCount=1;
 t.r.beginMonsterHuntCycle('auto',t.farm,true);
 assert.equal(t.hunt.pickupPending,false);assert.equal(t.hunt.deathCount,1);
 assert.equal(t.convoys.at(-1).location.map,'tunnel');
});

test('expired unanswered assignment retries only with a newer fresh status',()=>{
 const t=fixture({quests:{}});
 for(const status of Object.values(t.party.statuses))Object.assign(status,t.party.monsterHunterLocation);
 t.hunt.stage='assigning';t.party.activeConvoy=null;t.r.processHuntsAtDaisy(t.hunt);
 const id=t.party.commands.W.id;t.r.processHuntsAtDaisy(t.hunt);assert.equal(t.party.commands.W.id,id);
 t.advance(16000);t.r.processHuntsAtDaisy(t.hunt);assert.notEqual(t.party.commands.W.id,id);
});
test('blacklisted leader quest selects a follower and keeps its owner through combat and turn-in',()=>{
 const t=fixture({blacklist:{mole:{monsterId:'mole'}}});
 assert.equal(t.hunt.target,'rat');assert.equal(t.hunt.owner,'P');assert.equal(t.party.farmingPolicy,'hunt');
 const count=t.convoys.length;t.r.monsterHuntTick();assert.equal(t.convoys.length,count);
 assert.equal(t.hunt.owner,'P');assert.equal(t.hunt.target,'rat');
 t.party.statuses.P.monsterHunt.count=0;collectFinalLoot(t);
 assert.equal(t.hunt.turnIn.owner,'P');assert.equal(t.hunt.stage,'returning');
});

test('blacklisted followers are skipped while a nearly expired eligible quest retains turn-in priority',()=>{
 const t=fixture({blacklist:{mole:{},rat:{}}});assert.equal(t.hunt.target,'ghost');assert.equal(t.hunt.owner,'M');
 const h=fixture({blacklist:{mole:{}},quests:{W:{id:'mole',count:10,remainingMs:1000000},P:{id:'rat',count:10,remainingMs:1000},M:{id:'ghost',count:10,remainingMs:900000}}});
 assert.equal(h.hunt.owner,'P');assert.equal(h.convoys.at(-1).location.map,'main');
});

test('all active quests blacklisted retains Hunt and travels to backup instead of Daisy',()=>{
 const t=fixture({blacklist:{mole:{},rat:{},ghost:{}}});t.r.monsterHuntTick();assert.equal(t.party.farmingPolicy,'hunt');assert.deepEqual(t.convoys[0].location,t.farm);assert.ok(t.hunt.backup);
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
 t.advance(1);t.r.processHuntsAtDaisy(t.hunt);assert.equal(t.hunt.batchPickup,false);assert.equal(t.hunt.target,'bee');assert.equal(t.convoys.length,2);
});
test('one stale member blocks batch readiness; restart and event return preserve backup wait',()=>{
 const t=backupFixture();for(const s of Object.values(t.party.statuses))s.monsterHunt=null;
 t.party.statuses.M.seenAt=0;t.r.monsterHuntTick();assert.equal(t.convoys.length,0);assert.match(t.hunt.message,/fresh status.*M/);
 t.party.monsterHunt=JSON.parse(JSON.stringify(t.hunt));t.advance(1);
 t.party.eventReturn={};t.r.monsterHuntTick();assert.equal(t.convoys.length,0);assert.equal(t.party.monsterHunt.stage,'paused-event');
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
 t.r.processHuntsAtDaisy(t.hunt);assert.equal(t.party.farmingPolicy,'hunt');assert.ok(t.hunt.backup);assert.equal(t.hunt.stage,'backup-travel');
 t.r.monsterHuntTick();const count=t.convoys.length;t.r.monsterHuntTick();assert.equal(t.convoys.length,count);
});
test('blacklist survives cycle restart and clearing entry makes it eligible again',()=>{
 const t=fixture();t.die('M');t.party.statuses.M.rip=false;t.r.beginMonsterHuntCycle('auto',t.farm);assert.notEqual(t.party.monsterHunt.target,'mole');
 delete t.party.huntBlacklist.mole;t.r.beginMonsterHuntCycle('auto',t.farm);assert.equal(t.party.monsterHunt.target,'mole');
});
test('blacklist API removes individually, clears all, and rejects unknown actions',()=>{
 let route;const party={huntBlacklist:{mole:{},rat:{}},monsterChoices:[{id:'mole'},{id:'rat'}]};
 route=require('../../runtime/coordinator/http/hunt-control.ts').createHuntBlacklistRoute(party,{now:()=>Date.now(),persist(){}});
 const res={status(n){this.code=n;return this;},json(){}};
 route({body:{action:'remove',monsterId:'mole'}},res);assert.equal(party.huntBlacklist.mole,undefined);assert.ok(party.huntBlacklist.rat);
 route({body:{action:'invalid'}},res);assert.equal(res.code,400);assert.ok(party.huntBlacklist.rat);
 route({body:{action:'clear'}},res);assert.equal(Object.keys(party.huntBlacklist).length,0);
});

test('failed leader gets a fresh follower quest; only all three blacklisted quests trigger fallback',()=>{
 const t=fixture({quests:{W:{id:'mole',count:10,remainingMs:900000}}});
 t.die('M');t.party.statuses.M.rip=false;t.advance(5000);t.r.monsterHuntTick();
 assert.equal(t.party.farmingPolicy,'hunt');assert.equal(t.hunt.owner,'P');assert.equal(t.hunt.stage,'daisy-sync-travel');
 const arrive=()=>{t.party.activeConvoy=null;t.hunt.convoyId=null;t.hunt.stage='assigning';for(const s of Object.values(t.party.statuses))Object.assign(s,t.party.monsterHunterLocation);t.r.processHuntsAtDaisy(t.hunt);};
 arrive();assert.equal(t.party.commands.P.action,'assign');assert.equal(t.party.commands.M,undefined);
 t.party.statuses.P.monsterHunt={id:'rat',count:10,remainingMs:1800000};t.r.processHuntsAtDaisy(t.hunt);
 assert.equal(t.hunt.target,'rat');assert.equal(t.hunt.owner,'P');
 t.party.activeConvoy=null;t.hunt.convoyId=null;t.hunt.stage='farming';t.advance(5000);t.die('M');
 t.party.statuses.M.rip=false;t.advance(5000);t.r.monsterHuntTick();
 assert.equal(t.hunt.owner,'M');assert.equal(t.party.farmingPolicy,'hunt');
 arrive();assert.equal(t.party.commands.M.action,'assign');
 t.party.statuses.M.monsterHunt={id:'ghost',count:10,remainingMs:1800000};t.r.processHuntsAtDaisy(t.hunt);
 assert.equal(t.hunt.target,'ghost');
 t.party.activeConvoy=null;t.hunt.convoyId=null;t.hunt.stage='farming';t.advance(5000);t.die('M');
 t.party.statuses.M.rip=false;t.advance(5000);t.r.monsterHuntTick();
 t.r.monsterHuntTick();assert.equal(t.party.farmingPolicy,'hunt');assert.deepEqual(t.convoys.at(-1).location,t.farm);
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
 const accepted=safety.acceptArrival(t.hunt,{id:'arrival',epoch:8,purpose:'monster-hunt',location:t.destination},
   {character:'W',runtimeId:'runtime',navigationRevision:7,target:{mtype:'mole'}},100000);
 assert.equal(accepted,true);assert.equal(t.hunt.stage,'farming');
 return {...t,follower};
}
test('accepted arrival survives delayed and out-of-order outside heartbeats without rebuilding',()=>{
 const t=arrivalFixture(),before=t.convoys.length;
 t.r.monsterHuntTick();t.advance(1000);t.r.monsterHuntTick();
 Object.assign(t.party.statuses.W,t.destination);t.advance(1000);t.r.monsterHuntTick();
 assert.ok(t.hunt.arrivalHandoff.confirmedAt);
 t.party.statuses.W.map='main';t.advance(1000);t.r.monsterHuntTick();
 assert.equal(t.convoys.length,before);assert.equal(t.party.commands.P,t.follower);
 Object.assign(t.party.statuses.W,t.destination);t.advance(8000);t.r.monsterHuntTick();
 assert.equal(t.convoys.length,before);assert.equal(t.hunt.stage,'farming');
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

 test('completed anniversary convoy cannot trap the saved at-Daisy stage after coordinator restart',()=>{
 const t=fixture();t.hunt.stage='paused-event';t.hunt.resumeStage='at-daisy';
 t.party.anniversary={eventCycle:{id:'round',convoyId:'orphan',returnCompletedAt:1}};
 t.party.activeConvoy={id:'orphan',purpose:'anniversary-return',phase:'failed',failureCode:'runtime-lost'};
 t.r.monsterHuntTick();
 assert.notEqual(t.hunt.stage,'paused-event');assert.notEqual(t.hunt.message,'Waiting for event travel to finish');
 });

for(const enabled of [true,false])test('death below threshold resumes the same Hunt; enabled='+enabled,()=>{
 const t=fixture();t.party.huntSettings={...require('../../runtime/coordinator/hunt/settings.ts').defaultHuntSettings,blacklistDeaths:enabled,deathThreshold:2};
 t.die('M');assert.equal(t.party.huntBlacklist.mole,undefined);assert.equal(!!t.hunt.missions[0].skipped,false);assert.equal(t.hunt.recovering,true);
 t.party.statuses.M.rip=false;t.advance(5000);t.r.monsterHuntTick();assert.equal(t.hunt.target,'mole');assert.equal(t.hunt.recovering,false);
 t.die('M');assert.equal(t.party.huntFailures.mole.deaths,2);assert.equal(!!t.party.huntBlacklist.mole,enabled);
});
