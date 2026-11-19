const test=require('node:test'),assert=require('node:assert/strict');
const {recordHuntFailure,applyHuntThresholds}=require('../../runtime/hunting/coordinator/hunt.ts');const {defaultHuntSettings}=require('../../runtime/hunting/saved-fields.ts');
const {loadFarmingRecord}=require('../../runtime/hunting/coordinator/record.ts');
// The hunting owner's Hunt routes (routes.ts `createHuntRoutes`): the settings and blacklist rows use only these ports.
const {createHuntRoutes}=require('../../runtime/hunting/coordinator/routes.ts');
const huntRoutes=(state,ports)=>createHuntRoutes(state,{group:()=>null,write:settingsWriter(state).write,...ports});
const {observeHuntExpiry,expireWaitedQuest}=require('../../runtime/hunting/coordinator/hunt.ts');
const {settingsWriter}=require('./helpers/settings-writer.cjs');
function response(){return {code:200,status(n){this.code=n;return this},json(v){this.value=v;return v}};}
test('defaults, historical migration, accumulated thresholds and restart persistence',()=>{
 const state=loadFarmingRecord({huntBlacklist:{rat:{monsterId:'rat',at:1,deaths:2,expirations:1}}},{},()=>100);
 assert.deepEqual(state.huntSettings,defaultHuntSettings);assert.deepEqual(state.huntFailures.rat,{deaths:2,expirations:1});
 state.huntSettings.deathThreshold=2;
 assert.equal(recordHuntFailure(state,'bee','deaths',1,101,null),false);
 const restored=loadFarmingRecord(JSON.parse(JSON.stringify(state)),{},()=>102);
 assert.equal(recordHuntFailure(restored,'bee','deaths',1,103,null),true);
 assert.equal(restored.huntBlacklist.bee.deaths,2);
});
test('settings endpoint preserves disabled counts and evaluates changes',()=>{
 const s={huntSettings:{...defaultHuntSettings,blacklistDeaths:false}};let saves=0;
 const route=huntRoutes(s,{now:()=>100,persist:()=>saves++}).settings;
 recordHuntFailure(s,'rat','deaths',3,100,null);assert.equal(s.huntBlacklist,undefined);
 route({body:{blacklistDeaths:true,deathThreshold:3}},response());
 assert.equal(s.huntBlacklist.rat.deaths,3);
 route({body:{blacklistDeaths:false}},response());assert.ok(s.huntBlacklist.rat);
 const clear=huntRoutes(s,{now:()=>100,persist(){}}).blacklist;s.monsterChoices=[{id:'rat'}];
 clear({body:{action:'remove',monsterId:'rat'}},response());assert.equal(s.huntFailures.rat,undefined);
 recordHuntFailure(s,'bee','expirations',1,100,null);clear({body:{action:'clear'}},response());assert.deepEqual(s.huntFailures,{});
});
test('expiry counts attempted unfinished quests once, survives restart and ignores completed and stale reports',()=>{
 const s={huntSettings:{...defaultHuntSettings,expirationThreshold:2},statuses:{W:{seenAt:100,monsterHunt:{id:'rat',count:3,remainingMs:1000}}}};
 const h={stage:'farming',missionRevision:1,currentIndex:0,missions:[{target:'rat',owners:['W']}]};
 assert.equal(observeHuntExpiry(s,h,100,null),true);
 const restored=JSON.parse(JSON.stringify(h));s.statuses.W.monsterHunt=null;
 observeHuntExpiry(s,restored,5000,null);assert.equal(s.huntFailures,undefined);
 s.statuses.W.seenAt=5000;observeHuntExpiry(s,restored,5000,null);observeHuntExpiry(s,restored,5000,null);
 assert.equal(s.huntFailures.rat.expirations,1);assert.equal(s.huntBlacklist,undefined);
 restored.missionRevision=2;s.statuses.W.monsterHunt={id:'rat',count:3,remainingMs:1000};observeHuntExpiry(s,restored,5000,null);
 s.statuses.W.monsterHunt.count=0;observeHuntExpiry(s,restored,5000,null);s.statuses.W.monsterHunt=null;s.statuses.W.seenAt=7000;observeHuntExpiry(s,restored,7000,null);
 assert.equal(s.huntFailures.rat.expirations,1);
 // The Daisy path: a waited-out quest the revision tracked counts nothing more; an untracked one counts once.
 restored.target='rat';expireWaitedQuest(s,restored,'W',7000,null);assert.equal(s.huntFailures.rat.expirations,1);
 restored.target='bee';expireWaitedQuest(s,restored,'W',7000,null);expireWaitedQuest(s,restored,'W',7000,null);
 assert.equal(s.huntFailures.bee.expirations,1);
});
// HN8: the survival owner sends one notice per death, so the cycle counts each
// notice once and nothing between them; a too-hard escape from the target counts as a death does,
// a bad-luck one or one from another type counts nothing, and a death on an event trip counts nothing.
test('HN8: the cycle counts each died notice once and only a too-hard escape on its target',()=>{
 const {createHunt}=require('../../runtime/hunting/coordinator/hunt.ts');
 const s={targetMode:'hunt',statuses:{W:{seenAt:5000},P:{seenAt:5000}},commands:{},huntSettings:{blacklistDeaths:true,deathThreshold:4,blacklistExpirations:false,expirationThreshold:1},
  monsterHunt:{cycleId:'c',stage:'farming',participants:['W','P'],missions:[],currentIndex:0,target:'bee',startedAt:1000}};
 const hunt=createHunt(s,{now:()=>5000,persist(){}});
 hunt.died({name:'W',at:2000});hunt.observe();assert.equal(s.huntFailures.bee.deaths,1);
 hunt.died({name:'Z',at:2000});hunt.died({name:'P',at:500});assert.equal(s.huntFailures.bee.deaths,1);
 hunt.escaped({names:['P'],cause:'bad luck',mtypes:['bee']});hunt.escaped({names:['P'],cause:'too hard',mtypes:['goo']});
 assert.equal(s.huntFailures.bee.deaths,1);
 hunt.escaped({names:['P'],cause:'too hard',mtypes:['bee']});assert.equal(s.huntFailures.bee.deaths,2);
 s.huntEventTrips={P:[{event:'goobrawl',startedAt:2500}]};hunt.died({name:'P',at:3000});assert.equal(s.huntFailures.bee.deaths,2);
 hunt.died({name:'P',at:2000});assert.equal(s.huntFailures.bee.deaths,3);
});
// One death and the too-hard escape of the recovery it started count once, as v1.5.0's death count
// did: the live death-threshold rows saw one kill reach 2 and a threshold of 2 blacklist the target.
for(const deathThreshold of [1,2])test(`HN8: one death and its recovery's escape count once at death threshold ${deathThreshold}`,()=>{
 const {createHunt}=require('../../runtime/hunting/coordinator/hunt.ts');
 const s={targetMode:'hunt',statuses:{W:{seenAt:5000},P:{seenAt:5000}},commands:{},huntSettings:{blacklistDeaths:true,deathThreshold,blacklistExpirations:false,expirationThreshold:1},
  monsterHunt:{cycleId:'c',stage:'farming',participants:['W','P'],missions:[],currentIndex:0,target:'goo',startedAt:1000}};
 const hunt=createHunt(s,{now:()=>5000,persist(){}});
 hunt.died({name:'W',at:2000});
 hunt.escaped({names:['W','P'],cause:'too hard',mtypes:['goo'],deaths:['W']});
 assert.equal(s.huntFailures.goo.deaths,1);
 assert.equal(!!s.huntBlacklist?.goo,deathThreshold===1);
 // A recovery started by a member outside the cycle still counts its escape.
 hunt.escaped({names:['W','P'],cause:'too hard',mtypes:['goo'],deaths:['M']});
 assert.equal(s.huntFailures.goo.deaths,2);
});
// HN10: each converted field loads to its converted value
// once, and the cycle reads none of them after the load.
test('HN10: an old saved Hunt converts once at load, one row per field',()=>{
 const {convertHunt}=require('../../runtime/hunting/coordinator/record.ts');
 const base=()=>({cycleId:'c',version:2,policyVersion:3,stage:'farming',participants:['W'],missions:[{target:'bee',owners:['W'],destination:{map:'main',x:1,y:2},destinationVersion:1}],currentIndex:0,target:'bee'});
 const fields=convertHunt({...base(),encounter:{convoyId:'x'},exitMode:'farming',endReason:'gone',encounterLootPending:true});
 for(const field of ['encounter','exitMode','endReason','encounterLootPending']) assert.equal(field in fields,false,field);
 assert.equal(convertHunt({...base(),stage:'failed-return'}).stage,'checking-quests');
 assert.equal(convertHunt({...base(),stage:'paused-event',resumeStage:'at-daisy'}).stage,'at-daisy');
 // b9b5c91e's death-limit and cancelled-return ends saved stage 'ended'; it loads as no cycle, so the hunting owner's
 // Hunt source asks no task for it and the next Hunt select begins a new cycle.
 const {huntKind}=require('../../runtime/hunting/coordinator/install.ts');
 const ended=convertHunt({...base(),stage:'ended',endReason:'two party deaths'});
 assert.equal(huntKind({targetMode:'hunt',monsterHunt:ended},false),null);
 for(const old of [{policyVersion:2},{version:1}]){
  const h=convertHunt({...base(),...old});
  assert.deepEqual([h.stage,h.missions,h.currentIndex,h.target,h.policyVersion,h.version],['checking-quests',[],-1,null,3,2]);
 }
 const turnIn=convertHunt({...base(),policyVersion:2,stage:'returning',turnIn:{owner:'W',phase:'returning'}});
 assert.equal(turnIn.stage,'returning');
 const point=convertHunt({...base(),missions:[{target:'bee',owners:['W'],destination:{map:'main',x:1,y:2}}]});
 // The load keeps a point saved before destinationVersion 1; the mission's start checks it against the catalog (hunt.ts checkSavedPoint).
 assert.deepEqual([point.missions[0].destination,point.missions[0].destinationVersion],[{map:'main',x:1,y:2},undefined]);
 const entry=convertHunt({...base(),routeRecovery:{k:{phase:'post-relocation',relocation:{method:'door'},attempts:[]}}}).routeRecovery.k;
 assert.deepEqual([entry.phase,'relocation' in entry],['excluded',false]);
 const kept=convertHunt(base());assert.deepEqual(convertHunt(JSON.parse(JSON.stringify(kept))),kept);
});
// HN35: a `distance` refusal at Daisy clears the command and
// sends the cycle back to its Daisy walk, which the next Daisy step starts before it issues again.
test('HN35: a distance receipt at Daisy walks back to Daisy before the interaction is issued again',()=>{
 const {completeHuntInteraction}=require('../../runtime/hunting/coordinator/hunt.ts');
 const s={monsterHunt:{cycleId:'c',stage:'at-daisy',participants:['W'],missions:[],currentIndex:-1,target:null},commands:{W:{id:4,type:'monster-hunt-interact',cycleId:'c',action:'claim'}}};
 assert.equal(completeHuntInteraction(s,'W',{commandId:4,cycleId:'c',success:false,error:'distance'}).status,200);
 assert.deepEqual([s.commands.W,s.monsterHunt.stage,s.monsterHunt.daisyRegroup],[undefined,'daisy-sync-travel',true]);
 s.monsterHunt.stage='at-daisy';delete s.monsterHunt.daisyRegroup;s.commands.W={id:5,type:'monster-hunt-interact',cycleId:'c',action:'claim'};
 completeHuntInteraction(s,'W',{commandId:5,cycleId:'c',success:false,error:'busy'});
 assert.deepEqual([s.monsterHunt.stage,s.monsterHunt.daisyRegroup],['at-daisy',undefined]);
});
