const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source=require('./helpers/coordinator-source.cjs').coordinatorSource();
function fixture(policy='farming') {
  let route, starts=0, authorizations=0;
  const party={monsterFocus:["snake"],monsterFocusByCharacter:{},statuses:{},leader:'L',targetMode:policy,monsterHunterLocation:{map:'main',x:-100,y:-100}};
  let cancelled=true;
  const context={validFarmingLocation:require("../../.build/shared/farming-areas.cjs").validFarmingLocation,party,huntParticipants:()=>['L','F','P'],farmingNavigation:{waypoint:()=>party.monsterHunterLocation,intent:()=>({cancelled}),authorize:(names,point,shared)=>{assert.deepEqual(Array.from(names),['L','F','P']);assert.equal(shared,true);assert.ok(point && point.map);cancelled=false;authorizations++;}},
    clearMonsterHuntState(){party.monsterHunt=null;},escapeControl:{release(){}},beginMonsterHuntCycle:()=>{assert.equal(cancelled,false);starts++;party.monsterHunt={stage:'daisy-sync-travel',returnLocation:party.monsterHunterLocation};},persistSettings(){},express_inst:{post:(url,handler)=>{if(url==='/party-api/farming-mode')route=handler;}}};
  route=require('./helpers/coordinator-hunt-mode.cjs').huntMode(context);
  const res={status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
  return {party,post:(extra={})=>route({body:{mode:'hunt',...extra}},res),starts:()=>starts,authorizations:()=>authorizations,res};
}
test('reselecting stalled Hunt resumes; repeating an active Hunt selection does not cancel its convoy',()=>{const t=fixture('hunt');t.party.monsterHunt={stage:'daisy-sync-travel',returnLocation:t.party.monsterHunterLocation};t.post();t.post();assert.equal(t.starts(),1);assert.equal(t.authorizations(),1);});
test('missing Daisy catalog rejects without changing policy or navigation',()=>{const t=fixture();t.party.monsterHunterLocation=null;t.post();assert.equal(t.res.code,409);assert.equal(t.authorizations(),0);assert.equal(t.party.targetMode,'farming');});

test('missing normal waypoint requires setup without changing farming mode',()=>{
 const t=fixture('hunt');t.party.monsterHunt={stage:'ended'};t.post();assert.equal(t.res.body.code,'backup_required');assert.equal(t.authorizations(),0);
});
