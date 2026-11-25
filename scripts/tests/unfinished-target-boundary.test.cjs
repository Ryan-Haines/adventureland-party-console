const assert=require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {unfinishedTarget:fixture}=require('./fixtures/targeting-scenario.cjs');
scenarioTable("an unfinished grouped fight keeps its exact target outside the farm bounds (TG4)",()=>undefined,[
  ["exact unfinished monster remains eligible outside farm bounds and focus",()=>{
 const {r,target}=fixture();assert.equal(r.isAllowedTarget(target),true);
  }],
  ["a lock in another realm or another instance bypasses no boundary",()=>{
 for(const change of [r=>r.groupedCombat.target.server='EUI',r=>r.groupedCombat.target.in='other']){
  const {r,target}=fixture();change(r);assert.equal(r.isAllowedTarget(target),false);
 }
  }],
  ["boundary exception never permits another neutral pull or a claimed monster",()=>{
 const {r,target}=fixture();assert.equal(r.isAllowedTarget({...target,id:'new'}),false);
 r.isExternallyClaimedMonster=()=>true;assert.equal(r.isAllowedTarget(target),false);
  }],
]);
