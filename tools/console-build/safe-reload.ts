import path from 'node:path';
import {rm} from 'node:fs/promises';
import {atomicJson,readJson} from '../build-store.ts';
import type {DeploymentMode} from './contracts.ts';
import {LEASE_FILE,newLease,parseLease,type MaintenanceLease} from '../../runtime/lifecycle/rules.ts';
import {lifecycleSavedFields} from '../../runtime/lifecycle/fields.ts';
const fields=lifecycleSavedFields.settings;
// The deploy lease's one shape and file are lifecycle's; this host is its writer.
export function safeReload(directory:string,observe:(signal:AbortSignal)=>Promise<{id?:string|null;ready?:boolean;waiting?:string[]}>,options:{leaseMs?:number;clearMs?:number;pollMs?:number;timers?:Pick<typeof globalThis,'setTimeout'|'clearTimeout'|'setInterval'|'clearInterval'>}={}){
  const {setTimeout,clearTimeout,setInterval,clearInterval}=options.timers??globalThis;
  const file=path.join(directory,LEASE_FILE),leaseMs=options.leaseMs??fields.leaseLifeMs.default,clearMs=options.clearMs??fields.leaseClearMs.default,pollMs=options.pollMs??fields.leasePollMs.default;
  let active:MaintenanceLease|undefined,timer:ReturnType<typeof setInterval>|undefined,writeTail=Promise.resolve(),failure:unknown;
  let waiting:string[]=[];
  function renew(){
    const lease=active;if(!lease)return writeTail;
    writeTail=writeTail.then(async()=>{if(active?.id===lease.id){active.expires=Date.now()+leaseMs;await atomicJson(file,{...active});}});
    return writeTail;
  }
  async function begin(id:string,loadMode:DeploymentMode='safe'){
    if(active?.id===id)return;
    const existing=parseLease(await readJson(file),Date.now());
    if(existing&&existing.id!==id)throw Error('Another console maintenance operation is already in progress');
    active=newLease(id,loadMode,Date.now()+leaseMs);failure=undefined;
    await renew();clearInterval(timer);
    timer=setInterval(()=>{void renew().catch(error=>{failure=error;});},Math.max(50,Math.floor(leaseMs/3)));timer.unref();
  }
  async function phase(value:MaintenanceLease['phase']){if(active){active.phase=value;await renew();}}
  async function clear(id:string,signal:AbortSignal,window:number){
    let safeSince=0;
    while(true){
      signal.throwIfAborted();if(failure)throw failure;
      // An observe that throws ends the wait: the update's pause (tools/update/transaction.ts) ends
      // when the coordinator stops answering. The host's observe answers not-ready instead, since its
      // wait outlives a coordinator restart.
      const status=await observe(signal);
      waiting='waiting' in status&&Array.isArray(status.waiting)?status.waiting:[];
      if(status.id===id&&status.ready){safeSince||=Date.now();if(Date.now()-safeSince>=window)return;}else safeSince=0;
      await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(wait);reject(signal.reason);};const wait=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},pollMs);signal.addEventListener('abort',abort,{once:true});});
    }
  }
  return {begin,phase,get lease(){return active;},get waiting(){return waiting;},
    async waitUntilSafe(id:string,signal:AbortSignal,mode:DeploymentMode='safe'){
      await begin(id,mode);await phase(mode==='main'?'moving-main':'draining');await clear(id,signal,clearMs);
      await phase('holding');if(mode==='main')await clear(id,signal,clearMs);
    },
    async releaseSafeWait(id:string){
      if(active?.id===id){clearInterval(timer);timer=undefined;active=undefined;await writeTail.catch(()=>{});}
      const lease=await readJson<{id:string}>(file);if(lease?.id===id)await rm(file,{force:true});
    },
  };
}
