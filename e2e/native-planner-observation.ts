import type {BrowserContext, Request} from '@playwright/test';
import {gameplayTimers} from './network-clock';

/** Observe real status traffic; never reacquire CODE while holding a 2s request. */
export function observeNativePlanner(context:BrowserContext) {
  const {setTimeout,clearTimeout}=gameplayTimers()??globalThis;
  const latest=new Map<string,{at:number;body:any}>();
  const listeners=new Set<()=>void>();
  const failures:Array<{at:number;id:unknown;error:string|undefined}>=[];
  const requested=(request:Request)=>{
    if(request.method()!=='POST'||new URL(request.url()).pathname!=='/party-api/status')return;
    const body=request.postDataJSON();
    if(!body?.name||!body.movement||!body.convoyNavigation)return;
    latest.set(body.name,{at:Date.now(),body});
    for(const listener of listeners)listener();
  };
  const failed=(request:Request)=>{
    if(new URL(request.url()).pathname!=='/party-api/movement-plan')return;
    failures.push({at:Date.now(),id:request.postDataJSON()?.id,error:request.failure()?.errorText});
  };
  context.on('request',requested);context.on('requestfailed',failed);
  return {
    failures,
    async sample(request:{character:string;id:string}) {
      const matching=()=>{
        const sample=latest.get(request.character),body=sample?.body,owner=body?.convoyNavigation;
        return sample&&Date.now()-sample.at<1000&&body.movement.id===request.id&&
          !body.movement.done&&!owner.communication&&owner.phase!=='communication-hold'&&
          request.id.startsWith(request.character+':'+owner.runtimeId+':')?sample:undefined;
      };
      if(matching())return matching();
      return new Promise<ReturnType<typeof matching>>(resolve=>{
        const finish=(sample:ReturnType<typeof matching>)=>{clearTimeout(timer);listeners.delete(changed);resolve(sample);};
        const changed=()=>{const sample=matching();if(sample)finish(sample);};
        // The production request times out at 2s. Leave room for state validation
        // and delivery; absence of a sample must not manufacture a timeout.
        const timer=setTimeout(()=>finish(undefined),750);
        listeners.add(changed);
        changed();
      });
    },
    dispose(){context.off('request',requested);context.off('requestfailed',failed);},
  };
}
