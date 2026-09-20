const test=require('node:test'),assert=require('node:assert/strict');
const {createWorkerSetup}=require('../../runtime/coordinator/characters/worker-setup.ts');
function fixture(){const workers={},state={activeRealm:'SR_USII',location:{realm:'SR_EUI'},headlessSlots:[null,null],lifecycle:{}},calls=[];
 const service=createWorkerSetup(workers,state,{configuredRealm:'SR_USI',script:name=>name+'.js',watch:(name,block)=>calls.push(['watch',name,block]),persist:()=>calls.push(['persist',state.headlessSlots.slice()]),start:name=>calls.push(['start',name])});
 return {workers,state,calls,service};}
test('worker setup preserves existing realm and version while replacing legacy watchers',()=>{
 const f=fixture();let closed=0;const block={realm:'SR_USIII',version:4,connected:1,code_watcher:{close:()=>closed++}};f.workers.M=block;
 assert.equal(f.service.ensure('M'),block);assert.equal(closed,1);assert.equal(block.code_watcher,null);assert.equal(block.realm,'SR_USIII');assert.equal(block.version,4);assert.equal(block.connected,true);assert.equal(block.script,'M.js');
 f.service.ensure('M');assert.equal(closed,1);assert.equal(f.calls.length,2);
});
test('new workers inherit active, location, then configured realm',()=>{
 const f=fixture();assert.equal(f.service.ensure('A').realm,'SR_USII');delete f.state.activeRealm;assert.equal(f.service.ensure('B').realm,'SR_EUI');f.state.location=null;assert.equal(f.service.ensure('C').realm,'SR_USI');assert.equal(f.workers.C.version,0);assert.equal(f.workers.C.connected,false);
});
test('slot assignment persists first and starts only workers without an instance',()=>{
 const f=fixture();f.service.assign(2,'M');assert.deepEqual(f.calls[0],['persist',[null,'M']]);assert.equal(f.workers.M.enabled,true);assert.equal(f.state.lifecycle.M,'starting');assert.deepEqual(f.calls.at(-1),['start','M']);
 f.workers.M.instance={};f.workers.M.connected=true;f.calls.length=0;f.service.assign(1,'M');assert.equal(f.state.lifecycle.M,'online');assert.equal(f.calls.some(x=>x[0]==='start'),false);
});
test('script lookup failure preserves setup order and never starts a partial worker',()=>{
 const workers={},state={headlessSlots:[null],lifecycle:{},activeRealm:'SR_USII'},calls=[];
 const service=createWorkerSetup(workers,state,{configuredRealm:'SR_USI',script:()=>{throw new TypeError('missing account entry');},
   watch:()=>calls.push('watch'),persist:()=>calls.push('persist'),start:()=>calls.push('start')});
 assert.throws(()=>service.assign(1,'Missing'),TypeError);
 assert.deepEqual(calls,['persist']);assert.equal(state.headlessSlots[0],'Missing');
 assert.deepEqual(workers.Missing,{realm:'SR_USII'});assert.deepEqual(state.lifecycle,{});
});
