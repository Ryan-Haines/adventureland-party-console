const test=require('node:test'),assert=require('node:assert/strict');
const {observeReturnTown}=require('../../runtime/movement/coordinator/arrivals.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {party}=require('./fixtures/hunt-return-town-scenario.cjs');

scenarioTable('an interrupted Town cast switches a continuous return to walking until everyone changes map (MOV-136b)', party, [
 ['the first interrupted Town round selects walking, deduplicates members, and resets only after everyone changes map', p=>{
 const c=p.activeConvoy;observeReturnTown(p,c,1000);
 const attempt={round:'1:1:0',map:'main',state:'interrupted',destination:{map:'main',x:0,y:0}};
 for(let round=1;round<=3;round++){
  for(const name of c.participants)p.statuses[name].convoyNavigation.townAttempt={...attempt,round:round+':1:0'};
  observeReturnTown(p,c,1000);observeReturnTown(p,c,1000);
  assert.equal(c.returnTown.interruptions,round);assert.equal(c.returnTown.walking,true);
 }
 // Movement writes nothing of the Hunt record; hunt.ts keepReturnTown copies the walk's policy on its tick.
 assert.equal(p.monsterHunt.returnTown,undefined);
 c.epoch++;observeReturnTown(p,c,1000);assert.equal(c.returnTown.interruptions,3);
 p.statuses.L.map='winterland';assert.equal(observeReturnTown(p,c,1000),false);
 for(const s of Object.values(p.statuses)){s.map='winterland';s.convoyNavigation.transitionMap='winterland';}
 assert.equal(observeReturnTown(p,c,1000),true);assert.equal(c.disableTown,false);assert.equal(c.returnTown.interruptions,0);
 }],
]);
