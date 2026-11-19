// The one harness for the worker tests: every port createWorkers declares (WorkerPorts,
// runtime/lifecycle/coordinator/workers.ts), with fakes a row overrides by name.
const { EventEmitter } = require('node:events');
const { createWorkers: createCharacterManager } = require('../../../runtime/lifecycle/coordinator/workers.ts');
function fixture(overrides = {}) {
  const timers=[],workers=[],logs=[],notices=[],local=new Map(),session=new Map();
  const blocks=overrides.blocks||{W:{enabled:true,realm:'SR_USII',script:'adventure_land/generated/warrior.js'}};
  const state={headlessSlots:[],nativeOwner:null,lifecycle:{},gameVersion:0,...overrides.state};
  const ports={blocks,local,session,sessionToken:'fixture-session',typeCode:false,minimap:false,classIds:{warrior:1},
    notify:(hook,payload)=>notices.push([hook,payload]),
    clock:{now:()=>1000,later:(callback,ms)=>{const t={callback,ms};timers.push(t);return t;},cancel:t=>{if(t)t.cancelled=true;},sleep:async()=>undefined},
    log:Object.fromEntries(['log','warn','error'].map(level=>[level,(...args)=>logs.push([level,...args])])),
    resolveRealm:()=>({address:'fixture',path:'/',port:443}),
    resolveCharacter:()=>({id:3,type:'warrior'}),refreshAccount:async()=>{},account:()=>({characters:['W']}),
    caveFloors:()=>({}),stopped(){},
    fork:()=>{const w=new EventEmitter();w.sent=[];w.killed=[];w.send=(m,cb)=>{w.sent.push(m);cb?.(null);return true;};w.kill=s=>{w.killed.push(s);return true;};workers.push(w);return w;},
    pipe(){},monitorUi:()=>({destroy(){}}),
    configuredRealm:'SR_USII',homeRealm:()=>null,script:()=>'adventure_land/generated/warrior.js',watch(){},commit(){},
    reserved:()=>false,owned:()=>true,
    client:{version:10,revision:'10'},gameFiles:{},
    versionData:{movement:async()=>undefined,maps:()=>()=>{},gameData:{read:()=>'',evaluate(){},warn(){}}},
    ...overrides,blocks,state};
  return {manager:createCharacterManager(ports),ports,blocks,state,lifecycle:state.lifecycle,workers,timers,logs,notices,local,session};
}
module.exports={fixture};
