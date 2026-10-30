const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {syncBuiltinESMExports}=require('node:module');
const {classScript}=require('../../runtime/lifecycle/generations.ts');

// classScript runs on every merchant dispatch (merchant home check -> ensureCharacterBlock -> worker setup).
// Failure lines:
// - a class file rewritten in place keeps passing the checksum
// - a new activation keeps returning the previous generation's file
// - a deleted class file stops failing the way v1.4.0 failed (ENOENT from the read)
// - a file that failed its checksum once passes later without a rewrite
// - classScript reads and hashes an unchanged class file again on every call
// - verified files accumulate without a bound across generations
const sha=value=>createHash('sha256').update(value).digest('hex');
function code(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'class-script-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const write=(label,options={})=>{
    const source=options.source??`globalThis.label=${JSON.stringify(label)};`,digest=sha(source),file=`generated/${digest}/warrior.js`;
    fs.mkdirSync(path.join(directory,path.dirname(file)),{recursive:true});fs.writeFileSync(path.join(directory,file),source);
    const manifest={schema:1,generation:digest,classes:{warrior:{file,sha256:options.sha256??digest,inputs:[]}}};
    fs.writeFileSync(path.join(directory,'activation.json'),JSON.stringify({id:label,manifest}));
    return {file,full:path.join(directory,file),digest};
  };
  return {directory,write};
}
function countReads(t,file){
  const original=fs.readFileSync;let reads=0;
  fs.readFileSync=function(target,...rest){if(path.resolve(String(target))===file)reads++;return original.call(this,target,...rest);};
  syncBuiltinESMExports();
  t.after(()=>{fs.readFileSync=original;syncBuiltinESMExports();});
  return ()=>reads;
}

test('an unchanged class file is hashed once across repeated dispatch lookups',t=>{
  const {directory,write}=code(t),a=write('A'),reads=countReads(t,a.full);
  for(let call=0;call<50;call++)assert.equal(classScript(directory,'warrior'),'adventure_land/'+a.file);
  assert.equal(reads(),1);
});

test('a class file rewritten in place fails its checksum on the next lookup',t=>{
  const {directory,write}=code(t),a=write('A');
  assert.equal(classScript(directory,'warrior'),'adventure_land/'+a.file);
  fs.writeFileSync(a.full,'globalThis.label="tampered";');
  assert.throws(()=>classScript(directory,'warrior'),/Compiled class checksum mismatch: warrior/);
  // Same length, different bytes: the size alone does not identify the content.
  fs.writeFileSync(a.full,'globalThis.label="B";');
  assert.throws(()=>classScript(directory,'warrior'),/checksum mismatch/);
});

test('a new activation returns its own generation and a failed file keeps failing',t=>{
  const {directory,write}=code(t),a=write('A');
  assert.equal(classScript(directory,'warrior'),'adventure_land/'+a.file);
  const b=write('B');
  assert.equal(classScript(directory,'warrior'),'adventure_land/'+b.file);
  write('C',{sha256:'0'.repeat(64)});
  for(let call=0;call<3;call++)assert.throws(()=>classScript(directory,'warrior'),/checksum mismatch/);
});

test('a deleted class file fails with the read error as before',t=>{
  const {directory,write}=code(t),a=write('A');
  assert.equal(classScript(directory,'warrior'),'adventure_land/'+a.file);
  fs.rmSync(a.full);
  assert.throws(()=>classScript(directory,'warrior'),error=>error.code==='ENOENT');
});

test('verification stays bounded across many generations',t=>{
  const {directory,write}=code(t);
  const files=[];for(let index=0;index<200;index++){files.push(write('G'+index));assert.equal(classScript(directory,'warrior'),'adventure_land/'+files.at(-1).file);}
  const reads=countReads(t,files[0].full);
  fs.writeFileSync(path.join(directory,'activation.json'),JSON.stringify({id:'back',manifest:{schema:1,generation:files[0].digest,classes:{warrior:{file:files[0].file,sha256:files[0].digest,inputs:[]}}}}));
  assert.equal(classScript(directory,'warrior'),'adventure_land/'+files[0].file);
  assert.equal(reads(),1,'an evicted generation is hashed again when it returns');
});
