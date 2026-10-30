"use strict";
// Keep real coordinator I/O and its original deadlines in the same time domain.
// No responses, payloads, timeout values or gameplay timers are replaced.
function createNativeIo(changed, wallNow) {
  const pending=new Set(),patched=new WeakSet();
  const stats={active:false,started:0,completed:0,wallMs:0,maxWallMs:0};
  function notify(){const active=pending.size>0;if(active!==stats.active){stats.active=active;changed(active);}}
  function install(target){
    function patch(Constructor){
      const prototype=Constructor?.prototype;
      if(!prototype||patched.has(prototype)||typeof prototype.open!=='function'||typeof prototype.send!=='function')return;
      patched.add(prototype);
      const open=prototype.open,send=prototype.send,requests=new WeakMap();
      prototype.open=function(method,url,async,...rest){
        let path='';try{path=new URL(String(url),target.location?.href||'http://localhost').pathname;}catch{}
        requests.set(this,{path,async:async!==false});
        return open.call(this,method,url,async,...rest);
      };
      prototype.send=function(body){
        const request=requests.get(this);
        if(!request?.async||!request.path.startsWith('/party-api/'))return send.apply(this,arguments);
        let value=body;try{if(typeof body==='string')value=JSON.parse(body);}catch{}
        // Long polls deliberately wait for future virtual control/movement.
        if(request.path==='/party-api/status'&&value?.combatWait===true)return send.apply(this,arguments);
        const token={at:wallNow()},xhr=this;let done=false;
        const finish=()=>{
          if(done)return;done=true;xhr.removeEventListener('loadend',finish);
          const elapsed=wallNow()-token.at;stats.completed++;stats.wallMs+=elapsed;stats.maxWallMs=Math.max(stats.maxWallMs,elapsed);
          pending.delete(token);notify();
        };
        pending.add(token);stats.started++;notify();xhr.addEventListener('loadend',finish);
        try{return send.apply(this,arguments);}catch(error){finish();throw error;}
      };
    }
    let Constructor=target.XMLHttpRequest;patch(Constructor);
    if(!Constructor&&!target.document)return;
    const descriptor=Object.getOwnPropertyDescriptor(target,'XMLHttpRequest');
    if(!descriptor||descriptor.configurable)Object.defineProperty(target,'XMLHttpRequest',{
      configurable:true,enumerable:descriptor?.enumerable??true,
      get(){return Constructor;},set(value){Constructor=value;patch(value);},
    });
  }
  return {install,stats};
}
module.exports={createNativeIo};
