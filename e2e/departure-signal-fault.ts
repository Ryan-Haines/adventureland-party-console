export function departureSignalFaultSource(character: string): string {
  return `(() => {
    if (!globalThis.$?.fn?.jquery || !globalThis.sharedRoutine?.queueClockOffset) throw Error('Native departure observer unavailable');
    if (globalThis.__e2eDepartureHook) throw Error('Native departure observer already installed');
    const hook = globalThis.__e2eDepartureHook = {enabled:true,signals:[],jquery:$.fn.jquery,generation:globalThis.__partyRuntimeGeneration};
    const blocked = globalThis.__e2eDepartureFaults = [];
    const ajax=$.ajax;
    const now=()=>Date.now()+sharedRoutine.queueClockOffset();
    $.ajax=function(options,...rest){
      const xhr=ajax.call(this,options,...rest);
      let request=options?.data;
      if(typeof request==='string'){try{request=JSON.parse(request);}catch{return xhr;}}
      if(!options?.url || !new URL(options.url,location.href).pathname.endsWith('/party-api/status') ||
          request?.name!==${JSON.stringify(character)} || String(options.method||options.type||'GET').toUpperCase()!=='POST')return xhr;
      const done=xhr.done;
      xhr.done=function(...callbacks){
        return done.apply(this,callbacks.map(callback=>typeof callback!=='function'?callback:function(value,...args){
          const signal=value?.convoySignal;
          let fault=blocked.find(entry=>entry.epoch===signal?.epoch);
          if(hook.enabled && !fault && hook.signals.length<3 && signal?.phase==='scheduled' &&
              Number.isFinite(signal.epoch) && Number.isFinite(signal.departAt) && signal.departAt>=now()){
            hook.signals.push({epoch:signal.epoch,departAt:signal.departAt,receivedAt:now(),clockOffset:sharedRoutine.queueClockOffset(),
              character:${JSON.stringify(character)},method:'POST',phase:signal.phase});
            fault={epoch:signal.epoch,deadline:signal.departAt,startedAt:now(),endedAt:0};blocked.push(fault);
          }
          if(!hook.enabled || !fault || now()>=fault.deadline+2000)return callback.call(this,value,...args);
          const context=this;
          function deliver(){
            const observed=now(),remaining=fault.deadline+2000-observed;
            const wakes=(fault.wakes ||= []);
            wakes.push({at:Date.now(),coordinatorNow:observed,clockOffset:sharedRoutine.queueClockOffset(),remaining});
            if(wakes.length>16)wakes.splice(8,1);
            // Genuine responses can resynchronize the offset while this one
            // is held. A timer wake alone does not prove its deadline passed.
            if(hook.enabled && remaining>0){setTimeout(deliver,remaining);return;}
            fault.endedAt=observed;callback.call(context,value,...args);
          }
          setTimeout(deliver,Math.max(0,fault.deadline+2000-now()));
        }));
      };
      return xhr;
    };
    hook.restore=()=>{$.ajax=ajax;};
    return {jquery:hook.jquery,generation:hook.generation};
  })()`;
}
