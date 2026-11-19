// The lifecycle owner's game client update (runtime/lifecycle/coordinator/workers.ts `requestUpdate`), on the
// workers' shared fixture (helpers/coordinator-workers.cjs). The official client comes from the
// client files (`gameFiles.refresh_latest`), each owner's data for it from `versionData`, the update
// status from `state.clientUpdate`, and each restarted worker's first report on the new client ends
// its wait (`reported`).
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture:workersFixture}=require('./helpers/coordinator-workers.cjs');
const {lifecycleSavedFields}=require('../../runtime/lifecycle/fields.ts');
const settle=async(done)=>{for(let i=0;i<1000&&!done();i++)await new Promise(resolve=>setImmediate(resolve));};
// A, B and Offline run the live client 10; Pinned keeps version 7. `reports` sends each started
// worker's first report on its own instance.
function fixture(){
 const f=workersFixture(),{ports,blocks,manager}=f,calls=[],options={reports:true};
 delete blocks.W;
 for(const name of ['A','B','Pinned'])blocks[name]={enabled:true,realm:'SR_USII',script:'adventure_land/generated/warrior.js',instance:ports.fork()};
 blocks.Pinned.version=7;blocks.Offline={enabled:false,realm:'SR_USII'};
 ports.gameFiles.refresh_latest=async force=>{calls.push(['refresh',force]);return {version:11,revision:'new'};};
 ports.versionData.movement=async version=>{calls.push(['prepare',version]);};
 ports.versionData.maps=version=>()=>calls.push(['activate',version]);
 ports.caveFloors=()=>({});
 ports.stopped=name=>{assert.equal(blocks[name].clientUpdating,true);calls.push(['stop',name]);};
 ports.notify=(hook,payload)=>{
  if(hook!=='worker.started')return;
  const name=payload.character,block=blocks[name];calls.push(['start',name,block.clientVersion]);
  if(options.reports)setImmediate(()=>manager.reported(name,{clientVersion:block.clientVersion,clientInstance:block.clientInstance}));
 };
 // The wait for a restarted worker's report, as the fixture's clock keeps it.
 const reportWait=()=>f.timers.find(timer=>!timer.cancelled&&timer.ms===lifecycleSavedFields.settings.clientUpdateWaitMs.default);
 return {...f,calls,options,reportWait,update:()=>f.ports.state.clientUpdate};
}
test('a welcome activates the candidate data and version, then restarts each unpinned worker in turn on its report',async()=>{
 const f=fixture();
 await f.manager.requestUpdate('welcome');
 assert.deepEqual(f.calls,[['refresh',false],['prepare',11],['activate',11],['stop','A'],['start','A',11],['stop','B'],['start','B',11]]);
 assert.equal(f.ports.state.gameVersion,11);assert.equal(f.update().phase,'ready');assert.equal(f.blocks.Pinned.version,7);
});
test('a client files or candidate data failure keeps the running workers and the live version',async()=>{
 for(const fail of [f=>{f.ports.gameFiles.refresh_latest=async()=>{throw Error('bad candidate');};},f=>{f.ports.versionData.movement=async()=>{throw Error('bad candidate');};}]){
  const f=fixture(),worker=f.blocks.A.instance;fail(f);
  await f.manager.requestUpdate('reloaded');
  assert.equal(f.ports.state.gameVersion,10);assert.equal(f.blocks.A.instance,worker);
  assert.ok(!f.calls.some(c=>c[0]==='stop'));assert.equal(f.update().error,'bad candidate');
 }
});
test('simultaneous welcomes share one refresh, while a reload during it gets a follow-up check',async()=>{
 const f=fixture();let release,count=0;
 f.ports.gameFiles.refresh_latest=force=>{f.calls.push(['refresh',force]);if(++count===1)return new Promise(resolve=>release=resolve);return Promise.resolve({version:10,revision:'10'});};
 const first=f.manager.requestUpdate('welcome');
 assert.equal(f.manager.requestUpdate('welcome'),first);assert.equal(f.manager.requestUpdate('reloaded'),first);
 release({version:10,revision:'10'});await first;
 assert.deepEqual(f.calls,[['refresh',false],['refresh',true]]);
});
test('an unchanged client restarts nothing; a same-version client with changed content restarts each worker',async()=>{
 const f=fixture();f.ports.gameFiles.refresh_latest=async()=>({version:10,revision:'10'});
 await f.manager.requestUpdate('welcome');assert.ok(!f.calls.some(c=>c[0]==='start'));
 f.ports.gameFiles.refresh_latest=async()=>({version:10,revision:'changed'});
 await f.manager.requestUpdate('reloaded');assert.equal(f.calls.filter(c=>c[0]==='start').length,2);
});
// clientUpdateWaitMs (lifecycle/fields.ts): the missed report tells the status owner's bound record.
test('no report on the new client halts the rollout, and the next event restarts the unfinished workers',async()=>{
 const {boundFirings}=require('../../runtime/status/coordinator/api.ts');
 const before=boundFirings().counts.clientUpdateWaitMs||0;
 const f=fixture();f.options.reports=false;
 const run=f.manager.requestUpdate('reloaded');
 await settle(()=>!!f.reportWait());f.reportWait().callback();await run;
 assert.match(f.update().error,/No report on the new client from A/);assert.ok(!f.calls.some(c=>c[0]==='stop'&&c[1]==='B'));
 assert.equal(boundFirings().counts.clientUpdateWaitMs,before+1);assert.equal(boundFirings().entries.at(-1).subject,'A');
 f.options.reports=true;
 await f.manager.requestUpdate('welcome');
 assert.equal(f.update().phase,'ready');assert.ok(f.calls.some(c=>c[0]==='start'&&c[1]==='B'));
});
test('a character disabled during the rollout is not restarted, and an older candidate is refused',async()=>{
 const f=fixture();f.ports.stopped=name=>{f.blocks[name].enabled=false;};
 await f.manager.requestUpdate('welcome');assert.ok(!f.calls.some(c=>c[0]==='start'));
 f.ports.gameFiles.refresh_latest=async()=>({version:9,revision:'stale'});
 await f.manager.requestUpdate('reloaded');assert.match(f.update().error,/older/);assert.equal(f.ports.state.gameVersion,11);
});
