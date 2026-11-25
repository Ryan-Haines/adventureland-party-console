const assert=require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {setup,destinationFixture}=require('./fixtures/cave-assembly-drift-scenario.cjs');
scenarioTable('a Cave assembly regroups drifted members on the Cave ladder (MOV-203)', setup, [
 ['completed Cave gather displaced by combat receives a new owned gather before departure', f=>{
 const old=f.d.commands.P.id;f.travel.tick();
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].names,['P']);assert.equal(f.calls[0].action,'gather');assert.notEqual(f.d.commands.P.id,old);assert.equal(f.d.travel.stage,'assembling');
 f.travel.tick();assert.equal(f.calls.length,1,'old completion cannot reissue the new in-flight gather');
 f.party.statuses.P.x=0;f.party.statuses.P.dungeon.action={id:f.d.commands.P.id,status:'complete'};f.travel.tick();assert.equal(f.d.travel.stage,'travelling');
 }],
 ['Cave regroup rejects stale, combat-busy, wrong-run and superseded gather evidence', ()=>{
 for(const change of [f=>f.party.statuses.P.seenAt=0,f=>f.party.statuses.W.dungeon.ready=false,f=>f.party.statuses.P.dungeon.cave.run='other',f=>f.party.statuses.P.map='other',f=>f.d.commands.P.action='vote',f=>f.party.statuses.P.dungeon.action.id='old']){const f=setup();change(f);f.travel.tick();assert.equal(f.calls.length,0);}
 }],
 ['completed Cave destination displaced by combat resumes before stairs', ()=>{
 const f=destinationFixture();f.party.statuses.W.dungeon.ready=false;f.travel.tick();assert.equal(f.calls.length,0);
 f.party.statuses.W.dungeon.ready=true;f.travel.tick();
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].names,['W']);assert.equal(f.calls[0].action,'move');
 assert.equal(f.d.commands.W.cruiseSpeed,79);assert.equal(f.d.commands.W.independent,true);assert.match(f.d.commands.W.id,/:regroup:/);
 f.travel.tick();assert.equal(f.calls.length,1);
 f.party.statuses.W.x=1000;f.party.statuses.W.dungeon.action={id:f.d.commands.W.id,status:'complete'};f.travel.tick();
 assert.equal(f.calls.at(-1).action,'stairs');assert.equal(f.d.travel,undefined);
 }],
 ['destination repair preserves current run, fresh readiness and owned command', ()=>{
 for(const change of [f=>f.party.statuses.P.seenAt=0,f=>f.party.statuses.P.dungeon.ready=false,
 f=>f.party.statuses.W.dungeon.cave.run='other',f=>f.party.statuses.W.map='other',
 f=>f.d.commands.W.action='vote',f=>f.party.statuses.W.dungeon.action.id='old',
 f=>f.d.commands.W.target={...f.d.travel.target,x:2000},f=>f.party.statuses.P.dungeon.cave.paused=true]){
 const f=destinationFixture();change(f);f.travel.tick();assert.equal(f.calls.length,0);}
 }],
 // HN26: no repair count stops Cave travel; each failed repair climbs the tasks owner's ladder for as long
 // as the run lasts, so an old save's count far past the cap of three still sends the next repair.
 ['Cave travel keeps repairing past any count (HN26)', ()=>{
 const f=destinationFixture();f.d.travel.destinationRepairs=50;f.d.travel.repairs=50;f.d.travel.assemblyRepairs=50;f.travel.tick();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'move');assert.equal(f.d.error,undefined);assert.notEqual(f.d.phase,'held');
 }],
 ['destination drift climbs the ladder without replaying completed transport or changing target', ()=>{
 const f=destinationFixture();f.travel.tick();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'move');assert.equal(f.d.error,undefined);assert.match(f.d.travel.trying,/^W: walking to the destination/);
  assert.equal(f.calls.some(c=>c.action==='stairs'),false);assert.equal(f.d.travel.target.id,'boss');
 }],
]);

