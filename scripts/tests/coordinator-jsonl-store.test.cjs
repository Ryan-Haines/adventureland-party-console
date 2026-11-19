const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {CoordinatorJsonlStore:Store}=require('../../runtime/settings/coordinator/persistence/jsonl-store.ts');
const {syncBuiltinESMExports}=require('node:module');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
test('Linux stat token parsing uses field 22 after the full command name',()=>{
 const {linuxProcessStart}=require('../../runtime/settings/coordinator/persistence/process-lock.ts');
 assert.equal(linuxProcessStart('82 (worker (name) here) S '+Array.from({length:18},(_,i)=>String(i+4)).join(' ')+' 999 23'),'999');
 assert.equal(linuxProcessStart('malformed'),undefined);
});

test('abruptly terminated process releases stale ownership on next journal open',async t=>{
 const [main,rotation]=fixture(t);
 const script=`const {CoordinatorJsonlStore}=require('./runtime/settings/coordinator/persistence/jsonl-store.ts');const s=new CoordinatorJsonlStore(process.argv[1],process.argv[2],{setTimeout,clearTimeout});s.set('saved',{value:7});process.send('ready');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--experimental-strip-types','-e',script,main,rotation],{stdio:['ignore','pipe','pipe','ipc']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 await once(child,'message');
 assert.throws(()=>new Store(main,rotation,{setTimeout,clearTimeout}),/live writer/);
 const exited=once(child,'exit');child.kill('SIGKILL');await exited;
 const restored=new Store(main,rotation,{setTimeout,clearTimeout});try{assert.deepEqual(restored.get('saved'),{value:7});}finally{restored.close();}
});

test('legacy live PID and malformed ownership locks are preserved conservatively',t=>{
 const [main,rotation]=fixture(t),lock=main+'.writer.lock';
 for(const value of [String(process.pid),'', '{broken',JSON.stringify({version:1,pid:process.pid})]){
  fs.writeFileSync(lock,value);assert.throws(()=>new Store(main,rotation,{setTimeout,clearTimeout}),/live writer|unverifiable/);
  assert.equal(fs.readFileSync(lock,'utf8'),value);fs.unlinkSync(lock);
 }
});

test('Linux process token distinguishes a reused live PID and previous boot', {skip:process.platform!=='linux'},t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout}),lock=main+'.writer.lock';
 const identity=JSON.parse(fs.readFileSync(lock,'utf8'));s.close();
 for(const patch of [{start:'0'},{boot:'previous-boot'}]){
  fs.writeFileSync(lock,JSON.stringify({...identity,...patch}));
  const recovered=new Store(main,rotation,{setTimeout,clearTimeout});recovered.close();
 }
 fs.writeFileSync(lock,JSON.stringify({...identity,namespace:'foreign-namespace'}));
 const recovered=new Store(main,rotation,{setTimeout,clearTimeout});recovered.close();
});

test('Linux advisory guard persists its inode and prevents a second file-description writer', {skip:process.platform!=='linux'},t=>{
 const [main,rotation]=fixture(t),first=new Store(main,rotation,{setTimeout,clearTimeout}),guard=main+'.writer.guard';
 const inode=fs.statSync(guard).ino;assert.throws(()=>new Store(main,rotation,{setTimeout,clearTimeout}),/live writer/);
 first.close();assert.equal(fs.statSync(guard).ino,inode);
 const next=new Store(main,rotation,{setTimeout,clearTimeout});next.close();assert.equal(fs.statSync(guard).ino,inode);
});
function fixture(t){fs.mkdirSync('.build/store-tests',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.build/store-tests/run-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return [path.join(dir,'state.jsonl'),path.join(dir,'state.new.jsonl')];}
test('loads a journal beyond the V8 string limit without reading it into one string',t=>{
 const [main,rotation]=fixture(t),fd=fs.openSync(main,'w');
 const record=JSON.stringify({history:'x'.repeat(256*1024)})+'\n';
 for(let i=0;i<2100;i++)fs.writeFileSync(fd,record);
 fs.writeFileSync(fd,JSON.stringify({history:'latest'})+'\n'+JSON.stringify({unicode:'dreams ✨ 🐈'})+'\n');fs.closeSync(fd);
 assert.ok(fs.statSync(main).size>0x1fffffe8);
 const s=new Store(main,rotation,{setTimeout,clearTimeout});try {assert.equal(s.get('history'),'latest');assert.equal(s.get('unicode'),'dreams ✨ 🐈');assert.ok(fs.statSync(main).size<1000);}finally{s.close();}
});
test('preserves legacy tombstones, objects, UTF-8 chunk boundaries, and final record without newline',t=>{
 const [main,rotation]=fixture(t);const value='猫'.repeat(50000);
 fs.writeFileSync(main,JSON.stringify({a:1})+'\n'+JSON.stringify({a:null})+'\n'+JSON.stringify({b:{value}}));
 const s=new Store(main,rotation,{setTimeout,clearTimeout});s.set('other',false);s.close();
 const r=new Store(main,rotation,{setTimeout,clearTimeout});try {assert.equal(r.get('a'),undefined);assert.deepEqual(r.get('b'),{value});assert.equal(r.get('other'),false);}finally{r.close();}
});
test('compacts by size even without yielding to the interval; latest updates and deletion survive restart',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout});const value='x'.repeat(1024*1024);
 for(let i=0;i<140;i++)s.set('state',value+i);
 assert.ok(fs.statSync(main).size<32*1024*1024);s.set('keep',3);s.delete('state');s.close();
 const r=new Store(main,rotation,{setTimeout,clearTimeout});try{assert.equal(r.get('state'),undefined);assert.equal(r.get('keep'),3);}finally{r.close();}
});
test('a live writer is protected and closing releases its lock',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout});
 assert.throws(()=>new Store(main,rotation,{setTimeout,clearTimeout}),/live writer/);s.close();const r=new Store(main,rotation,{setTimeout,clearTimeout});r.close();
});
test('a corrupt line before other records preserves the source, names its place and releases the startup lock',t=>{
 const [main,rotation]=fixture(t);fs.writeFileSync(main,'{"valid":1}\n{"broken"\n{"after":2}\n');const original=fs.readFileSync(main);
 assert.throws(()=>new Store(main,rotation,{setTimeout,clearTimeout}),/line 2, byte offset 12/);assert.deepEqual(fs.readFileSync(main),original);assert.equal(fs.existsSync(main+'.writer.lock'),false);
 assert.deepEqual(fs.readdirSync(path.dirname(main)).filter(name=>name.includes('.torn-')),[],'corruption is not treated as a torn write');
});
test('recovers a completed replacement only if the main file is absent',t=>{
 const [main,rotation]=fixture(t);fs.writeFileSync(rotation,'{"keep":7}\n');const s=new Store(main,rotation,{setTimeout,clearTimeout});assert.equal(s.get('keep'),7);s.close();
});

// SF36: a compaction a sharing conflict defers
// keeps every write, and retries once the journal has grown one more growth step
// (COMPACT_SUPERSEDED_BYTES), not before, at every size; the 128 MB bound also tells the bound
// record. The rows raise the store's byte count instead of writing tens of megabytes, so each
// growth step is the counter's, and the rename fails once with the planted code.
const {COMPACT_MAX_BYTES}=require('../../runtime/settings/coordinator/persistence/jsonl-store.ts');
function deferredStore(t,code){
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout});t.after(()=>s.close());
 s.set('keep',1);s.set('remove',2);
 const rename=fs.renameSync,calls={count:0};
 t.mock.method(fs,'renameSync',(...args)=>{calls.count++;if(calls.count===1)throw Object.assign(Error('file in use'),{code});return rename(...args);});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 t.mock.method(console,'warn',()=>{});
 const replay=()=>Object.assign({},...fs.readFileSync(main,'utf8').trim().split('\n').map(JSON.parse));
 return {s,main,rotation,calls,replay};
}
// The store's compaction turn is a timer on its run scope handle, so the test waits one timer turn.
const turn=()=>new Promise(resolve=>setTimeout(resolve));
for(const code of ['EPERM','EACCES','EBUSY'])test('SF36: a '+code+' during rotation keeps every write and retries after one more growth step',async t=>{
 const {s,main,rotation,calls,replay}=deferredStore(t,code);
 s.bytes=s.liveBytes+COMPACT_SUPERSEDED_BYTES+1;s.set('keep',3);await turn();
 assert.equal(calls.count,1,'the growth compaction ran and was deferred');
 s.delete('remove');await turn();s.set('keep',4);await turn();
 assert.equal(calls.count,1,'no retry before the journal grows one more step');
 assert.deepEqual(replay(),{keep:4,remove:null},'the journal holds the writes after the failed rename');
 s.bytes+=COMPACT_SUPERSEDED_BYTES;s.set('keep',5);await turn();
 assert.equal(calls.count,2,'the retry comes with the next growth step');
 assert.deepEqual(replay(),{keep:5});
 s.close();const restored=new Store(main,rotation,{setTimeout,clearTimeout});try{assert.equal(restored.get('keep'),5);assert.equal(restored.get('remove'),undefined);}finally{restored.close();}
});
// Observed on the live console 2026-11-18: a 207 MB metrics live set rewrote the whole file on
// every append, about 50 GB of writes in 10 minutes.
test('a live set past the 128 MB bound appends without compacting',async t=>{
 const {s,calls}=deferredStore(t,'EBUSY');
 s.bytes+=COMPACT_MAX_BYTES;s.liveBytes+=COMPACT_MAX_BYTES;s.set('keep',3);await turn();
 assert.equal(calls.count,0,'no superseded growth, so no compaction');
 s.close();
});
test('SF36: a deferral at the 128 MB bound waits one growth step and tells the bound record',async t=>{
 const {boundFirings}=require('../../runtime/status/coordinator/api.ts');
 const fired=()=>boundFirings().counts.COMPACT_MAX_BYTES||0,before=fired();
 const {s,calls,replay}=deferredStore(t,'EBUSY');
 s.bytes=s.liveBytes+COMPACT_MAX_BYTES;s.set('keep',3);
 assert.equal(calls.count,1,'the bound compacts at once and the rename is deferred');
 assert.equal(fired(),before+1,'the bound tells the bound record');
 s.set('keep',4);
 assert.equal(calls.count,1,'no retry before the journal grows one more step');
 s.bytes+=COMPACT_SUPERSEDED_BYTES;s.set('keep',5);
 assert.equal(calls.count,2,'the retry comes with the next growth step');
 assert.deepEqual(replay(),{keep:5,remove:2});
 s.close();
});
test('non-sharing rotation failures remain visible and leave the append journal usable',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout});t.after(()=>s.close());s.set('keep',1);
 t.mock.method(fs,'renameSync',()=>{throw Object.assign(Error('I/O failure'),{code:'EIO'});});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 assert.throws(()=>s.refactor(),/I\/O failure/);s.set('keep',2);assert.equal(s.get('keep'),2);s.close();
});

// Content-addressed saves: docs/efficiency.md (Persistence), failure inventory P1.
const journalLines=main=>fs.readFileSync(main,'utf8').split('\n').filter(Boolean);
test('an identical save appends nothing and a changed save always appends',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout});
 const start=journalLines(main).length;
 s.set('roster',{slots:['F'],owner:'N'});
 for(let i=0;i<20;i++)s.set('roster',{slots:['F'],owner:'N'});
 assert.equal(journalLines(main).length,start+1,'equal content is one record');
 s.set('roster',{slots:['F','G'],owner:'N'});assert.equal(journalLines(main).length,start+2);
 s.set('roster',{owner:'N',slots:['F','G']});assert.equal(journalLines(main).length,start+3,'key order is content');
 s.set('text','abc');s.set('text','abc');s.set('text','abd');assert.equal(journalLines(main).length,start+5,'character localStorage strings');
 s.delete('roster');s.set('roster',{owner:'N',slots:['F','G']});
 assert.equal(journalLines(main).length,start+7,'delete then the same value appends tombstone and value');
 assert.deepEqual(s.get('roster'),{owner:'N',slots:['F','G']});s.close();
});
test('an unchanged save after restart compares against the replayed value',t=>{
 const [main,rotation]=fixture(t);let s=new Store(main,rotation,{setTimeout,clearTimeout});
 s.set('settings',{a:[1,{b:'猫'}]});s.close();
 s=new Store(main,rotation,{setTimeout,clearTimeout});const lines=journalLines(main).length;
 s.set('settings',{a:[1,{b:'猫'}]});assert.equal(journalLines(main).length,lines);
 s.set('settings',{a:[2]});assert.equal(journalLines(main).length,lines+1);s.close();
});
test('the store keeps the saved content when the caller mutates its object afterwards',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout});
 const live={items:[1]};s.set('bank',live);live.items.push(2);
 assert.deepEqual(s.get('bank'),{items:[1]});
 assert.deepEqual(Object.fromEntries(s.entries()).bank,{items:[1]});
 s.set('bank',live);assert.deepEqual(s.get('bank'),{items:[1,2]},'the changed object saves again');
 live.items.push(3);s.refactor();s.close();
 const r=new Store(main,rotation,{setTimeout,clearTimeout});try{assert.deepEqual(r.get('bank'),{items:[1,2]});}finally{r.close();}
});
test('a value without a JSON form saves as a deletion instead of an unreadable record',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout});
 s.set('gone',{a:1});s.set('gone',undefined);assert.equal(s.get('gone'),undefined);s.close();
 const r=new Store(main,rotation,{setTimeout,clearTimeout});try{assert.equal(r.get('gone'),undefined);}finally{r.close();}
});
test('an unchanged roster report through the writer appends nothing',t=>{
 const {createCoordinatorPersistence}=require('../../runtime/settings/coordinator/persistence/writer.ts');
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout});
 const state={aldata:{},headlessSlots:['F'],steamMembers:['N'],nativeOwner:'N',characterAppearances:{F:{skin:'a'}},steamSwitch:null};
 const writer=createCoordinatorPersistence(state,s,{setTimeout,clearTimeout});writer.roster();const lines=journalLines(main).length;
 for(let i=0;i<10;i++)writer.roster();assert.equal(journalLines(main).length,lines);
 state.headlessSlots.push('G');writer.roster();assert.equal(journalLines(main).length,lines+1,'in-place change is seen');
 state.headlessSlots.push('H');assert.deepEqual(s.get('party_dashboard_roster_state_v1').headlessSlots,['F','G']);s.close();
});

// Compaction on growth: docs/efficiency.md (Persistence), failure inventory P4.
function countRenames(t){
 const rename=fs.renameSync,calls={count:0,fail:null};
 t.mock.method(fs,'renameSync',(...args)=>{calls.count++;if(calls.fail)throw calls.fail;return rename(...args);});
 syncBuiltinESMExports();t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
 return calls;
}
const {COMPACT_SUPERSEDED_BYTES}=require('../../runtime/settings/coordinator/persistence/jsonl-store.ts');
test('a journal with nothing new is never rewritten by reopen or shutdown',async t=>{
 const [main,rotation]=fixture(t);let s=new Store(main,rotation,{setTimeout,clearTimeout});s.set('a',{value:1});s.set('b','x');s.close();
 const renames=countRenames(t);
 s=new Store(main,rotation,{setTimeout,clearTimeout});
 await new Promise(resolve=>setTimeout(resolve,150));
 s.set('a',{value:1});s.close();
 assert.equal(renames.count,0,'a compact journal stays as it is');
 const r=new Store(main,rotation,{setTimeout,clearTimeout});try{assert.deepEqual(r.get('a'),{value:1});assert.equal(r.get('b'),'x');}finally{r.close();}
});
test('growth past the superseded threshold compacts after the save returns and keeps every key',async t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout}),renames=countRenames(t);
 const turn=()=>new Promise(resolve=>setImmediate(resolve));
 assert.ok(COMPACT_SUPERSEDED_BYTES>0&&COMPACT_SUPERSEDED_BYTES<=48*1024*1024);
 s.set('small',{keep:true});s.delete('small');s.set('other',[1,2,3]);
 const chunk='x'.repeat(1024*1024);let i=0;
 while(renames.count===0&&i<64){
  s.set('big',chunk+(i++));
  assert.equal(renames.count,0,'the save that crosses the threshold does not compact inside itself');
  await turn();
 }
 assert.equal(renames.count,1,'compacts once growth passes the threshold');
 assert.ok(i*1024*1024>=COMPACT_SUPERSEDED_BYTES,'not before the minimum size');
 assert.ok(fs.statSync(main).size<2*1024*1024);
 for(let j=0;j<3;j++){s.set('big',chunk+'again'+j);await turn();}
 assert.equal(renames.count,1,'the next threshold needs new superseded bytes');
 s.close();
 const r=new Store(main,rotation,{setTimeout,clearTimeout});try{assert.equal(r.get('big'),chunk+'again2');assert.deepEqual(r.get('other'),[1,2,3]);assert.equal(r.get('small'),undefined);}finally{r.close();}
});
test('shutdown compacts superseded records',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout});
 for(let i=0;i<10;i++)s.set('a',{value:i});s.set('gone',1);s.delete('gone');s.close();
 assert.deepEqual(journalLines(main),[JSON.stringify({a:{value:9}})]);
});
test('a failed compaction at shutdown keeps the journal and releases the lock',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout}),renames=countRenames(t);
 s.set('a',1);s.set('a',2);renames.fail=Object.assign(Error('I/O failure'),{code:'EIO'});
 const warnings=t.mock.method(console,'warn',()=>{});
 assert.doesNotThrow(()=>s.close());assert.equal(fs.existsSync(main+'.writer.lock'),false);assert.equal(warnings.mock.callCount(),1);
 renames.fail=null;const r=new Store(main,rotation,{setTimeout,clearTimeout});try{assert.equal(r.get('a'),2);}finally{r.close();}
});

// Crash recovery: docs/efficiency.md (Persistence), failure inventory P6.
const tornCopies=main=>fs.readdirSync(path.dirname(main)).filter(name=>name.startsWith(path.basename(main)+'.torn-'));
for(const [name,tail] of [['without a newline','{"history":{"lines":[1,2'],['with a newline','{"history":{"lines":[1,2\n'],['of zero bytes','\0\0\0\0\0\0']])
test('a torn last line '+name+' is copied aside and dropped, and the journal opens',t=>{
 const [main,rotation]=fixture(t);fs.writeFileSync(main,'{"keep":1}\n{"history":{"lines":[1]}}\n'+tail);
 const warnings=t.mock.method(console,'warn',()=>{});
 const s=new Store(main,rotation,{setTimeout,clearTimeout});
 assert.equal(s.get('keep'),1);assert.deepEqual(s.get('history'),{lines:[1]},'the record before the torn one survives');
 const copies=tornCopies(main);assert.equal(copies.length,1);
 assert.equal(fs.readFileSync(path.join(path.dirname(main),copies[0]),'utf8'),tail,'the copy holds the torn bytes');
 assert.equal(warnings.mock.callCount(),1);
 if(tail.startsWith('{"history"'))assert.match(String(warnings.mock.calls[0].arguments[0]),/"history"/);
 s.set('next',2);s.close();
 const r=new Store(main,rotation,{setTimeout,clearTimeout});try{assert.equal(r.get('next'),2);assert.equal(r.get('keep'),1);}finally{r.close();}
 assert.equal(warnings.mock.callCount(),1,'nothing torn on the second start');
});
test('a last record without a newline keeps its own line when the next record is appended',t=>{
 const [main,rotation]=fixture(t);fs.writeFileSync(main,'{"a":1}\n{"b":2}');
 const s=new Store(main,rotation,{setTimeout,clearTimeout});s.set('c',3);s.close();
 assert.deepEqual(journalLines(main).map(line=>JSON.parse(line)),[{a:1},{b:2},{c:3}]);
});
test('each record is appended with one write of the whole line',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout});
 const write=fs.writeFileSync,writes=[];
 t.mock.method(fs,'writeFileSync',(target,data,...rest)=>{if(typeof target==='number')writes.push(String(data));return write(target,data,...rest);});
 syncBuiltinESMExports();
 try{s.set('a',{value:'x'.repeat(100000)});}finally{t.mock.restoreAll();syncBuiltinESMExports();}
 s.close();
 assert.equal(writes.length,1);assert.ok(writes[0].endsWith('}\n'));assert.deepEqual(JSON.parse(writes[0]),{a:{value:'x'.repeat(100000)}});
});
test('shutdown leaves a live set above the shutdown bound for the next start',t=>{
 const {CLOSE_COMPACT_MAX_BYTES}=require('../../runtime/settings/coordinator/persistence/jsonl-store.ts');
 assert.ok(CLOSE_COMPACT_MAX_BYTES>=16*1024*1024);
 const [main,rotation]=fixture(t),s=new Store(main,rotation,{setTimeout,clearTimeout});
 const chunk='y'.repeat(1024*1024);
 for(let i=0;i<Math.ceil(CLOSE_COMPACT_MAX_BYTES/chunk.length)+1;i++)s.set('live'+i,chunk);
 s.set('live0',chunk+'changed');
 const renames=countRenames(t);s.close();
 assert.equal(renames.count,0,'no compaction at shutdown');
 const r=new Store(main,rotation,{setTimeout,clearTimeout});try{assert.equal(r.get('live0'),chunk+'changed');}finally{r.close();}
});
