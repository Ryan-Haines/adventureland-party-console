const test=require('node:test'),assert=require('node:assert/strict');
const {createCharacterCode}=require('../../runtime/coordinator/characters/code.ts');
const {fixture}=require('./helpers/coordinator-workers.cjs');
function codeFixture(){const f=fixture(),worker=f.manager.start('W'),stopped=[];
 const ports={clock:f.ports.clock,log:f.ports.log,enabled:true,digest:()=> 'new-generation',reload:async()=>({status:'ready'}),
 stop:async(_,reason)=>stopped.push(reason),watch:()=>({close(){}}),watchFailed(){}};
 return {...f,worker,stopped,ports,code:createCharacterCode(ports)};}
test('busy CODE retries after two seconds while retaining the old generation',async()=>{
 const f=codeFixture();f.blocks.W.codeGeneration='old';f.ports.reload=async()=>({status:'busy'});await f.code.reload(f.blocks.W);
 assert.equal(f.blocks.W.codeGeneration,'old');assert.equal(f.timers[0].ms,2000);f.ports.reload=async()=>({status:'ready'});
 f.timers[0].callback();await new Promise(setImmediate);assert.equal(f.blocks.W.codeGeneration,'new-generation');assert.equal(f.stopped.length,0);
});
test('retired worker CODE acknowledgements cannot activate a replacement generation',async()=>{
 const f=codeFixture();let acknowledge;f.ports.reload=()=>new Promise(resolve=>{acknowledge=resolve;});const pending=f.code.reload(f.blocks.W);
 f.blocks.W.instance={};acknowledge({status:'ready'});await pending;assert.equal(f.blocks.W.codeGeneration,undefined);assert.equal(f.blocks.W.codeReloadRunning,false);
});
test('rejected CODE restarts only when the runner explicitly requires recovery',async()=>{
 const f=codeFixture();f.ports.reload=async()=>({status:'failed',error:'syntax'});await f.code.reload(f.blocks.W);assert.equal(f.stopped.length,0);
 f.ports.reload=async()=>({status:'failed',error:'lost runner',restartRequired:true});await f.code.reload(f.blocks.W);assert.deepEqual(f.stopped,['CODE reload recovery: lost runner']);
});
