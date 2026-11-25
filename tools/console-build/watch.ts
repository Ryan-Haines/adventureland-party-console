import {buildCandidate,sourcePoll} from './builder.ts';
import type {ConsoleBuildController} from './controller.ts';
import { lifecycleSavedFields } from '../../runtime/lifecycle/fields.ts';

/** Polling works across Windows, Linux and network-mounted checkouts. */
export function startConsoleBuilder(root:string,controller:ConsoleBuildController):{dispose():Promise<void>}{
  const sourceFingerprint=sourcePoll(root);
  let disposed=false,running=false,pending=true,last='',changedAt=Date.now()-lifecycleSavedFields.settings.builderPollMs.default;
  let task:Promise<void>=Promise.resolve();
  let buildAbort:AbortController|undefined;
  const initialized=(async()=>{
    const refs=await controller.store.references(),history=await controller.store.history();
    const known=history.find(candidate=>candidate.id===(refs.latest||refs.active));
    if(known){last=known.sourceHash;pending=false;}
  })();
  async function build():Promise<void>{
    running=true;pending=false;
    buildAbort=new AbortController();
    try{await controller.setBuildState({building:true});await buildCandidate(root,controller.store,buildAbort.signal);await controller.setBuildState({building:false});}
    catch(error){await controller.setBuildState({building:false,error:error instanceof Error?error.message:String(error)});}
    finally{running=false;}
  }
  async function poll():Promise<void>{
    if(disposed)return;
    try{await initialized;const hash=await sourceFingerprint();if(disposed)return;if(hash!==last){last=hash;pending=true;changedAt=Date.now();}
      if(pending&&!running&&Date.now()-changedAt>=lifecycleSavedFields.settings.builderPollMs.default){task=build();await task;}
    }catch(error){await controller.setBuildState({building:running,error:String(error)});}
    if(!disposed)timer=setTimeout(()=>{void poll();},lifecycleSavedFields.settings.builderPollMs.default);
  }
  let timer:ReturnType<typeof setTimeout>=setTimeout(()=>{void poll();},0);
  return {async dispose(){disposed=true;clearTimeout(timer);buildAbort?.abort();await task;}};
}
