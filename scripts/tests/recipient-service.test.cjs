const test=require('node:test'),assert=require('node:assert/strict');
const {createRecipientService}=require('../../runtime/characters/recipient-service.ts');
function fixture(saved=null) {
 let journal=saved,fail=false,service;const calls=[],errors=[];
 const command={id:5,jobId:'collection',type:'merchant-handoff',concurrentService:true};
 const ports={read:()=>journal,write:j=>{journal=structuredClone(j);},available:()=>true,
  execute:async c=>{calls.push('send');await service.complete(c,'/complete',{commandId:c.id});},
  post:async()=>{calls.push('receipt');if(fail)throw Error('network');},report:e=>errors.push(e)};
 service=createRecipientService(ports);
 return {service,ports,command,calls,errors,saved:()=>journal,fail:()=>{fail=true;}};
}
test('concurrent merchant receipt replay never repeats a transfer after reconnect',async()=>{
 const f=fixture();f.fail();await f.service.receive(f.command);
 assert.deepEqual(f.calls,['send','receipt']);assert.ok(f.saved().receipt);
 const restored=fixture(f.saved());await restored.service.receive(f.command);await restored.service.receive(f.command);
 assert.deepEqual(restored.calls,['receipt']);assert.equal(restored.saved().complete,true);
});
test('an interrupted transfer remains uncertain rather than being sent again',async()=>{
 const f=fixture({id:5,jobId:'collection',started:true});await f.service.receive(f.command);
 assert.deepEqual(f.calls,[]);assert.match(f.errors[0],/uncertain/);
 await f.service.receive({...f.command,id:6,jobId:'retry'});assert.deepEqual(f.calls,[]);
});
test('duplicate heartbeats serialize service and a newer job revokes the old service',async()=>{
 const f=fixture();let release;
 f.ports.execute=()=>new Promise(r=>{release=r;f.calls.push('send');});
 const pending=f.service.receive(f.command);await f.service.receive(f.command);
 assert.deepEqual(f.calls,['send']);await f.service.receive(null);
 assert.equal(f.service.owns(f.command),false);release();await pending;
});
