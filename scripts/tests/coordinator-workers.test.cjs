const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/coordinator-workers.cjs');
test('an unresolved realm refreshes and retries without choosing a different realm',()=>{
 const f=fixture();let refreshed=0;f.ports.resolveRealm=()=>undefined;f.ports.refreshAccount=async()=>refreshed++;
 f.manager.start('W');assert.equal(f.workers.length,0);assert.equal(refreshed,1);assert.equal(f.lifecycle.W,'realm-error');
 assert.equal(f.timers[0].ms,3000);f.blocks.W.enabled=false;f.timers[0].callback();assert.equal(f.workers.length,0);
});
test('worker arguments and sibling messages preserve their wire format',()=>{
 const f=fixture(),w=f.manager.start('W');w.emit('message',{type:'process_ready'});
 assert.deepEqual(w.sent[0],{type:'process_args',arguments:{clientInstance:f.blocks.W.clientInstance,version:10,realm_address:'fixture',realm_path:'/',realm_port:443,sess:'fixture-session',cid:3,script_file:'adventure_land/generated/warrior.js',enable_map:false,cname:'W',clid:1}});
 assert.match(f.blocks.W.clientInstance,/^[a-f0-9-]{36}$/);
 w.emit('message',{type:'connected'});assert.equal(f.lifecycle.W,'online');assert.deepEqual(w.sent.at(-1),{type:'siblings_and_acc',account:{characters:['W']},siblings:['W']});
});
test('bootstrap repair finishes before replacement scheduling',async()=>{
 const f=fixture();let repair;f.ports.repair=()=>new Promise(resolve=>{repair=resolve;});const w=f.manager.start('W');
 w.emit('message',{type:'bootstrap_failed'});assert.equal(f.lifecycle.W,'repairing');w.emit('exit',1,null);
 await new Promise(setImmediate);assert.equal(f.timers.length,0);repair();await new Promise(setImmediate);
 assert.equal(f.timers[0].ms,1500);f.timers[0].callback();assert.equal(f.workers.length,2);
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
 const f=fixture();let version=11,updates=[];f.ports.currentVersion=()=>version;f.ports.clientUpdate=event=>updates.push(event);
 const first=f.manager.start('W');first.emit('message',{type:'process_ready'});assert.equal(first.sent[0].arguments.version,11);
 const firstInstance=f.blocks.W.clientInstance;version=12;const next=f.manager.start('W');next.emit('message',{type:'process_ready'});
 assert.equal(next.sent[0].arguments.version,12);assert.notEqual(f.blocks.W.clientInstance,firstInstance);
 first.emit('message',{type:'client_update',event:'reloaded'});assert.deepEqual(updates,[]);
 next.emit('message',{type:'client_update',event:'welcome'});assert.deepEqual(updates,['welcome']);
 f.blocks.W.version=9;const pinned=f.manager.start('W');pinned.emit('message',{type:'process_ready'});assert.equal(pinned.sent[0].arguments.version,9);
 pinned.emit('message',{type:'client_update',event:'reloaded'});assert.deepEqual(updates,['welcome']);
});
