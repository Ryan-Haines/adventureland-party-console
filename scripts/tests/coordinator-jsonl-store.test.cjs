const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {CoordinatorJsonlStore:Store}=require('../../runtime/coordinator/persistence/jsonl-store.ts');
function fixture(t){fs.mkdirSync('.build/store-tests',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.build/store-tests/run-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return [path.join(dir,'state.jsonl'),path.join(dir,'state.new.jsonl')];}
test('loads a journal beyond the V8 string limit without reading it into one string',t=>{
 const [main,rotation]=fixture(t),fd=fs.openSync(main,'w');
 const record=JSON.stringify({history:'x'.repeat(256*1024)})+'\n';
 for(let i=0;i<2100;i++)fs.writeFileSync(fd,record);
 fs.writeFileSync(fd,JSON.stringify({history:'latest'})+'\n'+JSON.stringify({unicode:'dreams ✨ 🐈'})+'\n');fs.closeSync(fd);
 assert.ok(fs.statSync(main).size>0x1fffffe8);
 const s=new Store(main,rotation);try {assert.equal(s.get('history'),'latest');assert.equal(s.get('unicode'),'dreams ✨ 🐈');assert.ok(fs.statSync(main).size<1000);}finally{s.close();}
});
test('preserves legacy tombstones, objects, UTF-8 chunk boundaries, and final record without newline',t=>{
 const [main,rotation]=fixture(t);const value='猫'.repeat(50000);
 fs.writeFileSync(main,JSON.stringify({a:1})+'\n'+JSON.stringify({a:null})+'\n'+JSON.stringify({b:{value}}));
 const s=new Store(main,rotation);s.set('other',false);s.close();
 const r=new Store(main,rotation);try {assert.equal(r.get('a'),undefined);assert.deepEqual(r.get('b'),{value});assert.equal(r.get('other'),false);}finally{r.close();}
});
test('compacts by size even without yielding to the interval; latest updates and deletion survive restart',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation);const value='x'.repeat(1024*1024);
 for(let i=0;i<140;i++)s.set('state',value+i);
 assert.ok(fs.statSync(main).size<32*1024*1024);s.set('keep',3);s.delete('state');s.close();
 const r=new Store(main,rotation);try{assert.equal(r.get('state'),undefined);assert.equal(r.get('keep'),3);}finally{r.close();}
});
test('a live writer is protected and closing releases its lock',t=>{
 const [main,rotation]=fixture(t),s=new Store(main,rotation);
 assert.throws(()=>new Store(main,rotation),/live writer/);s.close();const r=new Store(main,rotation);r.close();
});
test('malformed input preserves the source and releases the startup lock',t=>{
 const [main,rotation]=fixture(t);fs.writeFileSync(main,'{"valid":1}\n{"broken"');const original=fs.readFileSync(main);
 assert.throws(()=>new Store(main,rotation));assert.deepEqual(fs.readFileSync(main),original);assert.equal(fs.existsSync(main+'.writer.lock'),false);
});
test('recovers a completed replacement only if the main file is absent',t=>{
 const [main,rotation]=fixture(t);fs.writeFileSync(rotation,'{"keep":7}\n');const s=new Store(main,rotation);assert.equal(s.get('keep'),7);s.close();
});
