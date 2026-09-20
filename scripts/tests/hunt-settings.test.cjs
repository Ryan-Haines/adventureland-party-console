const test=require('node:test'),assert=require('node:assert/strict');
const {defaultHuntSettings,recordHuntFailure,applyHuntThresholds}=require('../../runtime/coordinator/hunt/settings.ts');
const {initialFarmingState}=require('../../runtime/coordinator/navigation/initial-farming.ts');
const {createHuntSettingsRoute}=require('../../runtime/coordinator/http/hunt-settings.ts');
const {createHuntBlacklistRoute}=require('../../runtime/coordinator/http/hunt-control.ts');
const {observeHuntExpiry}=require('../../runtime/coordinator/hunt/expiry.ts');
function response(){return {code:200,status(n){this.code=n;return this},json(v){this.value=v;return v}};}
test('defaults, historical migration, accumulated thresholds and restart persistence',()=>{
 const state=initialFarmingState({huntBlacklist:{rat:{monsterId:'rat',at:1,deaths:2,expirations:1}}},()=>100);
 assert.deepEqual(state.huntSettings,defaultHuntSettings);assert.deepEqual(state.huntFailures.rat,{deaths:2,expirations:1});
 state.huntSettings.deathThreshold=2;
 assert.equal(recordHuntFailure(state,'bee','deaths',1,101),false);
 const restored=initialFarmingState(JSON.parse(JSON.stringify(state)),()=>102);
 assert.equal(recordHuntFailure(restored,'bee','deaths',1,103),true);
 assert.equal(restored.huntBlacklist.bee.deaths,2);
});
test('settings endpoint validates atomically, preserves disabled counts, evaluates changes and cancels pending conflict',()=>{
 const s={huntSettings:{...defaultHuntSettings,blacklistDeaths:false},farmAreaState:{pending:{cause:'farming-conflict'}}};let saves=0;
 const route=createHuntSettingsRoute(s,{now:()=>100,persist:()=>saves++});
 recordHuntFailure(s,'rat','deaths',3,100);assert.equal(s.huntBlacklist,undefined);
 for(const body of [{deathThreshold:0},{expirationThreshold:1.5},{blacklistDeaths:'true'},{unknown:true}]){const r=response();route({body},r);assert.equal(r.code,400);}
 assert.equal(saves,0);
 route({body:{blacklistDeaths:true,deathThreshold:3,relocateIfCompeting:false}},response());
 assert.equal(s.huntBlacklist.rat.deaths,3);assert.equal(s.farmAreaState.pending,null);
 route({body:{blacklistDeaths:false}},response());assert.ok(s.huntBlacklist.rat);
 const clear=createHuntBlacklistRoute(s,{now:()=>100,persist(){}});s.monsterChoices=[{id:'rat'}];
 clear({body:{action:'remove',monsterId:'rat'}},response());assert.equal(s.huntFailures.rat,undefined);
 recordHuntFailure(s,'bee','expirations',1,100);clear({body:{action:'clear'}},response());assert.deepEqual(s.huntFailures,{});
});
test('expiry counts attempted unfinished quests once, survives restart and ignores completed and stale reports',()=>{
 const s={huntSettings:{...defaultHuntSettings,expirationThreshold:2},statuses:{W:{seenAt:100,monsterHunt:{id:'rat',count:3,remainingMs:1000}}}};
 const h={stage:'farming',missionRevision:1,currentIndex:0,missions:[{target:'rat',owners:['W']}]};
 assert.equal(observeHuntExpiry(s,h,100),true);
 const restored=JSON.parse(JSON.stringify(h));s.statuses.W.monsterHunt=null;
 observeHuntExpiry(s,restored,5000);assert.equal(s.huntFailures,undefined);
 s.statuses.W.seenAt=5000;observeHuntExpiry(s,restored,5000);observeHuntExpiry(s,restored,5000);
 assert.equal(s.huntFailures.rat.expirations,1);assert.equal(s.huntBlacklist,undefined);
 restored.missionRevision=2;s.statuses.W.monsterHunt={id:'rat',count:3,remainingMs:1000};observeHuntExpiry(s,restored,5000);
 s.statuses.W.monsterHunt.count=0;observeHuntExpiry(s,restored,5000);s.statuses.W.monsterHunt=null;s.statuses.W.seenAt=7000;observeHuntExpiry(s,restored,7000);
 assert.equal(s.huntFailures.rat.expirations,1);
});
