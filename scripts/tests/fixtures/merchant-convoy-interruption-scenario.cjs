// A protocol 4 convoy that a merchant collection interrupts (a shared setup lives in the harness).
const test = require('node:test'), assert = require('node:assert/strict');
const {createSharedConvoyNavigation} = require('../../../runtime/movement/coordinator/walk.ts');
const {createMerchantHandoffRoutes} = require('../../../runtime/merchant-jobs/coordinator/routes.ts');
const {createCoordinatorEventReturns} = require('../../../runtime/events/coordinator/returns.ts');
function fixture(purpose='monster-hunt') {
  let now=1000; const names=['L','F','P'];
  const state={nextCommandId:10,merchantCharacter:'M',merchantCurrent:{id:'job',target:'F',reason:'collection'},
    marked:{},merchantMarked:{},autoItemMarks:{},upgrades:{},compounds:{},statScrolls:{},autoCompounds:{},goldTargets:{},
    navigationIntents:Object.fromEntries(names.map(n=>[n,{revision:1}])),
    commands:Object.fromEntries(names.map(n=>[n,{id:1,type:'party-monster-travel',convoyId:'trip',epoch:7,navigationRevision:1}])),
    statuses:Object.fromEntries(names.map(n=>[n,{map:'main',x:0,y:0,speed:57,server:'USII',seenAt:now,convoyProtocol:4,convoyNavigation:{runtimeId:n}}])),
    activeConvoy:{id:'trip',epoch:7,phase:'assemble',leader:'L',participants:names,completed:[],slowestSpeed:57,
      purpose,rally:{map:'main',x:0,y:0},location:{map:'halloween',x:-509,y:-626},navigationExempt:purpose==='shared-walk-return'}};
  const engine=createSharedConvoyNavigation(), routes=createMerchantHandoffRoutes(state,{offline:()=>false,now:()=>now,nextCommand:()=>state.nextCommandId++,persist(){},owned:()=>true,queue(){},log(){},visitAllowed:()=>true});
  function send(route,body={jobId:'job',target:'F'}) { const res={status(n){this.code=n;return this;},json(v){this.body=v;return this;}};routes[route]({body},res);return res; }
  function ack() { for(const n of names){const c=state.activeConvoy,cmd=state.commands[n];state.statuses[n].seenAt=now;
    state.statuses[n].convoyNavigation={id:c.id,epoch:c.epoch,commandId:cmd.id,navigationRevision:cmd.navigationRevision,runtimeId:n,phase:'held'};} }
  // Every member reports at `time` and still names its last command and phase.
  function seen(time) { for(const n of names)state.statuses[n].seenAt=time; }
  function tick(time=now){now=time;return engine.step(state,now);}
  tick();return {state,send,ack,seen,tick};
}

module.exports = { fixture };
