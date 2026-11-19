const assert=require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/coordinator-navigation-commands-scenario.cjs');
scenarioTable('dashboard navigation commands start or cancel the right convoy (MOV-156)', fixture, [
 ['merchant home persists before delayed restart and avoids redundant same-realm restart', f=>{
 f.send({character:'M',type:'go-home'});assert.equal(f.block.realm,'SR_USII');assert.equal(f.calls.at(-2),'persist');assert.deepEqual(f.calls.at(-1),['restart',f.block]);
 f.calls.length=0;f.send({character:'M',type:'go-home'});assert.equal(f.calls.some(c=>c[0]==='restart'),false);
 assert.equal(f.send({type:'go-home'}).status,409);
 }],
 // Go home has no arrival window, so a worker stop that fails is logged as the command's failure.
 ['merchant home logs a worker stop that fails', async f=>{
 f.block.connected=false;f.failStop(Error('worker busy'));f.send({character:'M',type:'go-home'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.calls.at(-1),['log','Could not restart M to return home: Error: worker busy','error']);
 }],
]);
