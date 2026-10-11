import {cp,lstat,mkdir,readFile,realpath,rename,symlink,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Services} from '../hosting/services.ts';
import {ConsoleBuildStore} from './store.ts';
import {ConsoleBuildController} from './controller.ts';
import {createDeploymentDriver,type ActivationPorts} from './driver.ts';
import {ImmutableDashboard} from './dashboard.ts';
import {consoleBuildRoutes} from './routes.ts';
import {startConsoleBuilder} from './watch.ts';
import {buildCandidate} from './builder.ts';
import {verifyManifest,type GameManifest,type CharacterClass} from '../game/manifest.ts';
import {atomicJson,readJson} from '../build-store.ts';
import {safeReload} from './safe-reload.ts';

interface ManagedOptions{dashboardPort:number;apiPort:number;coordinatorEnv?:NodeJS.ProcessEnv;coordinatorOnly?:boolean}
interface CharacterReport{seenAt?:number;connected?:boolean;rip?:boolean;type?:string;ctype?:string;codeHash?:string;name?:string}
interface PublicState{characters?:Record<string,CharacterReport>}
const fresh=(report:CharacterReport)=>report.connected!==false&&Number.isFinite(report.seenAt)&&Date.now()-Number(report.seenAt)<=5000&&Number(report.seenAt)<=Date.now()+1000;
async function installHooks(app:string,root:string,signal:AbortSignal):Promise<void>{
  signal.throwIfAborted();
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(app,'tools/caracal/install.mts'),path.join(root,'.caracal'),'--stage-dir',path.join(root,'.build/console/install-staging'),'--artifact-native',path.join(app,'.caracal')],{cwd:app,env:process.env,stdio:'inherit',windowsHide:true,signal});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Managed native hook installation failed')));
  });
}
async function json<T>(port:number,route:string,signal:AbortSignal):Promise<T>{
  const response=await fetch(`http://127.0.0.1:${port}${route}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(3000)]),cache:'no-store'});
  if(!response.ok)throw new Error(`Coordinator readiness HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
async function atomicCopy(source:string,target:string):Promise<void>{
  await mkdir(path.dirname(target),{recursive:true});const temporary=target+'.'+randomUUID()+'.tmp';
  await cp(source,temporary);await rename(temporary,target);
}
async function codeDirectory(root:string):Promise<string>{
  const deployed=path.join(root,'.build/console/code');await mkdir(deployed,{recursive:true});
  const alias=path.join(root,'.caracal/CODE/adventure_land');
  const current=await lstat(alias).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
  if(current){
    if(await realpath(alias)===await realpath(deployed))return deployed;
    if(!await lstat(path.join(deployed,'manifest.json')).catch(()=>undefined))await cp(alias,deployed,{recursive:true,dereference:true});
    if(current.isSymbolicLink())await unlink(alias);
    else await rename(alias,alias+'.pre-managed-'+randomUUID());
  }
  await mkdir(path.dirname(alias),{recursive:true});await symlink(deployed,alias,process.platform==='win32'?'junction':'dir');
  return deployed;
}
async function publishCode(app:string,deployed:string,signal:AbortSignal):Promise<GameManifest>{
  const directory=path.join(app,'characters');
  const manifest=await verifyManifest(directory,JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8')));
  for(const entry of Object.values(manifest.classes)){signal.throwIfAborted();await atomicCopy(path.join(directory,entry.file),path.join(deployed,entry.file));}
  for(const name of ['shared.js','party-member.js','roles.js','profiles.js','steam-bridge.js','universal-loader.js','farming-zones.js','farming-zones.cjs']){
    signal.throwIfAborted();const source=path.join(directory,name);if(await lstat(source).catch(()=>undefined))await atomicCopy(source,path.join(deployed,name));
  }
  signal.throwIfAborted();await atomicCopy(path.join(directory,'manifest.json'),path.join(deployed,'manifest.json'));
  return manifest;
}
/** Host gateway owns authorization; this module owns immutable code activation. */
export async function createManagedConsole(root:string,services:Services,options:ManagedOptions){
  const store=new ConsoleBuildStore(root),dashboard=new ImmutableDashboard();
  const deployed=await codeDirectory(root);
  let coordinatorEnv:NodeJS.ProcessEnv|undefined;
  let coordinatorCandidate:string|undefined;
  let captured:PublicState|undefined;
  let acknowledgeAfter=0;
  const verified=new Map<string,import('./contracts.ts').Candidate>();
  const resolve=async(directory:string)=>{
    const id=path.basename(path.dirname(directory));let candidate=verified.get(id);if(!candidate){candidate=await store.verify(id);verified.set(id,candidate);}return candidate;
  };
  const ports:ActivationPorts={
    async prepare(signal){
      const state=coordinatorEnv?await json<PublicState>(options.apiPort,'/party-api/state?catalog=0',signal):{};
      captured={characters:Object.fromEntries(Object.entries(state.characters||{}).filter(([,report])=>fresh(report)))};
      await atomicJson(path.join(store.directory,'activation-roster.json'),captured);
    },
    async stopCoordinator(signal){if(coordinatorEnv){
      captured ||= await readJson<PublicState>(path.join(store.directory,'activation-roster.json'));
      await services.stopService('console-coordinator',signal);
    }},
    async startCoordinator(directory,signal){
      const candidate=await resolve(directory);signal.throwIfAborted();
      if(!coordinatorEnv)throw new Error('Configure the account before activating coordinator changes');
      await installHooks(directory,root,signal);
      await publishCode(directory,deployed,signal);
      await services.replace('console-coordinator',path.join(root,'.caracal/main.js'),path.join(root,'.caracal'),{
        ...coordinatorEnv,AL_CONSOLE_ARTIFACT:directory,AL_CONSOLE_ARTIFACT_ID:candidate.manifest.id,
        AL_CONSOLE_COORDINATOR_HASH:candidate.manifest.components.coordinator,
        AL_CONSOLE_NATIVE_DIR:path.join(root,'.caracal'),
        NODE_OPTIONS:[coordinatorEnv.NODE_OPTIONS,`--require=${JSON.stringify(path.join(directory,'tools/caracal/pinned-native.cjs').replaceAll('\\','/'))}`].filter(Boolean).join(' '),
      },[],signal);
      coordinatorCandidate=candidate.manifest.id;
      await store.pin([...dashboard.pinnedBuilds,coordinatorCandidate]);
    },
    async activateDashboard(directory,signal){await dashboard.activate(await resolve(directory),signal);await store.pin([...dashboard.pinnedBuilds,...(coordinatorCandidate?[coordinatorCandidate]:[])]);},
    async reloadCharacters(directory,signal){
      const frozen=!!captured;
      const state=captured||(coordinatorEnv?await json<PublicState>(options.apiPort,'/party-api/state?catalog=0',signal):{});
      acknowledgeAfter=Date.now();
      const manifest=await publishCode(directory,deployed,signal),expected:Record<string,string>={};
      for(const [name,report] of Object.entries(state.characters||{})){
        const entry=manifest.classes[(report.ctype||report.type) as CharacterClass];
        if(!frozen&&!fresh(report))continue;
        if(!entry)throw new Error('Cannot identify connected character class: '+name);
        expected[name]=entry.sha256;
      }
      return expected;
    },
    async observe(signal){
      const coordinator=await json<{artifactId:string;hash:string}>(options.apiPort,'/party-api/build-identity',signal).catch(()=>undefined);
      const state=await json<PublicState>(options.apiPort,'/party-api/state?catalog=0',signal).catch(()=>({} as PublicState));
      const characters:Record<string,string>={};
      for(const [name,report] of Object.entries(state.characters||{}))if(report.codeHash&&fresh(report)&&Number(report.seenAt)>=acknowledgeAfter)characters[name]=report.codeHash;
      return {coordinator,dashboardHash:dashboard.currentHash,characters};
    },
  };
  const drain=()=>safeReload(path.resolve(coordinatorEnv?.AL_DATA_DIR || process.env.AL_DATA_DIR || path.join(root,'.build/hosting-data')),
    signal=>json<{id?:string|null;ready?:boolean}>(options.apiPort,'/party-api/console-maintenance',signal));
  const driver={...createDeploymentDriver(ports),
    waitUntilSafe:(id:string,signal:AbortSignal)=>drain().waitUntilSafe(id,signal),
    releaseSafeWait:(id:string)=>drain().releaseSafeWait(id)};
  const controller=new ConsoleBuildController(store,driver);
  const refs=await store.references();
  let active=refs.active?await store.verify(refs.active):undefined;
  if(!active)active=await buildCandidate(root,store);
  const bootstrap=active;
  await dashboard.listen(options.dashboardPort);
  try{await dashboard.activate(bootstrap,AbortSignal.timeout(120_000));}catch(error){await dashboard.stop();throw error;}
  if(!options.coordinatorOnly||!await lstat(path.join(deployed,'manifest.json')).catch(()=>undefined))await publishCode(bootstrap.directory,deployed,AbortSignal.timeout(120_000));
  await store.pin(dashboard.pinnedBuilds);
  // Account setup can happen later. Keep its already selected dashboard/CODE
  // pinned across an ordinary restart rather than choosing edited source again.
  if (!refs.active) await store.setReferences({...await store.references(), active: bootstrap.manifest.id});
  const watcher=startConsoleBuilder(root,controller);
  const routes=consoleBuildRoutes(controller);
  return {
    controller,routes:{async route(req:import('node:http').IncomingMessage,res:import('node:http').ServerResponse,pathname:string){
      if(req.method==='POST'&&!coordinatorEnv){res.writeHead(409,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Configure and start the account before deploying a console build'}));return;}
      await routes.route(req,res,pathname);
    }},
    async startGame(env:NodeJS.ProcessEnv){
      coordinatorEnv={...process.env,...options.coordinatorEnv,...env};
      coordinatorEnv.AL_DATA_DIR=path.resolve(coordinatorEnv.AL_DATA_DIR || path.join(root,'.build/hosting-data'));
      await controller.recover();
      const operation=await store.journal();if(operation&&['activating','rolling-back'].includes(operation.phase))throw new Error('Console deployment recovery remains incomplete');
      const refs=await store.references(),candidate=refs.active?await store.verify(refs.active):bootstrap;
      const signal=AbortSignal.timeout(120_000);
      await ports.startCoordinator(candidate.directory,signal);
      while(true){
        signal.throwIfAborted();const observed=await ports.observe(signal);
        if(observed.coordinator?.artifactId===candidate.manifest.id&&observed.coordinator.hash===candidate.manifest.components.coordinator)break;
        await new Promise(resolve=>setTimeout(resolve,200));
      }
      await store.setReferences({...await store.references(),active:candidate.manifest.id});
    },
    async stop(){controller.stopWaiting();await watcher.dispose();await services.stopService('console-coordinator');await dashboard.stop();await store.pin([]);},
  };
}
