// Metrics journal (runtime/coordinator/metrics/jsonl-store.ts), docs/efficiency.md
// § Metrics history. Failure inventory, written before the change:
// 1. A crash mid-append leaves a torn last line; replay throws and the whole
//    Metrics workspace answers 503 until someone edits the file.
// 2. A torn-tail repair hides real corruption: an unreadable line followed by
//    valid records must still fail, naming the line.
// 3. The repair drops the torn bytes without a copy, so a wrong guess loses data.
// 4. After the repair the next append joins the torn bytes on one line.
// 5. A live set above the 128 MB trigger compacts on every write, because a
//    compaction leaves bytes equal to the live set.
// 6. Growth compaction never runs, so superseded bucket rewrites grow the file
//    without bound between the 30 min timer runs.
// 7. Startup rewrites a journal that is already compact.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {MetricsJsonlStore:Store}=require('../../runtime/coordinator/metrics/jsonl-store.ts');

function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'metrics-journal-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 return [path.join(directory,'party.metrics.jsonl'),path.join(directory,'party.metrics.jsonl.compact'),directory];
}
const limits={supersededBytes:64*1024,growth:3,maxBytes:1024*1024};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('a torn last line is dropped with a copy and the next append starts a new line (1, 3, 4)',async t=>{
 const [main,compact,directory]=fixture(t);
 fs.writeFileSync(main,'{"bucket:10000:0":{"n":1}}\n{"bucket:10000:10000":{"n":2}}\n{"bucket:10000:20000":{"n":');
 const store=new Store(main,compact,60_000,limits);
 assert.deepEqual(store.get('bucket:10000:0'),{n:1});
 assert.deepEqual(store.get('bucket:10000:10000'),{n:2});
 assert.equal(store.get('bucket:10000:20000'),undefined);
 const copies=fs.readdirSync(directory).filter(name=>name.includes('.torn-'));
 assert.equal(copies.length,1);
 assert.equal(fs.readFileSync(path.join(directory,copies[0]),'utf8'),'{"bucket:10000:20000":{"n":');
 store.set('next',{n:3});await store.close();
 const reopened=new Store(main,compact,60_000,limits);
 try{assert.deepEqual(reopened.get('next'),{n:3});assert.deepEqual(reopened.get('bucket:10000:10000'),{n:2});}
 finally{await reopened.close();}
});

test('an unreadable line followed by records fails with its line number (2)',t=>{
 const [main,compact]=fixture(t);
 fs.writeFileSync(main,'{"a":1}\n{"b":\n{"c":3}\n');
 assert.throws(()=>new Store(main,compact,60_000,limits),/corrupt at line 2/);
 assert.equal(fs.readFileSync(main,'utf8'),'{"a":1}\n{"b":\n{"c":3}\n');
});

test('a live set above the size cap does not compact on every write (5)',async t=>{
 const [main,compact]=fixture(t);
 const store=new Store(main,compact,60_000,limits);
 // 1.5 MB live set: above maxBytes, so the v1.5 rule compacted after each set.
 for(let i=0;i<150;i++)store.set('bucket:'+i,{fill:'x'.repeat(10_000)});
 await store.flush();await settle();await store.flush();
 const before=fs.statSync(main).size;
 for(let i=0;i<5;i++)store.set('bucket:'+i,{fill:'y'.repeat(10_000)});
 await store.flush();await settle();await store.flush();
 assert.ok(fs.statSync(main).size>before,'five small overwrites append instead of rewriting 1.5 MB each time');
 await store.close();
});

test('superseded records compact once they pass the growth rule (6)',async t=>{
 const [main,compact]=fixture(t);
 const store=new Store(main,compact,60_000,limits);
 store.set('live',{fill:'l'.repeat(1000)});
 // Rewrite one 1 KB key: superseded bytes pass 64 KB and 3x the live set.
 for(let i=0;i<100;i++){store.set('bucket',{i,fill:'b'.repeat(1000)});await settle();}
 await store.flush();await settle();await store.flush();
 assert.ok(fs.statSync(main).size<70_000,'compacted at about 64 KB of rewrites, not 100 KB');
 await store.close();
 const reopened=new Store(main,compact,60_000,limits);
 try{assert.equal(reopened.get('bucket').i,99);assert.equal(reopened.get('live').fill.length,1000);}
 finally{await reopened.close();}
});

test('a journal without superseded records opens without a rewrite (7)',async t=>{
 const [main,compact]=fixture(t);
 const store=new Store(main,compact,60_000,limits);
 for(let i=0;i<20;i++)store.set('bucket:'+i,{i});
 await store.close();
 const written=fs.statSync(main).mtimeMs;
 await new Promise(resolve=>setTimeout(resolve,50));
 const reopened=new Store(main,compact,60_000,limits);
 await reopened.flush();await settle();await reopened.flush();
 try{assert.equal(fs.statSync(main).mtimeMs,written);assert.equal(fs.existsSync(compact),false);}
 finally{await reopened.close();}
});
