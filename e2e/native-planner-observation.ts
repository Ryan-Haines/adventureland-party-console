import type {BrowserContext, Request} from '@playwright/test';
import {gameplayTimers} from './network-clock';

/** A binding lives as long as its context and the worker reuses one context across rows, so each context registers it once and forwards to the current row's observer. */
const ownershipSinks=new WeakMap<BrowserContext,{sink:(at:number,body:any)=>void}>();
async function exposeOwnershipBinding(context:BrowserContext,sink:(at:number,body:any)=>void){
  const held=ownershipSinks.get(context);
  if(held){held.sink=sink;return;}
  const entry={sink};
  ownershipSinks.set(context,entry);
  await context.exposeBinding('__e2eNativePlannerOwnership',(_source,value)=>entry.sink(value.at,value.body));
}

/** Observe real status traffic; never reacquire CODE while holding a 2s request. */
export function observeNativePlanner(context:BrowserContext) {
  const {setTimeout,clearTimeout}=gameplayTimers()??globalThis;
  const latest=new Map<string,{at:number;body:any}>();
  let disposed=false;
  const remember=(at:number,body:any)=>{
    if(disposed||!body?.name||!body.movement||!body.convoyNavigation)return;
    latest.set(body.movement.id,{at,body});
    if(latest.size>64)latest.delete(latest.keys().next().value!);
    for(const listener of listeners)listener();
  };
  const listeners=new Set<()=>void>();
  const failures:Array<{at:number;id:unknown;error:string|undefined}>=[];
  const requested=(request:Request)=>{
    if(request.method()!=='POST'||new URL(request.url()).pathname!=='/party-api/status')return;
    const body=request.postDataJSON();
    remember(Date.now(),body);
  };
  const failed=(request:Request)=>{
    if(new URL(request.url()).pathname!=='/party-api/movement-plan')return;
    failures.push({at:Date.now(),id:request.postDataJSON()?.id,error:request.failure()?.errorText});
  };
  context.on('request',requested);context.on('requestfailed',failed);
  let deliveryFailures=0;
  return {
    failures,
    get deliveryFailures(){return deliveryFailures;},
    async install(client:{run(code:string):Promise<any>}){
      await exposeOwnershipBinding(context,(at,body)=>remember(at,body));
      await client.run(`(()=>{
        const native=$.ajax;
        function observed(options){
          if(options&&typeof options==='object'&&new URL(options.url,location.href).pathname==='/party-api/movement-plan'){
            const request=JSON.parse(options.data),movement=globalThis.__partyMovement?.report?.(),convoyNavigation=globalThis.partyMovement?.convoyNavigationReport?.();
            if(request.character===character.name&&movement?.id===request.id&&convoyNavigation)
              void globalThis.__e2eNativePlannerOwnership({at:Date.now(),body:{name:character.name,movement,convoyNavigation}})
                .catch(()=>{globalThis.__e2eNativePlannerDeliveryFailures=(globalThis.__e2eNativePlannerDeliveryFailures||0)+1;});
          }
          return native.apply(this,arguments);
        }
        $.ajax=observed;
        globalThis.__e2eRestoreNativePlannerOwnership=()=>{if($.ajax===observed)$.ajax=native;delete globalThis.__e2eRestoreNativePlannerOwnership;
          const failed=globalThis.__e2eNativePlannerDeliveryFailures||0;delete globalThis.__e2eNativePlannerDeliveryFailures;return failed;};
        return true;
      })()`);
      // The restore reads back the ownership reports the binding refused, so the row's attachment
      // tells a missing sample from a lost delivery.
      return async()=>{deliveryFailures+=Number(await client.run('(()=>globalThis.__e2eRestoreNativePlannerOwnership?.()??0)()'))||0;};
    },
    async sample(request:{character:string;id:string}) {
      const matching=()=>{
        const sample=latest.get(request.id),body=sample?.body,owner=body?.convoyNavigation;
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
    dispose(){disposed=true;context.off('request',requested);context.off('requestfailed',failed);},
  };
}
