const test=require('node:test'),assert=require('node:assert/strict');
const {initialCommandState}=require('../../runtime/settings/coordinator/initial.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/convoy-restart-recovery-scenario.cjs');
scenarioTable('a convoy failed by a coordinator restart rebuilds from fresh matching reports (MOV-137, MOV-155)', fixture, [
 ['restart waits for current reports and command ownership and logs the wait once', f=>{
 f.advance(5000);f.state.statuses.P.seenAt=0;
 f.service.recoverRestart();f.service.recoverRestart();assert.equal(f.logs.length,1);
 f.advance(1);f.state.commands.P={id:777,convoyId:'manual'};f.service.recoverRestart();assert.equal(f.state.commands.P.id,777);
 delete f.state.commands.P;f.service.recoverRestart();assert.notEqual(f.state.activeConvoy.id,f.original.id);
 }],
 ['event and Hunt owners retain their own recovery; unrelated failures do not auto-retry', ()=>{
 for(const purpose of ['monster-hunt','anniversary-return','franky-exit']){
  const f=fixture();f.state.activeConvoy.purpose=purpose;f.advance(90000);f.service.recoverRestart();assert.equal(f.state.activeConvoy.id,f.original.id);
 }
 const f=fixture();f.state.activeConvoy.restartRecovery=false;f.advance(90000);f.service.recoverRestart();assert.equal(f.state.activeConvoy.id,f.original.id);
 }],
 ['hold acknowledgements and a second restart cannot replace the original navigation authority', f=>{
 f.intents.P.revision=2;f.state.activeConvoy.expected.P.revision=2;
 Object.assign(f.state,initialCommandState({activeConvoy:f.state.activeConvoy},()=>1000));
 f.advance(5000);f.service.recoverRestart();assert.equal(f.state.activeConvoy,null);
 }],
 ['repeated coordinator restarts rebuild on each fresh report and keep the walk ladder', ()=>{
 // Each rebuild waits only for every member's report after the failure, with no cap and no
 // fixed backoff, and keeps the walk's ladder (MOV-137).
   const f=fixture();f.state.activeConvoy.ladder={index:1,rounds:0,failures:1,progressAt:1000,visited:['main']};
  for(let index=0;index<4;index++){
   f.service.recoverRestart();assert.equal(f.state.activeConvoy.restartAttempts||0,index,'no report after the failure yet');
   f.advance(1);f.service.recoverRestart();assert.equal(f.state.activeConvoy.restartAttempts,index+1);assert.equal(f.state.activeConvoy.ladder.index,1);
   const active=f.state.activeConvoy;Object.assign(f.state,initialCommandState({activeConvoy:active},()=>f.state.statuses.W.seenAt));
  }
  assert.doesNotMatch(f.logs.join('\n'),/exhausted/);
 }],
]);
for(const change of [f=>f.intents.P.cancelled=true,f=>f.intents.P.revision++,f=>f.state.followers.P=false])
 test('changed navigation invalidates the restored convoy without replacing newer commands '+change,()=>{
 const f=fixture();change(f);f.state.commands.P={id:777,convoyId:'new'};f.advance(5000);f.service.recoverRestart();
 assert.equal(f.state.activeConvoy,null);assert.equal(f.state.commands.P.id,777);
});
