const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/coordinator-workers.cjs');
// Table W's realm row: the retry waits on the account's answer, never on a timer.
test('an unresolved realm refreshes and retries without choosing a different realm',async()=>{
 const f=fixture(),asked=[];let refreshed=0,resolves=false;
 f.ports.resolveRealm=realm=>{asked.push(realm);return resolves?{address:'fixture',path:'/',port:443}:undefined;};f.ports.refreshAccount=async()=>refreshed++;
 f.manager.start('W');assert.equal(f.workers.length,0);assert.equal(refreshed,1);assert.equal(f.lifecycle.W,'realm-error');
 await new Promise(setImmediate);assert.equal(f.workers.length,0,'an answer without the realm keeps the wait');
 resolves=true;f.manager.accountChanged({characters:['W']});assert.equal(f.workers.length,1,'the answer with the realm starts it');
 assert.deepEqual([...new Set(asked)],['SR_USII'],'no other realm was asked');
 const off=fixture();off.ports.resolveRealm=()=>undefined;off.manager.start('W');off.blocks.W.enabled=false;
 off.ports.resolveRealm=()=>({address:'fixture',path:'/',port:443});off.manager.accountChanged({});assert.equal(off.workers.length,0,'a worker turned off waits no more');
 assert.equal(f.timers.length+off.timers.length,0);
});
test('worker arguments and sibling messages preserve their wire format',()=>{
 const f=fixture(),w=f.manager.start('W');w.emit('message',{type:'process_ready'});
 assert.deepEqual(w.sent[0],{type:'process_args',arguments:{clientInstance:f.blocks.W.clientInstance,version:10,realm_address:'fixture',realm_path:'/',realm_port:443,sess:'fixture-session',cid:3,script_file:'adventure_land/generated/warrior.js',enable_map:false,cname:'W',clid:1}});
 assert.match(f.blocks.W.clientInstance,/^[a-f0-9-]{36}$/);
 w.emit('message',{type:'connected'});assert.equal(f.lifecycle.W,'online');assert.deepEqual(w.sent.at(-1),{type:'siblings_and_acc',account:{characters:['W']},siblings:['W']});
});
test('bootstrap repair finishes before replacement scheduling',async()=>{
 const {lifecycleSavedFields}=require('../../runtime/lifecycle/fields.ts');
 const f=fixture();let repair;f.ports.gameFiles={refresh_latest:()=>new Promise(resolve=>{repair=()=>resolve({version:10,revision:'10'});})};
 const w=f.manager.start('W');
 w.emit('message',{type:'bootstrap_failed'});assert.equal(f.lifecycle.W,'repairing');w.emit('exit',1,null);
 await new Promise(setImmediate);assert.equal(f.timers.length,0);repair();
 for(let turn=0;turn<4;turn++)await new Promise(setImmediate);
 assert.equal(f.timers[0].ms,lifecycleSavedFields.settings.workerRestartMs.default);f.timers[0].callback();assert.equal(f.workers.length,2);
});
test('retired worker messages cannot deploy characters or write storage',()=>{
 const f=fixture(),old=f.manager.start('W');f.manager.start('W');old.emit('message',{type:'deploy',character:'P'});
 old.emit('message',{type:'stor',ident:'ls',op:'set',data:{changed:true}});assert.equal(f.blocks.P,undefined);assert.equal(f.local.size,0);
});
test('storage initialization replies once and mutations broadcast',()=>{
 const f=fixture(),first=f.manager.start('W');f.blocks.P={enabled:true};const second=f.manager.start('P');
 first.emit('message',{type:'stor',ident:'ls',op:'set',data:{key:{nested:4}}});assert.deepEqual(f.local.get('key'),{nested:4});assert.equal(second.sent.length,1);
 first.emit('message',{type:'stor',ident:'ls',op:'init'});assert.equal(second.sent.length,1);assert.deepEqual(first.sent.at(-1).data,{key:{nested:4}});
 first.emit('message',{type:'stor',ident:'ls',op:'del',data:['key']});assert.equal(f.local.size,0);
});
// Failure inventory: docs/efficiency.md, Persistence, P11. A unit test: which worker
// receives a storage message is visible only inside the coordinator's IPC.
test('metrics outbox keys reach only their owner while other keys still broadcast',()=>{
 const f=fixture(),w=f.manager.start('W');f.blocks.P={enabled:true};const p=f.manager.start('P');
 const header='party-metrics-v1:W',frame='party-metrics-v1:W:frame:7',other='party-metrics-v1:P:frame:3';
 f.local.set(other,'{"sequence":3}');
 w.emit('message',{type:'stor',ident:'ls',op:'set',data:{[frame]:'{"sequence":7}'}});
 w.emit('message',{type:'stor',ident:'ls',op:'set',data:{[header]:'{"queue":[7]}'}});
 assert.equal(f.local.get(frame),'{"sequence":7}');assert.equal(f.local.get(header),'{"queue":[7]}');
 assert.equal(p.sent.length,0,'an outbox write reaches no other worker');assert.equal(w.sent.length,0);
 w.emit('message',{type:'stor',ident:'ls',op:'set',data:{[frame]:'{"sequence":7}',cm_P_x:'[1]'}});
 assert.deepEqual(p.sent.at(-1),{type:'stor',ident:'ls',op:'set',data:{cm_P_x:'[1]'}},'a mixed write broadcasts only its shared keys');
 p.emit('message',{type:'stor',ident:'ls',op:'init'});
 assert.deepEqual(p.sent.at(-1).data,{[other]:'{"sequence":3}',cm_P_x:'[1]'},"init leaves out other characters' outbox keys");
 w.emit('message',{type:'stor',ident:'ls',op:'init'});
 assert.deepEqual(w.sent.at(-1).data,{[frame]:'{"sequence":7}',[header]:'{"queue":[7]}',cm_P_x:'[1]'},"init returns the owner's outbox");
 const sent=p.sent.length;w.emit('message',{type:'stor',ident:'ls',op:'del',data:[frame]});
 assert.equal(f.local.has(frame),false);assert.equal(p.sent.length,sent,'an outbox removal reaches no other worker');
 w.emit('message',{type:'stor',ident:'ss',op:'set',data:{[header]:'session'}});
 assert.deepEqual(p.sent.at(-1),{type:'stor',ident:'ss',op:'set',data:{[header]:'session'}},'session storage keeps broadcasting every key');
});
test('CM routes local recipients directly and remote recipients through the sender',()=>{
 const f=fixture(),first=f.manager.start('W');f.blocks.P={enabled:true,connected:true};const second=f.manager.start('P');
 first.emit('message',{type:'cm',to:['P','Other'],data:{hello:true}});
 assert.deepEqual(first.sent.at(-1),{type:'send_cm',to:['Other'],data:{hello:true}});assert.deepEqual(second.sent.at(-1),{type:'receive_cm',name:'W',data:{hello:true}});
});
test('worker stop requests graceful termination before killing after the grace interval',async()=>{
 const f=fixture(),w=f.manager.start('W');f.blocks.W.connected=true;await f.manager.stop(f.blocks.W,'fixture');
 assert.deepEqual(w.sent.at(-1),{type:'closing_client'});assert.deepEqual(w.killed,['SIGKILL']);assert.equal(f.blocks.W.instance,null);assert.equal(w.partyStopReason,'fixture');
});

test('new workers use the current default, pinned workers retain their version, and only current workers can signal updates',()=>{
 // Each update asks the client files for the official client; this one never answers, so the rows
 // read only who asked and with which force.
 const f=fixture(),updates=[];f.ports.gameFiles={refresh_latest:force=>{updates.push(force);return new Promise(()=>{});}};
 const first=f.manager.start('W');first.emit('message',{type:'process_ready'});assert.equal(first.sent[0].arguments.version,10);
 const firstInstance=f.blocks.W.clientInstance;const next=f.manager.start('W');next.emit('message',{type:'process_ready'});
 assert.equal(next.sent[0].arguments.version,10);assert.notEqual(f.blocks.W.clientInstance,firstInstance);
 first.emit('message',{type:'client_update',event:'reloaded'});assert.deepEqual(updates,[],'a retired worker signals nothing');
 next.emit('message',{type:'client_update',event:'welcome'});assert.deepEqual(updates,[false],'a welcome asks without force');
 const p=fixture(),asked=[];p.ports.gameFiles={refresh_latest:force=>{asked.push(force);return new Promise(()=>{});}};
 p.blocks.W.version=9;const pinned=p.manager.start('W');pinned.emit('message',{type:'process_ready'});assert.equal(pinned.sent[0].arguments.version,9);
 pinned.emit('message',{type:'client_update',event:'reloaded'});assert.deepEqual(asked,[],'a pinned worker asks no update');
});
