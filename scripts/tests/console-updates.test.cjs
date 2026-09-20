const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {newer,published}=require('../../tools/update/contracts.ts');
const {sourceManifest,assertUnmodified,atomic}=require('../../tools/update/files.ts');
const {Updates}=require('../../tools/update/service.ts');
const {Installation}=require('../../tools/update/transaction.ts');
const {consoleMaintenance}=require('../../runtime/coordinator/lifecycle/console-maintenance.ts');
const release={version:'1.1.0',protocol:1,dataFormat:1,windows:{asset:'adventureland-party-console-1.1.0-windows-x64.zip',sha256:'a'.repeat(64)},image:'ghcr.io/ryan-haines/adventureland-party-console@sha256:'+'b'.repeat(64)};
async function temporary(work){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'console-update-'));try{await work(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
function service(dir,adapter){const value=new Updates({version:'1.0.0',repository:'ryan-haines/adventureland-party-console'},path.join(dir,'prefs.json'),adapter);value.github={latest:async()=>({version:'1.1.0',notes:'https://github.com/ryan-haines/adventureland-party-console/releases/tag/v1.1.0'}),manifest:async()=>release};return value;}
test('stable versions compare numerically and incompatible release payloads are refused',()=>{
 assert.equal(newer('1.10.0','1.9.9'),true);assert.equal(newer('1.0.0','1.0.0'),false);assert.equal(newer('1.9.9','2.0.0'),false);
 for(const bad of ['v1.0.0','01.0.0','1.0.0-beta.1','../../file'])assert.throws(()=>newer(bad,'1.0.0'));
 assert.equal(published(release,'ryan-haines/adventureland-party-console','1.1.0'),release);
 assert.throws(()=>published({...release,protocol:2},'ryan-haines/adventureland-party-console','1.1.0'),/manual/);
 assert.throws(()=>published({...release,image:'evil/image:latest'},'ryan-haines/adventureland-party-console','1.1.0'),/digest/);
});
test('source edit detection includes additions and deletions, excluding private state',()=>temporary(async dir=>{
 await fs.mkdir(path.join(dir,'runtime'));await fs.writeFile(path.join(dir,'runtime/a.ts'),'original');
 const manifest=await sourceManifest(dir);await fs.mkdir(path.join(dir,'.build'));await fs.writeFile(path.join(dir,'.build/cache'),'mutable');await assertUnmodified(dir,manifest);
 await fs.writeFile(path.join(dir,'runtime/b.ts'),'custom');await assert.rejects(assertUnmodified(dir,manifest),/b.ts/);
 await fs.rm(path.join(dir,'runtime/b.ts'));await fs.rm(path.join(dir,'runtime/a.ts'));await assert.rejects(assertUnmodified(dir,manifest),/a.ts/);
}));
test('automatic updates are off initially; running sessions stage and startup installs',()=>temporary(async dir=>{
 const calls=[],adapter={inspect:async()=>{},stage:async()=>calls.push('stage'),install:async(_,startup)=>calls.push(['install',startup])};
 const updates=service(dir,adapter);await updates.load();await updates.poll(true);assert.deepEqual(calls,[]);
 await updates.preference(true);await updates.poll();assert.deepEqual(calls,['stage']);assert.equal(updates.state.phase,'ready');
 await updates.poll(true);assert.deepEqual(calls,['stage',['install',true]]);assert.equal(updates.state.current,'1.1.0');
 await updates.poll();assert.equal(updates.state.phase,'idle');
}));
test('local edits preserve staged release but prohibit installation',()=>temporary(async dir=>{
 let installs=0;const updates=service(dir,{inspect:async()=>{throw Error('Local edits');},stage:async()=>{},install:async()=>installs++});
 await updates.check();await updates.download();assert.equal(updates.state.phase,'blocked');await updates.restart();assert.equal(installs,0);assert.match(updates.state.error,/Local edits/);
}));
test('failed automatic install is not retried in a restart loop',()=>temporary(async dir=>{
 let installs=0;const adapter={inspect:async()=>{},stage:async()=>{},install:async()=>{installs++;throw Error('startup failure');}};
 const updates=service(dir,adapter);await updates.preference(true);await updates.poll(true);assert.equal(installs,1);
 const restored=service(dir,adapter);await restored.load();await restored.poll(true);assert.equal(installs,1);assert.match(restored.state.error,/previously/);
}));
test('unavailable release server keeps installed version and never calls installer',()=>temporary(async dir=>{
 const updates=service(dir,{install:()=>assert.fail()});updates.github.latest=async()=>{throw Error('offline');};await updates.poll(true);
 assert.equal(updates.state.current,'1.0.0');assert.match(updates.state.error,/offline/);
}));
test('transaction failure restores pre-launch state and previous code',()=>temporary(async dir=>{
 await fs.mkdir(path.join(dir,'localStorage'));await fs.writeFile(path.join(dir,'localStorage/state'),'original');
 const starts=[];const driver={current:async()=>'old',stop:async()=>{},start:async target=>{starts.push(target);if(target==='new')await fs.writeFile(path.join(dir,'localStorage/state'),'migration');},healthy:async()=>false};
 const transaction=new Installation(driver,dir,async()=>{},1);
 await assert.rejects(transaction.install('new',true),/health/);assert.deepEqual(starts,['new','old']);assert.equal(await fs.readFile(path.join(dir,'localStorage/state'),'utf8'),'original');
 assert.equal(JSON.parse(await fs.readFile(path.join(dir,'updates/transaction.json'))).phase,'committed');
}));
test('committed restart recovery does not replay application installation',()=>temporary(async dir=>{
 await atomic(path.join(dir,'updates/transaction.json'),{previous:'old',target:'new',phase:'committed'});
 await new Installation({stop:()=>assert.fail(),start:()=>assert.fail()},dir).recover();
}));
test('interrupted candidate startup rolls back from its durable journal',()=>temporary(async dir=>{
 const backup=path.join(dir,'updates/backups/test');await fs.mkdir(path.join(backup,'localStorage'),{recursive:true});await fs.writeFile(path.join(backup,'localStorage/state'),'before');
 await fs.mkdir(path.join(dir,'localStorage'));await fs.writeFile(path.join(dir,'localStorage/state'),'candidate');
 await atomic(path.join(dir,'updates/transaction.json'),{previous:'old',target:'new',backup,phase:'started'});
 const calls=[];await new Installation({stop:async()=>calls.push('stop'),start:async target=>calls.push(target)},dir).recover();
 assert.deepEqual(calls,['stop','old']);assert.equal(await fs.readFile(path.join(dir,'localStorage/state'),'utf8'),'before');
}));
test('an in-flight download serializes update operations',()=>temporary(async dir=>{
 let finish;const updates=service(dir,{inspect:async()=>{},stage:()=>new Promise(resolve=>{finish=resolve;}),install:async()=>assert.fail()});
 await updates.check();const download=updates.download();await assert.rejects(updates.restart(),/already running/);finish();await download;assert.equal(updates.state.phase,'ready');
}));
test('maintenance requires fresh acknowledgements and never loses a disconnected participant',()=>temporary(async dir=>{
 let now=10000;await atomic(path.join(dir,'updates/pause.json'),{id:'pause',expires:30000});const gate=consoleMaintenance(dir,()=>now);
 assert.equal(gate.status({A:{seenAt:now}}).ready,false);
 assert.equal(gate.status({},['Missing']).ready,false);
 now+=1000;assert.equal(gate.status({A:{seenAt:now,consoleMaintenance:{id:'pause',ready:true}},Missing:{seenAt:now,consoleMaintenance:{id:'pause',ready:true}}}).ready,true);
 now+=20000;assert.equal(gate.status({}).ready,false);assert.equal(gate.current(),null);
}));
