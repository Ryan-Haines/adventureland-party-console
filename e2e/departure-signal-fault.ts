// Holds one member's first status reply that carries a walk's travel phase, and every later
// reply of that walk, for DEPARTURE_HOLD_MS after it arrives (a member departs
// on the first reply that carries the travel phase, so a late reply is a late departure). It
// fabricates no movement or acknowledgement and holds only the first walk it sees.
export const DEPARTURE_HOLD_MS = 1500;
export function departureSignalFaultSource(character: string): string {
  return `(() => {
    if (!globalThis.$?.fn?.jquery) throw Error('Native departure observer unavailable');
    if (globalThis.__e2eDepartureHook) throw Error('Native departure observer already installed');
    const hook = globalThis.__e2eDepartureHook = {enabled:true,signals:[],jquery:$.fn.jquery,generation:globalThis.__partyRuntimeGeneration};
    const blocked = globalThis.__e2eDepartureFaults = [];
    const ajax=$.ajax;
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
          let fault=blocked.find(entry=>entry.id===signal?.id&&entry.epoch===signal?.epoch);
          if(hook.enabled && !fault && !blocked.length && signal?.phase==='travel' && Number.isFinite(signal.epoch)){
            hook.signals.push({id:signal.id,epoch:signal.epoch,departAt:signal.departAt,receivedAt:Date.now(),character:${JSON.stringify(character)},method:'POST',phase:signal.phase});
            fault={id:signal.id,epoch:signal.epoch,startedAt:Date.now(),endsAt:Date.now()+${DEPARTURE_HOLD_MS},endedAt:0};blocked.push(fault);
          }
          if(!hook.enabled || !fault || Date.now()>=fault.endsAt)return callback.call(this,value,...args);
          const context=this;
          setTimeout(()=>{fault.endedAt ||= Date.now();callback.call(context,value,...args);},fault.endsAt-Date.now());
        }));
      };
      return xhr;
    };
    hook.restore=()=>{$.ajax=ajax;};
    return {jquery:hook.jquery,generation:hook.generation};
  })()`;
}
