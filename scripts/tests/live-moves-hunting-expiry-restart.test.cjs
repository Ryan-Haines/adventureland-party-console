// The hunting owner's expiry count over a coordinator restart and the blacklist's clear
// (hunting/coordinator/hunt.ts `observeHuntExpiry`, `editHuntBlacklist`; record.ts
// `loadFarmingRecord`; routes.ts `createHuntRoutes`). This row holds the coordinator checks of live
// H19 (test-windows DESIGN.md 4.3): live W14 keeps the real expired quest that leads to a fresh
// Daisy quest.
const test=require('node:test'),assert=require('node:assert/strict');
const {observeHuntExpiry}=require('../../runtime/hunting/coordinator/hunt.ts');
const {defaultHuntSettings}=require('../../runtime/hunting/saved-fields.ts');
const {loadFarmingRecord}=require('../../runtime/hunting/coordinator/record.ts');
const {createHuntRoutes}=require('../../runtime/hunting/coordinator/routes.ts');
const {settingsWriter}=require('./helpers/settings-writer.cjs');
function response(){return {code:200,status(n){this.code=n;return this;},json(v){this.value=v;return v;}};}

test('an expired goo quest counts once, blacklists goo under the default thresholds, survives a restart, and the clear empties both',()=>{
  const s={huntSettings:{...defaultHuntSettings},monsterChoices:[{id:'goo'}],statuses:{W:{seenAt:100,monsterHunt:{id:'goo',count:10000,remainingMs:20000}}}};
  const h={stage:'farming',missionRevision:1,currentIndex:0,missions:[{target:'goo',owners:['W']}]};
  observeHuntExpiry(s,h,100,null);
  // The quest's 20 s run out: the next report names no quest.
  s.statuses.W={seenAt:20_200,monsterHunt:null};
  observeHuntExpiry(s,h,20_200,null);
  assert.equal(s.huntFailures.goo.expirations,1,'one expiration');
  assert.ok(s.huntBlacklist.goo,'goo is blacklisted at the default expiration threshold of 1');
  // The coordinator restart reloads the saved record.
  const restored=loadFarmingRecord(JSON.parse(JSON.stringify(s)),{},()=>30_000);
  assert.equal(restored.huntFailures.goo.expirations,1,'the count survives the restart');
  assert.ok(restored.huntBlacklist.goo,'and the blacklist');
  const routes=createHuntRoutes(restored,{group:()=>null,write:settingsWriter(restored).write,now:()=>30_000,persist(){}});
  routes.blacklist({body:{action:'clear'}},response());
  assert.deepEqual(restored.huntBlacklist,{},'the clear empties the blacklist');
  assert.deepEqual(restored.huntFailures,{},'and the failure counts');
});
