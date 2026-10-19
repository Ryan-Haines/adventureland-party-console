import path from 'node:path';
import {rm} from 'node:fs/promises';
import {atomicJson,readJson} from '../build-store.ts';
import type {DeploymentMode} from './contracts.ts';
export interface MaintenanceLease {id:string;mode:'draining';loadMode:DeploymentMode;phase:'preparing'|'draining'|'moving-main'|'holding';expires:number}
export function safeReload(directory:string,observe:(signal:AbortSignal)=>Promise<{id?:string|null;ready?:boolean;waiting?:string[]}>,options:{leaseMs?:number;clearMs?:number;pollMs?:number;timers?:Pick<typeof globalThis,'setTimeout'|'clearTimeout'|'setInterval'|'clearInterval'>}={}){
  const {setTimeout,clearTimeout,setInterval,clearInterval}=options.timers??globalThis;
  const file=path.join(directory,'updates/pause.json'),leaseMs=options.leaseMs??10000,clearMs=options.clearMs??3000,pollMs=options.pollMs??500;
  let active:MaintenanceLease|undefined,timer:ReturnType<typeof setInterval>|undefined,writeTail=Promise.resolve(),failure:unknown;
  let waiting:string[]=[];
  function renew(){
    const lease=active;if(!lease)return writeTail;
    writeTail=writeTail.then(async()=>{if(active?.id===lease.id){active.expires=Date.now()+leaseMs;await atomicJson(file,{...active});}});
    return writeTail;
  }
  async function begin(id:string,loadMode:DeploymentMode='safe'){
    if(active?.id===id)return;
    const existing=await readJson<{id:string;expires:number}>(file);
    if(existing&&existing.id!==id&&existing.expires>Date.now())throw Error('Another console maintenance operation is already in progress');
    active={id,mode:'draining',loadMode,phase:loadMode==='now'?'holding':'preparing',expires:Date.now()+leaseMs};failure=undefined;
    await renew();clearInterval(timer);
    timer=setInterval(()=>{void renew().catch(error=>{failure=error;});},Math.max(50,Math.floor(leaseMs/3)));timer.unref();
  }
  async function phase(value:MaintenanceLease['phase']){if(active){active.phase=value;await renew();}}
  async function clear(id:string,signal:AbortSignal,window:number){
    let safeSince=0;
    while(true){
      signal.throwIfAborted();if(failure)throw failure;
      const status=await observe(signal).catch(()=>({id:null,ready:false}));
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
