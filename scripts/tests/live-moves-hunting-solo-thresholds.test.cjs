// A solo character's Hunt settings route (tasks/coordinator/routes.ts `createScopedFarmingRoute` over
// hunting/coordinator/routes.ts `createHuntRoutes`, as coordinator/application.ts scopes
// `huntSettingsRoute`). This row holds the settings checks of live H23 (test-windows DESIGN.md
// 4.3): live W61 keeps the priest's solo Hunt play.
const test=require('node:test'),assert=require('node:assert/strict');
const {createScopedFarmingRoute}=require('../../runtime/tasks/coordinator/routes.ts');
const {createHuntRoutes}=require('../../runtime/hunting/coordinator/routes.ts');
const {defaultHuntSettings}=require('../../runtime/hunting/saved-fields.ts');
const {settingsWriter}=require('./helpers/settings-writer.cjs');
function response(){return {code:200,status(n){this.code=n;return this;},json(v){this.value=v;return v;}};}
const huntSettingsRoute=state=>createHuntRoutes(state,{group:()=>null,write:settingsWriter(state).write,now:()=>100,persist(){}}).settings;

test("an unfollowed priest's death threshold is its own, and the party's write leaves it",()=>{
  // The warrior leads the party profile; the priest follows no one and runs its own solo group.
  const party={huntSettings:{...defaultHuntSettings}},solo={huntSettings:{...defaultHuntSettings}};
  const mode={W:'default',P:'hunt'};
  const route=createScopedFarmingRoute(huntSettingsRoute(party),service=>service.huntSettingsRoute,{owned:()=>true,merchant:()=>'M',combat:n=>n!=='M',
    owner:n=>n,solo:n=>n==='P'?{huntSettingsRoute:huntSettingsRoute(solo)}:null,mainOwner:()=>'W',mode:n=>mode[n]},true);
  const own=response();route({body:{character:'P',deathThreshold:4}},own);
  assert.equal(own.code,200);
  assert.deepEqual([own.value.farmingOwner,own.value.savedFarmingPolicy,own.value.effectiveFarmingPolicy],['P','hunt','hunt'],'the priest owns its farming and runs Hunt');
  route({body:{deathThreshold:2}},response());
  assert.equal(solo.huntSettings.deathThreshold,4,"the priest's threshold stays its own");
  assert.equal(party.huntSettings.deathThreshold,2,"the party's write reaches the warrior's profile");
});
