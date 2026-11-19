import {cp,lstat,mkdir,readFile,realpath,rename,symlink,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
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
import {deployRefusal,type LoadMode} from '../../runtime/lifecycle/rules.ts';
import {readPause} from '../../runtime/lifecycle/coordinator/control.ts';
import {lifecycleSavedFields} from '../../runtime/lifecycle/fields.ts';
import {fresh as freshAt} from '../../runtime/protocol/reports.ts';
import {bounded,type HostBound} from '../hosting/http.ts';
// The managed host's bounds against a coordinator or dashboard that does not answer: one coordinator
// read, the first dashboard activation and CODE publication at start, and the status page's Cave check.
// releaseWaitMs and activationMs are the lifecycle owner's saved fields; each bound logs through `bounded` when it ends a wait.
const COORDINATOR_READ:HostBound={name:'coordinatorReadMs',ms:3000};
const FIRST_ACTIVATION:HostBound={name:'firstActivationMs',ms:120_000};
const CAVE_CHECK:HostBound={name:'caveCheckMs',ms:1500};
const RELEASE_WAIT:HostBound={name:'releaseWaitMs',ms:lifecycleSavedFields.settings.releaseWaitMs.default};
const ACTIVATION:HostBound={name:'activationMs',ms:lifecycleSavedFields.settings.activationMs.default};

// startupCandidateId is the candidate bootstrap.ts selected and imported this host from (store.startupCandidate).
interface ManagedOptions{dashboardPort:number;apiPort:number;coordinatorEnv?:NodeJS.ProcessEnv;coordinatorOnly?:boolean;startupCandidateId?:string}
interface CharacterReport{seenAt?:number;connected?:boolean;fresh?:boolean;rip?:boolean;type?:string;ctype?:string;codeHash?:string;name?:string;map?:string;consoleMaintenance?:{id?:string;ready?:boolean}|null}
interface PublicState{characters?:Record<string,CharacterReport>}
// The coordinator answers each report's freshness with its one rule. A
// coordinator built before that field (b9b5c91e, or a rollback candidate) serves none, and the host
// then applies the same rule, runtime/protocol/reports.ts `fresh`, to the report's seenAt.
const fresh=(report:CharacterReport)=>report.fresh??(report.connected!==false&&freshAt(report.seenAt,Date.now()));
async function installHooks(app:string,root:string,signal:AbortSignal):Promise<void>{
  signal.throwIfAborted();
  const prepared=await readJson<{schema:number}>(path.join(app,'.caracal/prepared-runtime.json'));
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(app,'tools/caracal/install.mts'),path.join(root,'.caracal'),'--stage-dir',path.join(root,'.build/console/install-staging'),'--artifact-native',path.join(app,'.caracal'),...(prepared?.schema===1?['--prepared-native']:[])],{cwd:app,env:process.env,stdio:'inherit',windowsHide:true,signal});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('Managed native hook installation failed')));
  });
}
async function json<T>(port:number,route:string,signal:AbortSignal):Promise<T>{
  const response=await bounded(COORDINATOR_READ,'a coordinator read of '+route,read=>fetch(`http://127.0.0.1:${port}${route}`,{signal:AbortSignal.any([signal,read]),cache:'no-store'}));
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
async function publishCode(app:string,deployed:string,signal:AbortSignal,activation?:{id:string;maintenance?:unknown}):Promise<GameManifest>{
  const directory=path.join(app,'characters');
  const manifest=await verifyManifest(directory,JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8')));
  const prior=await readJson<{id:string;manifest:GameManifest}>(path.join(deployed,'activation.json'));
  if(activation&&prior?.id===activation.id&&prior.manifest.generation===manifest.generation)return manifest;
  for(const entry of Object.values(manifest.classes)){signal.throwIfAborted();await atomicCopy(path.join(directory,entry.file),path.join(deployed,entry.file));}
  for(const name of ['shared.js','party-member.js','profiles.js','steam-bridge.js','universal-loader.js','farming-zones.js']){
    signal.throwIfAborted();const source=path.join(directory,name);if(await lstat(source).catch(()=>undefined))await atomicCopy(source,path.join(deployed,name));
  }
  signal.throwIfAborted();await atomicCopy(path.join(directory,'manifest.json'),path.join(deployed,'manifest.json'));
  // Only explicit host publication authorizes running characters to adopt CODE.
  signal.throwIfAborted();await atomicJson(path.join(deployed,'activation.json'),{id:activation?.id||randomUUID(),manifest,maintenance:activation?.maintenance||null,serverNow:Date.now()});
  return manifest;
}
async function activationId(deployed:string):Promise<string|null>{
  const record=await readJson<{id?:string}>(path.join(deployed,'activation.json')).catch(()=>undefined);
  return record?.id||null;
}
/** Host gateway owns authorization; this module owns immutable code activation. */
export async function createManagedConsole(root:string,services:Services,options:ManagedOptions){
  const store=new ConsoleBuildStore(root),dashboard=new ImmutableDashboard();
  const deployed=await codeDirectory(root);
  let coordinatorEnv:NodeJS.ProcessEnv|undefined;
  let coordinatorCandidate:string|undefined;
  let captured:PublicState|undefined;
  let acknowledgeAfter=0;
  const dataDirectory=path.resolve(options.coordinatorEnv?.AL_DATA_DIR||process.env.AL_DATA_DIR||path.join(root,'.build/hosting-data'));
  const maintenance=safeReload(dataDirectory,
    signal=>json<{id?:string|null;ready?:boolean}>(options.apiPort,'/party-api/console-maintenance',signal).catch(()=>({id:null,ready:false})));
  // The characters a load counts are the participants, which the coordinator answers; the
  // host keeps no list of its own while the coordinator answers. With it down, the captured roster
  // stands in.
  async function participants(signal:AbortSignal):Promise<string[]|undefined>{
    return (await json<{participants?:string[]}>(options.apiPort,'/party-api/console-maintenance',signal).catch(()=>undefined))?.participants;
  }
  async function runtimeState(signal:AbortSignal):Promise<PublicState>{
    const state=await json<PublicState>(options.apiPort,'/party-api/console-runtime',signal).catch(()=>json<PublicState>(options.apiPort,'/party-api/state?catalog=0',signal));
    return {characters:Object.fromEntries(Object.entries(state.characters||{}).map(([name,r])=>[name,{name,seenAt:r.seenAt,connected:r.connected,fresh:r.fresh,rip:r.rip,type:r.type,ctype:r.ctype,codeHash:r.codeHash,map:r.map,consoleMaintenance:r.consoleMaintenance}]))};
  }
  // The coordinator answers whether a deploy of this mode may
  // start. With the coordinator down the host applies the same rule to the saved roster's maps.
  async function admission(mode:LoadMode,signal:AbortSignal):Promise<string|null>{
    if(!coordinatorEnv)return null;
    return json<{refusal:string|null}>(options.apiPort,`/party-api/console-maintenance/admit?mode=${mode}`,signal).then(answer=>answer.refusal)
      .catch(async()=>deployRefusal(mode,Object.entries((await readJson<PublicState>(path.join(store.directory,'activation-roster.json')))?.characters||{}).map(([name,report])=>({name,task:null,map:report.map}))));
  }
  const verified=new Map<string,import('./contracts.ts').Candidate>();
  const hostLoader=fileURLToPath(new URL('../../characters/universal-loader.js',import.meta.url));
  const resolve=async(directory:string)=>{
    const id=path.basename(path.dirname(directory));let candidate=verified.get(id);if(!candidate){candidate=await store.verify(id);verified.set(id,candidate);}return candidate;
  };
  const ports:ActivationPorts={
    async stage(candidate,previous,signal){
      verified.set(candidate.manifest.id,candidate);if(previous)verified.set(previous.manifest.id,previous);
      await dashboard.prepare(candidate,signal);
      const stage=path.join(store.directory,'code-staging',candidate.manifest.id,'characters');await mkdir(stage,{recursive:true});
      await cp(path.join(candidate.directory,'characters'),stage,{recursive:true});
      signal.throwIfAborted();
    },
    async prepare(signal){
      const state=coordinatorEnv?await runtimeState(signal):{};
      captured||={characters:Object.fromEntries(Object.entries(state.characters||{}).filter(([,report])=>fresh(report)))};
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
      acknowledgeAfter=Date.now();
      const staged=path.join(store.directory,'code-staging',candidate.manifest.id);
      await publishCode(await lstat(path.join(staged,'characters/manifest.json')).catch(()=>undefined)?staged:directory,deployed,signal,
        maintenance.lease?{id:maintenance.lease.id,maintenance:maintenance.lease}:undefined);
      // The host's maintenance bootstrap must survive rollback to older gameplay.
      if(await lstat(hostLoader).catch(()=>undefined))await atomicCopy(hostLoader,path.join(deployed,'universal-loader.js'));
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
      const counted=maintenance.lease&&coordinatorEnv?await participants(signal):undefined;
      const frozen=!counted&&!!captured;
      const state=frozen?captured!:(coordinatorEnv?await runtimeState(signal):{});
      acknowledgeAfter=Date.now();
      const manifest=await publishCode(directory,deployed,signal,maintenance.lease?{id:maintenance.lease.id,maintenance:maintenance.lease}:undefined),expected:Record<string,string>={};
      for(const [name,report] of Object.entries(state.characters||{})){
        const entry=manifest.classes[(report.ctype||report.type) as CharacterClass];
        if(counted?!counted.includes(name):!frozen&&!fresh(report))continue;
        if(!entry)throw new Error('Cannot identify connected character class: '+name);
        expected[name]=entry.sha256;
      }
      return expected;
    },
    async observe(signal){
      const coordinator=await json<{artifactId:string;hash:string}>(options.apiPort,'/party-api/build-identity',signal).catch(()=>undefined);
      const state=await runtimeState(signal).catch(()=>({} as PublicState));
      const characters:Record<string,string>={};
      for(const [name,report] of Object.entries(state.characters||{}))if(report.codeHash&&fresh(report)&&Number(report.seenAt)>=acknowledgeAfter&&
        (!maintenance.lease||report.consoleMaintenance?.id===maintenance.lease.id&&(maintenance.lease.loadMode==='now'||report.consoleMaintenance.ready===true)))characters[name]=report.codeHash;
      return {coordinator,dashboardHash:dashboard.currentHash,characters};
    },
  };
  const driver={...createDeploymentDriver(ports),
    async beginMaintenance(operation:import('./contracts.ts').DeploymentJournal,signal:AbortSignal){
      // The host asks admission before it writes the lease, so a refused deploy publishes none.
      captured=undefined;const refusal=await admission(operation.mode||'now',signal);if(refusal)throw Error(refusal);
      await maintenance.begin(operation.id,operation.mode||'now');
      const state=coordinatorEnv?await runtimeState(signal).catch(()=>readJson<PublicState>(path.join(store.directory,'activation-roster.json')).then(value=>value||{})):{};
      captured={characters:Object.fromEntries(Object.entries(state.characters||{}).filter(([,report])=>fresh(report)))};
      operation.participants=Object.keys(captured.characters||{});
      await atomicJson(path.join(store.directory,'activation-roster.json'),captured);
    },
    waitUntilSafe:(id:string,signal:AbortSignal,mode?:import('./contracts.ts').DeploymentMode)=>maintenance.waitUntilSafe(id,signal,mode),
    async releaseSafeWait(id:string){
      // The participants are read while the lease still stands; its release ends the set.
      const lease=await bounded(RELEASE_WAIT,'the participant read before a release',participants);
      await maintenance.releaseSafeWait(id);
      await dashboard.discardPrepared();
      // Releasing a preparation failure need not wait for replacement CODE.
      const journal=await store.journal();if(journal?.phase!=='resuming'&&journal?.phase!=='rolling-back')return;
      const releasedAt=Date.now(),counted=lease??Object.keys(captured?.characters||{});
      await bounded(RELEASE_WAIT,'the wait for released characters to report',async signal=>{
        while(true){signal.throwIfAborted();const state=await runtimeState(signal);
          if(counted.every(name=>fresh(state.characters?.[name]||{})&&Number(state.characters?.[name]?.seenAt)>=releasedAt&&state.characters?.[name]?.consoleMaintenance?.id!==id))return;
          await new Promise(resolve=>setTimeout(resolve,lifecycleSavedFields.settings.hostPollMs.default));}
      });
    }};
  const controller=new ConsoleBuildController(store,driver);
  const refs=await store.references();
  let active=refs.active?await store.verify(refs.active):undefined;
  if(!active)active=options.startupCandidateId?await store.verify(options.startupCandidateId):await buildCandidate(root,store);
  const bootstrap=active;
  await dashboard.listen(options.dashboardPort);
  try{await bounded(FIRST_ACTIVATION,'the first dashboard activation',signal=>dashboard.activate(bootstrap,signal));}catch(error){await dashboard.stop();throw error;}
  if(!options.coordinatorOnly||!await lstat(path.join(deployed,'manifest.json')).catch(()=>undefined))await bounded(FIRST_ACTIVATION,'the first CODE publication',signal=>publishCode(bootstrap.directory,deployed,signal));
  await store.pin(dashboard.pinnedBuilds);
  // Account setup can happen later. Keep its already selected dashboard/CODE
  // pinned across an ordinary restart rather than choosing edited source again.
  if (!refs.active) await store.setReferences({...await store.references(), active: bootstrap.manifest.id});
  const watcher=startConsoleBuilder(root,controller);
  const routes=consoleBuildRoutes(controller,{
    cave:async()=>await bounded(CAVE_CHECK,'the status page Cave check',signal=>admission('safe',signal)).catch(()=>null)!==null,
    waiting:()=>maintenance.waiting,
    refusal:()=>coordinatorEnv?undefined:'Configure and start the account before deploying a console build'});
  return {
    code:{async route(req:import('node:http').IncomingMessage,res:import('node:http').ServerResponse,pathname:string){
      if(pathname==='/party-api/console-deployment'){
        // activation tells loaders whether activation.json exists, so they stop polling it for a 404.
        const activation=await activationId(deployed);
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({serverNow:Date.now(),consoleMaintenance:maintenance.lease||null,consolePaused:!!readPause(dataDirectory),activation}));return true;
      }
      if(!pathname.startsWith('/CODE/adventure_land/'))return false;
      if(!['GET','HEAD'].includes(req.method||'')){res.writeHead(405);res.end();return true;}
      const name=decodeURIComponent(pathname.slice('/CODE/adventure_land/'.length));
      if(!/^(activation\.json|manifest\.json|shared\.js|party-member\.js|roles\.js|profiles\.js|steam-bridge\.js|universal-loader\.js|farming-zones\.(js|cjs)|generated\/[a-f0-9]{64}\/[a-z]+\.js)$/.test(name)){res.writeHead(404);res.end();return true;}
      const data=await readFile(path.join(deployed,name)).catch(()=>undefined);
      res.writeHead(data?200:404,{'Content-Type':name.endsWith('.json')?'application/json':'text/javascript','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);return true;
    }},
    controller,routes,
    async startGame(env:NodeJS.ProcessEnv){
      coordinatorEnv={...process.env,...options.coordinatorEnv,...env};
      coordinatorEnv.AL_DATA_DIR=path.resolve(coordinatorEnv.AL_DATA_DIR || path.join(root,'.build/hosting-data'));
      await controller.recover();
      const operation=await store.journal();if(operation&&!['complete','failed'].includes(operation.phase))throw new Error('Console deployment recovery remains incomplete');
      const refs=await store.references(),candidate=refs.active?await store.verify(refs.active):bootstrap;
      await bounded(ACTIVATION,'the start coordinator activation',async signal=>{
        await ports.startCoordinator(candidate.directory,signal);
        while(true){
          signal.throwIfAborted();const observed=await ports.observe(signal);
          if(observed.coordinator?.artifactId===candidate.manifest.id&&observed.coordinator.hash===candidate.manifest.components.coordinator)return;
          await new Promise(resolve=>setTimeout(resolve,lifecycleSavedFields.settings.hostPollMs.default));
        }
      });
      await store.setReferences({...await store.references(),active:candidate.manifest.id});
      // The launch deploys the candidate bootstrap.ts selected (controller.ts `launch`).
      await controller.launch(options.startupCandidateId);
    },
    async stop(){controller.stopWaiting();await watcher.dispose();await services.stopService('console-coordinator');await dashboard.stop();await store.pin([]);},
  };
}
