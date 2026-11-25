// The debug instance service (tools/debug/service.ts) on its own: its startup waits run with no
// Docker, so the row drives the wait with a check that never answers true.
const {test}=require('node:test'),assert=require('node:assert/strict');
const os=require('node:os'),path=require('node:path');
const {DebugInstances}=require('../../tools/debug/service.ts');

// A startup wait that runs out is a host bound, so its end logs the bound's name.
test('a debug startup wait that runs out logs its bound and reports the timeout',async()=>{
 const instances=new DebugInstances(os.tmpdir(),path.join(os.tmpdir(),'party-debug-service'));
 const warned=[],warn=console.warn;console.warn=line=>warned.push(String(line));
 let calls=0;
 try{
  await assert.rejects(instances.until({name:'debugTestMs',ms:50},'the test wait',async step=>{calls++;assert.ok(step instanceof AbortSignal);return false;},new AbortController().signal),
   /Debug startup timed out/);
 }finally{console.warn=warn;}
 assert.equal(calls,1,'the wait checked again after its bound fired');
 assert.ok(warned.some(line=>line.includes('[bound] debugTestMs (50 ms) ended the test wait')),'the fired bound logged no name: '+warned.join(' | '));
});

// B213: a corrupt instance.json is the panel's error with no project, so the host
// starts. v1.5.0 threw it out of load(), which stopped the main console's host start.
test('B213: a corrupt debug instance record loads as an error and names no project',async t=>{
 const fs=require('node:fs'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'party-debug-corrupt-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 fs.writeFileSync(path.join(directory,'instance.json'),'{"phase":');
 const instances=await new DebugInstances(os.tmpdir(),directory).load();
 const status=await instances.status();
 assert.equal(status.phase,'error');
 assert.equal(status.project,undefined);
 assert.match(status.message,/record is unreadable/);
});
