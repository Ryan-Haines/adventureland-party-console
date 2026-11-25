import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {atomicJson,readJson} from '../build-store.ts';
import {bounded,type HostBound} from '../hosting/http.ts';
// recover's hold on the coordinator before it restores: a coordinator that never answers ends it.
const RECOVER_MAINTENANCE:HostBound={name:'recoverMaintenanceMs',ms:10000};
import {deploymentPending,type Candidate,type ConsoleBuildStatus,type DeploymentDriver,type DeploymentJournal,type DeploymentMode} from './contracts.ts';
import {ConsoleBuildStore,newer} from './store.ts';
import {lifecycleSavedFields} from '../../runtime/lifecycle/fields.ts';

export class DeploymentConflict extends Error {
  readonly operation?:DeploymentJournal;
  constructor(message:string,operation?:DeploymentJournal){super(message);this.operation=operation;}
}
export class ConsoleBuildController {
  readonly store:ConsoleBuildStore;
  private operation?:DeploymentJournal;
  private admission?:Promise<DeploymentJournal>;
  private safeWait?:AbortController;
  private cleanup?:Promise<void>;
  // The deploy run in flight, which launch waits on.
  private running?:Promise<void>;
  private driver:DeploymentDriver;
  private timeoutMs:number;
  constructor(store:ConsoleBuildStore,driver:DeploymentDriver,timeoutMs=lifecycleSavedFields.settings.activationMs.default){this.store=store;this.driver=driver;this.timeoutMs=timeoutMs;}
  async setBuildState(value:{building:boolean;error?:string}){await atomicJson(path.join(this.store.directory,'builder.json'),value);}
  async status():Promise<ConsoleBuildStatus>{
    const [refs,builder,builds,operation]=await Promise.all([this.store.references(),readJson<{building:boolean;error?:string}>(path.join(this.store.directory,'builder.json')),this.store.summaries(),this.store.journal()]);
    const latest=builds.find(b=>b.id===refs.latest),active=builds.find(b=>b.id===refs.active);
    return {...refs,builds,operation,building:builder?.building||false,buildError:builder?.error,
      pendingBuildCount:await this.store.completedSince(refs.active,builds),available:latest&&latest.id!==refs.active&&newer(latest,active)?latest.id:undefined};
  }
  // A launch deploys the candidate bootstrap.ts read once
  // (store.startupCandidate), through the deploy path every load takes, and returns when that deploy
  // completes or fails. A build that completes after the read stays staged until you deploy it, and a
  // launch of the active build deploys nothing.
  async launch(id?:string):Promise<void>{
    if(!id||(await this.store.references()).active===id)return;
    const accepted=await this.deploy(id,'now');
    await this.running;
    const operation=await this.store.journal();
    if(operation?.id!==accepted.id)throw Error('Startup console deployment was replaced');
    if(operation.phase==='failed')throw Error('Startup console deployment failed: '+operation.error);
  }
  async deploy(id:string,mode:DeploymentMode='now'):Promise<DeploymentJournal>{
    if(mode!=='now'&&!this.driver.waitUntilSafe)throw Error('Safe reload is unavailable on this host');
    if(this.admission)await this.admission;
    if(this.operation&&deploymentPending(this.operation.phase))return this.duplicate(this.operation,id,mode);
    const admission=this.store.locked(async()=>{
      const pending=await this.store.journal();
      if(pending&&deploymentPending(pending.phase))return this.duplicate(pending,id,mode);
      await this.store.describe(id);
      const refs=await this.store.references(),at=new Date().toISOString();
      const operation:DeploymentJournal={id:randomUUID(),target:id,previous:refs.active,mode,startedAt:at,
        phase:refs.active===id?'complete':'preparing',phaseStartedAt:at,timings:{preparing:at}};
      await this.store.setJournal(operation);this.operation=operation;
      return {...operation};
    });
    this.admission=admission;
    let accepted:DeploymentJournal;
    try{accepted=await admission;}finally{if(this.admission===admission)this.admission=undefined;}
    if(accepted.phase==='preparing'&&this.operation?.id===accepted.id){
      this.running=this.run(this.operation).catch(error=>console.error('Console deployment journal failure:',error));
    }
    return accepted;
  }
  private duplicate(operation:DeploymentJournal,id:string,mode:DeploymentMode){
    if(operation.target===id&&(operation.mode||'now')===mode)return {...operation};
    throw new DeploymentConflict('A console deployment is already in progress',operation);
  }
  private async phase(operation:DeploymentJournal,phase:DeploymentJournal['phase']){
    const at=new Date().toISOString();operation.phase=phase;operation.phaseStartedAt=at;operation.timings={...operation.timings,[phase]:at};
    await this.store.setJournal(operation);
  }
  private async timed(action:(signal:AbortSignal)=>Promise<void>,timeout=this.timeoutMs){
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{console.warn(`[bound] activationMs (${timeout} ms) ended a console deployment step`);controller.abort();reject(Error('Console deployment readiness timed out'));},timeout);});
    try{await Promise.race([action(controller.signal),expired]);}finally{clearTimeout(timer);controller.abort();}
  }
  private async run(operation:DeploymentJournal){
    let activated=false,previous:Candidate|undefined;
    const waiting=new AbortController();this.safeWait=waiting;
    try{
      const dependencies=new Set<string>();
      const target=await this.store.verify(operation.target,dependencies);
      previous=operation.previous?await this.store.verify(operation.previous,dependencies):undefined;
      operation.changed=(['dashboard','coordinator','characters'] as const).filter(c=>target.manifest.components[c]!==previous?.manifest.components[c]);
      await this.store.setJournal(operation);
      await this.driver.prepare?.(target,previous,operation,this.safeWait.signal);
      // Prepare the candidate without interrupting the selected running build.
      await this.driver.beginMaintenance?.(operation,this.safeWait.signal);
      await this.store.setJournal(operation);
      if(operation.mode==='safe'||operation.mode==='main'){
        await this.phase(operation,operation.mode==='main'?'moving-main':'waiting-safe');
        await this.driver.waitUntilSafe!(operation.id,this.safeWait.signal,operation.mode);
      }
      this.safeWait.signal.throwIfAborted();
      await this.phase(operation,'activating');activated=true;
      await this.timed(signal=>this.driver.activate(target,previous,signal));
      await this.phase(operation,'resuming');
      await this.store.locked(async()=>{await this.store.setReferences({...await this.store.references(),active:operation.target,previous:operation.previous});});
      await this.driver.releaseSafeWait?.(operation.id);
      await this.phase(operation,'complete');
    }catch(error){
      operation.error=error instanceof Error?error.message:String(error);
      if(activated){
        await this.phase(operation,'rolling-back');
        try{
          previous||=operation.previous?await this.store.verify(operation.previous):undefined;
          await this.timed(signal=>this.driver.restore(previous,signal));
          await this.store.locked(async()=>{await this.store.setReferences({...await this.store.references(),active:operation.previous});});
          await this.driver.releaseSafeWait?.(operation.id);
          await this.phase(operation,'failed');
        }catch(cause){operation.error+='; rollback failed: '+(cause instanceof Error?cause.message:String(cause));await this.store.setJournal(operation);}
      }else{await this.driver.releaseSafeWait?.(operation.id);await this.phase(operation,'failed');}
    }finally{
      if(this.safeWait===waiting)this.safeWait=undefined;
      if(!deploymentPending(operation.phase)){
        if(this.operation?.id===operation.id)this.operation=undefined;
        this.cleanup||=this.store.cleanup().catch(error=>console.error('Console candidate cleanup deferred:',error)).finally(()=>{this.cleanup=undefined;});
      }
    }
  }
  async recover(){
    const journal=await this.store.journal();if(!journal||!deploymentPending(journal.phase))return;
    if(this.operation)throw new DeploymentConflict('A console deployment is already in progress',this.operation);
    this.operation=journal;
    try{
      if(['preparing','waiting-safe','moving-main'].includes(journal.phase)){
        journal.error='The host stopped before activation; the running build was preserved.';
      }else{
        await bounded(RECOVER_MAINTENANCE,'the recovery maintenance hold',async signal=>{await this.driver.beginMaintenance?.({...journal,mode:'now'},signal);});
        await this.phase(journal,'rolling-back');
        const previous=journal.previous?await this.store.verify(journal.previous):undefined;
        await this.timed(signal=>this.driver.restore(previous,signal));
        await this.store.setReferences({...await this.store.references(),active:journal.previous});
      }
      await this.driver.releaseSafeWait?.(journal.id);await this.phase(journal,'failed');
    }finally{if(!deploymentPending(journal.phase))this.operation=undefined;}
  }
  stopWaiting(){this.safeWait?.abort(Error('The host stopped before safe reload; the running build was preserved.'));}
}
