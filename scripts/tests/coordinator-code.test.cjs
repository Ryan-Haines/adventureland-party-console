const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createCode}=require('../../runtime/lifecycle/coordinator/code.ts');
const {fixture}=require('./helpers/coordinator-workers.cjs');
// createCode over the worker harness's clock and log, with one runner whose CODE reload answers
// `answer`, or waits for the row to answer it when `answer` is null. The script files read as one
// fixed byte, so each reload asks for the same generation.
function codeFixture(){
 const f=fixture(),stopped=[];let answer={status:'ready'};
 const runner=()=>Object.assign(new EventEmitter(),{sent:[],send(message,callback){this.sent.push(message);callback(null);
  if(answer)queueMicrotask(()=>this.emit('message',{type:'code_reload_result',id:message.id,generation:message.generation,...answer}));}});
 const block={enabled:true,script:'adventure_land/warrior.js',instance:runner()};
 const code=createCode({blocks:{W:block},clock:f.ports.clock,log:f.ports.log,watching:false,
  hash:()=>require('node:crypto').createHash('sha256'),read:()=>new Uint8Array([1]),watch:()=>({close(){}}),
  className:()=>'warrior',stop:async(_,reason)=>stopped.push(reason),notify(){}});
 return {...f,block,code,stopped,runner,answer:value=>{answer=value;}};
}
// A busy runner keeps its generation and retries on its first report that reads not busy (code.ts
// `reported`).
test('busy CODE retries on the first report that reads not busy while retaining the old generation',async()=>{
 const f=codeFixture();f.block.codeGeneration='old';f.answer({status:'busy'});await f.code.reload('W',f.block);
 assert.equal(f.block.codeGeneration,'old');assert.equal(f.block.codeReloadBusy,true);
 f.answer({status:'ready'});f.code.reported('W',{busy:true});await new Promise(setImmediate);assert.equal(f.block.codeGeneration,'old');
 f.code.reported('W',{busy:false});await new Promise(setImmediate);await new Promise(setImmediate);
 assert.notEqual(f.block.codeGeneration,'old');assert.equal(f.stopped.length,0);
});
test('retired worker CODE acknowledgements cannot activate a replacement generation',async()=>{
 const f=codeFixture();f.answer(null);const old=f.block.instance,pending=f.code.reload('W',f.block);
 f.block.instance=f.runner();const [request]=old.sent;
 old.emit('message',{type:'code_reload_result',id:request.id,generation:request.generation,status:'ready'});await pending;
 assert.equal(f.block.codeGeneration,undefined);assert.equal(f.block.codeReloadRunning,false);
});
test('rejected CODE restarts only when the runner explicitly requires recovery',async()=>{
 const f=codeFixture();f.answer({status:'failed',error:'syntax'});await f.code.reload('W',f.block);assert.equal(f.stopped.length,0);
 f.answer({status:'failed',error:'lost runner',restartRequired:true});await f.code.reload('W',f.block);assert.deepEqual(f.stopped,['CODE reload recovery: lost runner']);
});
// A native member reloads its CODE in its own frame, with no worker reply (code.ts `nativeReloaded`).
// The live hooks table's CODE reload (e2e/live-lifecycle-hooks.spec.ts "lifecycle.reloaded") runs on
// native members right after a coordinator restart.
function nativeFixture(now){
 const notices=[],f=fixture(),clock={now};
 const code=createCode({blocks:{},clock:f.ports.clock,log:f.ports.log,watching:false,hash:()=>null,read:()=>new Uint8Array(),
  watch:()=>({close(){}}),className:()=>'warrior',stop:async()=>{},now:()=>clock.now,notify:(hook,payload)=>notices.push([hook,payload])});
 return {code,notices,clock};
}
const reloaded=(script)=>['lifecycle.reloaded',{character:'N',script,outcome:'ready',by:'core:lifecycle'}];
test('a native member whose game window counts a new CODE install sends lifecycle.reloaded ready',()=>{
 const {code,notices,clock}=nativeFixture(10_000);
 code.nativeReloaded('N',{codeLoad:{count:1,ageMs:5_000},codeHash:'h1'});code.nativeReloaded('N',{codeLoad:{count:1,ageMs:6_000},codeHash:'h1'});
 assert.deepEqual(notices,[],'the first load and a repeat send nothing');
 clock.now=20_000;code.nativeReloaded('N',{codeLoad:{count:2,ageMs:100},codeHash:'h2'});
 assert.deepEqual(notices,[reloaded('h2')]);
});
test('the first report after a coordinator start counts a reload only when the install is younger than the coordinator',()=>{
 const after=nativeFixture(10_000);after.clock.now=12_000;
 after.code.nativeReloaded('N',{codeLoad:{count:2,ageMs:500},codeHash:'h2'});
 assert.deepEqual(after.notices,[reloaded('h2')],'reloaded while this coordinator ran');
 const before=nativeFixture(10_000);before.clock.now=12_000;
 before.code.nativeReloaded('N',{codeLoad:{count:2,ageMs:5_000},codeHash:'h2'});
 assert.deepEqual(before.notices,[],'reloaded before this coordinator started');
});
test('a headless member sends lifecycle.reloaded only from its worker reply',()=>{
 const f=codeFixture(),notices=[];
 const code=createCode({blocks:{W:f.block},clock:f.ports.clock,log:f.ports.log,watching:false,hash:()=>null,read:()=>new Uint8Array(),
  watch:()=>({close(){}}),className:()=>'warrior',stop:async()=>{},notify:(hook,payload)=>notices.push([hook,payload])});
 code.nativeReloaded('W',{codeLoad:{count:1,ageMs:0}});code.nativeReloaded('W',{codeLoad:{count:2,ageMs:0}});
 assert.deepEqual(notices,[]);
});
// reloadReplyMs (lifecycle/fields.ts): a worker that never acknowledges a CODE
// reload fails it at the kept bound and tells the status owner's bound record; an acknowledged reload tells nothing.
test('a CODE reload the worker never acknowledges fails at reloadReplyMs and records the firing',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {EventEmitter}=require('node:events');
 const {requestReload}=require('../../runtime/lifecycle/coordinator/code.ts');
 const {boundFirings}=require('../../runtime/status/coordinator/api.ts');
 const {lifecycleSavedFields}=require('../../runtime/lifecycle/fields.ts');
 const worker=Object.assign(new EventEmitter(),{sent:[],send(message,callback){this.sent.push(message);callback(null);}});
 const before=boundFirings().counts.reloadReplyMs||0;
 const clock={later:setTimeout,cancel:clearTimeout};
 const answered=requestReload(clock,worker,'W','g1');
 const {id}=worker.sent[0];worker.emit('message',{type:'code_reload_result',id,generation:'g1',status:'ready'});
 assert.equal((await answered).status,'ready');
 const lost=requestReload(clock,worker,'W','g2');
 t.mock.timers.tick(lifecycleSavedFields.settings.reloadReplyMs.default);
 assert.match((await lost).error,/timed out/);
 assert.equal(boundFirings().counts.reloadReplyMs,before+1);assert.equal(boundFirings().entries.at(-1).subject,'W');
});
