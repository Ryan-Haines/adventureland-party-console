const {test}=require('node:test'),assert=require('node:assert/strict');
const {createClientUpdates}=require('../../runtime/coordinator/characters/client-updates.ts');
function fixture(){
 let current={version:10,revision:'old'},now=0,serial=0;
 const blocks={A:{enabled:true,instance:{}},B:{enabled:true,instance:{}},Pinned:{enabled:true,version:7,instance:{}},Offline:{enabled:false}};
 const calls=[],states=[];
 const ports={current:()=>current,refresh:async force=>{calls.push(['refresh',force]);return {version:11,revision:'new'}},prepare:candidate=>{calls.push(['prepare',candidate.version]);return 'data'},activate:(candidate,data)=>{calls.push(['activate',candidate.version,data]);current=candidate},blocks,
 stop:async block=>{assert.equal(block.clientUpdating,true);calls.push(['stop',Object.keys(blocks).find(name=>blocks[name]===block)]);block.instance=null},
 start:name=>{calls.push(['start',name,current.version]);return blocks[name].instance={id:++serial}},healthy:()=>true,now:()=>now,sleep:async ms=>{now+=ms},cancel(){},status:value=>states.push(value)};
 return {ports,blocks,calls,states,current:()=>current,service:createClientUpdates(ports)};
}
test('event refresh activates data and default version before sequential unpinned worker restarts',async()=>{
 const f=fixture();let checked=0;f.ports.healthy=(name,worker)=>{checked++;assert.equal(f.blocks[name].instance,worker);return true};
 await f.service.request('welcome');assert.equal(checked,2);
 assert.deepEqual(f.calls,[['refresh',false],['prepare',11],['activate',11,'data'],['stop','A'],['start','A',11],['stop','B'],['start','B',11]]);
 assert.equal(f.states.at(-1).phase,'ready');assert.equal(f.blocks.Pinned.version,7);
});
test('download or candidate preparation failure preserves running workers and active version',async()=>{
 for(const point of ['refresh','prepare']){const f=fixture(),worker=f.blocks.A.instance;f.ports[point]=()=>{throw Error('bad candidate')};await f.service.request('reloaded');assert.equal(f.current().version,10);assert.equal(f.blocks.A.instance,worker);assert.ok(!f.calls.some(c=>c[0]==='stop'));assert.equal(f.states.at(-1).error,'bad candidate');}
});
test('simultaneous welcomes share one refresh, while a reload during it gets a follow-up check',async()=>{
 const f=fixture();let release,count=0;f.ports.refresh=force=>{f.calls.push(['refresh',force]);if(++count===1)return new Promise(resolve=>release=resolve);return Promise.resolve(f.current())};
 const first=f.service.request('welcome');assert.equal(f.service.request('welcome'),first);assert.equal(f.service.request('reloaded'),first);
 release(f.current());await first;assert.deepEqual(f.calls,[['refresh',false],['refresh',true]]);
});
test('unchanged client does not restart; same-version changed content does',async()=>{
 const f=fixture();f.ports.refresh=async()=>f.current();await f.service.request('welcome');assert.equal(f.calls.length,0);
 f.ports.refresh=async()=>({version:10,revision:'changed'});await f.service.request('reloaded');assert.equal(f.calls.filter(c=>c[0]==='start').length,2);
});
test('heartbeat timeout halts rollout and next event retries the unfinished characters',async()=>{
 const f=fixture();f.ports.healthy=()=>false;await f.service.request('reloaded');assert.match(f.states.at(-1).error,/No fresh heartbeat from A/);assert.ok(!f.calls.some(c=>c[0]==='stop'&&c[1]==='B'));
 f.ports.healthy=()=>true;await f.service.request('welcome');assert.equal(f.states.at(-1).phase,'ready');assert.ok(f.calls.some(c=>c[0]==='start'&&c[1]==='B'));
});
test('a character disabled during rollout is not restarted and an older candidate is rejected',async()=>{
 const f=fixture();f.ports.stop=async block=>{block.enabled=false;block.instance=null};await f.service.request('welcome');assert.ok(!f.calls.some(c=>c[0]==='start'));
 f.ports.refresh=async()=>({version:9,revision:'stale'});await f.service.request('reloaded');assert.match(f.states.at(-1).error,/older/);assert.equal(f.current().version,11);
});
