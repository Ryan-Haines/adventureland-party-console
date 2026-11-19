import {createHash, randomUUID} from 'node:crypto';
import {cp, lstat, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import path from 'node:path';
import {ConsoleBuildStore} from './store.ts';
import type {Candidate, CandidateManifest} from './contracts.ts';
import {writeInstalled} from '../../runtime/hooks/build/installed.mts';
import {lifecycleSavedFields} from '../../runtime/lifecycle/fields.ts';
import {stopTree, waitForHealthy} from '../hosting/process-tree.ts';
import type {HostBound} from '../hosting/http.ts';

// The candidate dashboard's readiness bound: a candidate server that starts and never answers its
// page fails the build at this bound, which the build log names.
const DASHBOARD_READY: HostBound = {name: 'candidateDashboardReadyMs', ms: 30_000};
const pollMs = lifecycleSavedFields.settings.hostPollMs.default;

// Maintained debug hosting imports the native fixture client/bootstrap boundary.
const roots = ['runtime', 'characters', 'dashboard', 'tools', 'scripts', 'patches', 'e2e', '.caracal'];
const excluded = new Set(['node_modules','.git','.build','.wrangler','.vinext','dist','game_files','localStorage','CODE','TYPECODE','logs','sessions','cache']);
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
async function removeOwnedStage(parent:string,stage:string):Promise<void>{
  const relative=path.relative(path.resolve(parent),path.resolve(stage));
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Refusing stage removal outside its store');
  const info=await lstat(stage).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
  if(!info)return;
  if(info.isSymbolicLink())throw new Error('Refusing redirected stage removal');
  await rm(path.resolve(stage),{recursive:true,force:true});
}
function caracalFile(parts:string[]):boolean{
  if(['src','standalones','presentation'].includes(parts[1]))return true;
  if(parts.length===2)return ['package.json','package-lock.json','account_info.js','game_files.js','html_vars.js','ipcStorage.js','main.js','monitoring_util.js','tsconfig.json'].includes(parts[1]);
  return false;
}
function permitted(name: string): boolean {
  const parts=name.split('/'), base=parts.at(-1)!;
  if(parts.some(part=>excluded.has(part)) || base.startsWith('.env') || /\.(log|tmp|bak|tsbuildinfo)$/.test(base)) return false;
  if(name.startsWith('dashboard/lib/')&&['account-inventory.cjs','compound-cost.cjs'].includes(base))return false;
  if(name==='runtime/hunting/farming-areas.cjs')return false;
  if(name.startsWith('.caracal/')&&!caracalFile(parts))return false;
  if(name.startsWith('characters/'))return name==='characters/shared.js';
  return true;
}
// A file's stat stamp (size and modification time in ns) beside the content hash it was read with.
type Stamped=Map<string,{stamp:string;hash:string}>;
async function inventory(root: string, outputs=false, stamped?: Stamped): Promise<Record<string,string>> {
  const files:Record<string,string>={};
  const names:string[]=[];
  async function walk(relative:string):Promise<void>{
    const entries=await readdir(path.join(root,relative),{withFileTypes:true}).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;});
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
      const name=relative?relative+'/'+entry.name:entry.name;
      if(entry.isSymbolicLink()) continue;
      if(!outputs&&!permitted(name))continue;
      if(entry.isDirectory())await walk(name);
      else if(entry.isFile())names.push(name);
    }
  }
  if(outputs)await walk('');
  else {
    for(const directory of roots)await walk(directory);
    for(const entry of await readdir(root,{withFileTypes:true}))if(entry.isFile() && /^(package(?:-lock)?\.json|tsconfig.*\.json|distribution.*)$/.test(entry.name))names.push(entry.name);
  }
  names.sort();let cursor=0;
  await Promise.all(Array.from({length:Math.min(32,names.length)},async()=>{
    while(cursor<names.length){const name=names[cursor++];files[name]=stamped?await stampedHash(root,name,stamped):digest(await readFile(path.join(root,name)));}
  }));
  if(stamped)for(const name of stamped.keys())if(!(name in files))stamped.delete(name);
  return Object.fromEntries(names.map(name=>[name,files[name]]));
}
// The stat comes before the read, so a save that lands between them moves the stamp again and the
// next poll reads the file once more.
async function stampedHash(root:string,name:string,stamped:Stamped):Promise<string>{
  const info=await stat(path.join(root,name),{bigint:true}),stamp=info.size+':'+info.mtimeNs,known=stamped.get(name);
  if(known?.stamp===stamp)return known.hash;
  const hash=digest(await readFile(path.join(root,name)));
  stamped.set(name,{stamp,hash});
  return hash;
}
const fingerprint=(files:Record<string,string>)=>digest(JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))));
export async function sourceFingerprint(root:string):Promise<string>{return fingerprint(await inventory(root));}
/** The watcher's poll: the same fingerprint as sourceFingerprint, reading again only the files whose
 * stat stamp moved since the last poll. Reading and hashing every source file each builderPollMs
 * cost 1.4 to 7.8 s of wall time and about a third of a core on an idle console (fork f4d8d711,
 * 738b52d2, 7847cddb); a stat per file keeps the poll, which network-mounted checkouts need. */
export function sourcePoll(root:string):()=>Promise<string>{
  const stamped:Stamped=new Map();
  return async()=>fingerprint(await inventory(root,false,stamped));
}
function isolatedEnvironment(extra:NodeJS.ProcessEnv={}):NodeJS.ProcessEnv{
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('AL_')&&!key.startsWith('E2E_')&&!/(TOKEN|PASSWORD|SECRET|SESSION|CREDENTIAL)/i.test(key)));
  return {...env,...extra};
}
async function command(cwd:string,args:string[],env:NodeJS.ProcessEnv={},signal?:AbortSignal):Promise<void>{
  signal?.throwIfAborted();
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,args,{cwd,env:isolatedEnvironment(env),stdio:['ignore','pipe','pipe'],windowsHide:true,signal,detached:process.platform!=='win32'});
    const abort=()=>{
      const pid=child.pid;
      if(pid)void stopTree(pid).catch(error=>console.error(`Could not stop candidate command pid ${pid}:`,error));
    };
    signal?.addEventListener('abort',abort,{once:true});
    let tail='';
    for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{tail=(tail+String(data)).slice(-12_000);});
    child.once('error',reject);
    child.once('exit',code=>{signal?.removeEventListener('abort',abort);if(code===0)resolve();else reject(new Error(`Candidate command failed (${args.join(' ')}): ${tail}`));});
  });
}
async function npmCli():Promise<string>{
  const candidates=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')];
  for(const file of candidates)if(file&&await stat(file).catch(()=>undefined))return file;
  throw new Error('Cannot locate npm CLI for isolated dependency installation');
}
/** The build's dependency cache lock, which lifecycle-rules.test.cjs drives with a live owner. */
export async function dependencyLocked<T>(store:ConsoleBuildStore,id:string,action:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  const parent=path.join(path.dirname(store.dependencies),'dependency-locks');await mkdir(parent,{recursive:true});
  const lock=path.join(parent,id),token=randomUUID();
  // The lock is held while its owner's process lives: the wait ends when the owner releases it, or
  // takes the lock over when owner.json names a process that is gone.
  for(;;){
    signal?.throwIfAborted();
    try{await mkdir(lock);break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    const owner=await readFile(path.join(lock,'owner.json'),'utf8').then(value=>JSON.parse(value) as {pid:number}).catch(()=>undefined);
    if(owner){try{process.kill(owner.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH'){await rename(lock,lock+'.abandoned-'+token).catch(()=>{});continue;}}}
    await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
  await writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,token}));
  try{return await action();}finally{
    // Fixed validated hash path under this store; never follow a cache symlink.
    const owner=JSON.parse(await readFile(path.join(lock,'owner.json'),'utf8'));
    if(owner.token===token)await rm(lock,{recursive:true});
  }
}
type LockEntry={version?:string;resolved?:string;integrity?:string;link?:boolean;optional?:boolean};
// npm's hidden lock (node_modules/.package-lock.json) drops lock-only flags such as `peer` and
// leaves out optional packages for other platforms, so an installed tree matches its lock when each
// installed package has the lock's identity (version, resolved, integrity, link) and each absent
// one is optional (fork 0bea0e19, 4ddff3c9).
const installedIdentity=(entry:LockEntry)=>JSON.stringify([entry.version,entry.resolved,entry.integrity,entry.link]);
export function installedMatchesLock(expected:{packages?:Record<string,LockEntry>},actual?:{packages?:Record<string,LockEntry>}):boolean{
  if(!actual)return false;
  return Object.entries(expected.packages||{}).every(([key,value])=>{
    const installed=actual.packages?.[key];
    return !key||(installed?installedIdentity(installed)===installedIdentity(value):value.optional===true);
  });
}
async function dependencyCache(root:string,app:string,store:ConsoleBuildStore,signal?:AbortSignal):Promise<string>{
  const names={root:'',dashboard:'dashboard',caracal:'.caracal'};
  const locks:Record<string,string>={};
  for(const [name,relative] of Object.entries(names))locks[name]=digest(await readFile(path.join(app,relative,'package-lock.json')));
  // npm creates .bin symlinks on Unix, which immutable cache verification rejects.
  // Tools are invoked by module path; version the install mode to bypass old caches.
  const id=digest(JSON.stringify({locks,platform:process.platform,arch:process.arch,abi:process.versions.modules,binLinks:false}));
  await store.pinDependencies([id]);
  await dependencyLocked(store,id,async()=>{
    const cache=path.join(store.dependencies,id);
    const complete=await readFile(path.join(cache,'complete.json'),'utf8').catch(()=>undefined);
    if(complete&&JSON.parse(complete).id===id)return;
    const stage=path.join(path.dirname(store.dependencies),'dependency-stage-'+randomUUID());
    try{
    for(const [name,relative] of Object.entries(names)){
      signal?.throwIfAborted();
      const destination=path.join(stage,name);await mkdir(destination,{recursive:true});
      for(const file of ['package.json','package-lock.json'])await cp(path.join(app,relative,file),path.join(destination,file));
      // Cache installation is isolated from both the checkout and candidate.
      // Copy an installed tree only when its npm lock records the same packages.
      const existing=path.join(root,relative,'node_modules');
      const hidden=await readFile(path.join(existing,'.package-lock.json'),'utf8').catch(()=>undefined);
      const expected=JSON.parse(await readFile(path.join(destination,'package-lock.json'),'utf8'));
      const actual=hidden?JSON.parse(hidden):undefined;
      if(installedMatchesLock(expected,actual))await cp(existing,path.join(destination,'node_modules'),{recursive:true,dereference:true});
      // The production image sets NODE_ENV=production (Dockerfile), which leaves out dev
      // dependencies; a candidate builds with them, TypeScript among them.
      else await command(destination,[await npmCli(),'ci','--include=dev','--no-audit','--no-fund','--no-bin-links'],{},signal);
    }
    const files=await inventory(stage,true);
    await writeFile(path.join(stage,'complete.json'),JSON.stringify({id,files,manifestHash:digest(JSON.stringify({id,files}))}));
    await mkdir(path.dirname(cache),{recursive:true});await rename(stage,cache);
    }finally{await removeOwnedStage(path.dirname(store.dependencies),stage);}
  },signal);
  for(const [name,relative] of Object.entries(names))await symlink(path.join(store.dependencies,id,name,'node_modules'),path.join(app,relative,'node_modules'),process.platform==='win32'?'junction':'dir');
  return id;
}
async function freePort():Promise<number>{
  return new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address||typeof address==='string'){server.close();reject(new Error('No validation port'));return;}server.close(error=>error?reject(error):resolve(address.port));});});
}
async function validateDashboard(app:string,signal?:AbortSignal):Promise<void>{
  signal?.throwIfAborted();
  const port=await freePort();
  const child=spawn(process.execPath,['tools/dashboard/node-server.mts',String(port),path.join(app,'dashboard/.build/container')],{cwd:app,env:isolatedEnvironment(),stdio:'ignore',windowsHide:true,signal});
  try{await waitForHealthy(child,`http://127.0.0.1:${port}/`,'Candidate dashboard',DASHBOARD_READY,{signal});}
  finally{if(child.exitCode===null){const stopped=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill();await stopped;}}
}
function componentHashes(files:Record<string,string>,dependencyId:string):CandidateManifest['components']{
  const select=(predicate:(name:string)=>boolean)=>digest(dependencyId+fingerprint(Object.fromEntries(Object.entries(files).filter(([name])=>predicate(name)))));
  return {
    dashboard:select(name=>name.startsWith('dashboard/.build/container/')||name.startsWith('tools/dashboard/')),
    characters:select(name=>name.startsWith('characters/')&&!name.endsWith('build-history.json')||name.startsWith('runtime/lifecycle/roster/')||name.startsWith('.build/shared/')),
    coordinator:select(name=>name.startsWith('.build/runtime/')&&!['steam-bridge.js','universal-loader.js','party-member.js','profiles.js'].includes(path.basename(name))||name.startsWith('scripts/')||name==='runtime/lifecycle/coordinator/client-files.cjs'||name.startsWith('.caracal/')||name.startsWith('tools/caracal/')||name.startsWith('.build/shared/')),
  };
}
/** Compile only within a private source snapshot; publish after actual readiness. */
export async function buildCandidate(root:string,store:ConsoleBuildStore,signal?:AbortSignal):Promise<Candidate>{
  signal?.throwIfAborted();
  const before=await inventory(root),sourceHash=fingerprint(before);
  const stage=path.join(store.directory,'staging',randomUUID()),app=path.join(stage,'app');
  try{
  await mkdir(app,{recursive:true});
  for(const name of Object.keys(before)){signal?.throwIfAborted();const destination=path.join(app,name);await mkdir(path.dirname(destination),{recursive:true});await cp(path.join(root,name),destination);}
  if(fingerprint(await inventory(root))!==sourceHash||fingerprint(await inventory(app))!==sourceHash)throw new Error('Source changed while preparing candidate; newest snapshot will be retried');
  try{
  const dependencyId=await dependencyCache(root,app,store,signal);
  const tsc='node_modules/typescript/bin/tsc';
  // tsc reads the generated add-on imports, so the copy gets them first;
  // the build tools below write the same modules again.
  writeInstalled(app);
  for(const config of ['dashboard/tsconfig.json','tools/tsconfig.json','runtime/tsconfig.json'])await command(app,[tsc,'-p',config,'--noEmit','--incremental','false'],{},signal);
  await command(app,['--input-type=module','-e',"await import('./tools/console-build/hosting.ts')"],{},signal);
  for(const script of ['tools/build-shared.mts','tools/build-runtime.mts','tools/game/build.mts'])await command(app,[script,'--publish'],{},signal);
  await command(app,['tools/caracal/install.mts',path.join(app,'.caracal')],{},signal);
  await command(app,['tools/dashboard/build.mts'],{AL_DASHBOARD_OUT_DIR:'.build/container'},signal);
  await validateDashboard(app,signal);
  signal?.throwIfAborted();
  const files=await inventory(app,true),components=componentHashes(files,dependencyId);
  const id=digest(JSON.stringify({sourceHash,dependencyId,files,components}));
  return await store.complete(stage,{schema:1,id,sourceHash,dependencyId,createdAt:new Date().toISOString(),components,files});
  }
  finally{await store.pinDependencies([]);}
  }finally{await removeOwnedStage(path.join(store.directory,'staging'),stage);}
}
