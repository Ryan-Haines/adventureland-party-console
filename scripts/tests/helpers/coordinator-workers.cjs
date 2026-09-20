const { EventEmitter } = require('node:events');
const { createCharacterManager } = require('../../../runtime/coordinator/characters/manager.ts');
function fixture() {
  const timers=[],workers=[],logs=[],lifecycle={},local=new Map(),session=new Map();
  const blocks={W:{enabled:true,realm:'SR_USII',script:'adventure_land/generated/warrior.js'}};
  const ports={blocks,local,session,version:10,sessionToken:'fixture-session',typeCode:false,minimap:false,classIds:{warrior:1},
    clock:{now:()=>1000,later:(callback,ms)=>{const t={callback,ms};timers.push(t);return t;},cancel:t=>{if(t)t.cancelled=true;},sleep:async()=>undefined},
    log:Object.fromEntries(['log','warn','error'].map(level=>[level,(...args)=>logs.push([level,...args])])),
    lifecycle:(name,phase)=>{lifecycle[name]=phase;},resolveRealm:()=>({address:'fixture',path:'/',port:443}),
    resolveCharacter:()=>({id:3,type:'warrior'}),refreshAccount:async()=>{},account:()=>({characters:['W']}),repair:async()=>11,
    fork:()=>{const w=new EventEmitter();w.sent=[];w.killed=[];w.send=(m,cb)=>{w.sent.push(m);cb?.(null);return true;};w.kill=s=>{w.killed.push(s);return true;};workers.push(w);return w;},
    pipe(){},monitor:()=>null};
  return {manager:createCharacterManager(ports),ports,blocks,lifecycle,workers,timers,logs,local,session};
}
module.exports={fixture};
