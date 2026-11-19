// A held Daisy return convoy, the character's completion client and an initial assembly (a shared setup lives in the harness).
require('./coordinator-core.cjs');
const {walkStatePorts}=require('../helpers/walk-state-ports.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {createWalkClient}=require('../../../runtime/movement/character/walk-client.ts');
const {createSharedConvoyNavigation,sharedCommand}=require('../../../runtime/movement/coordinator/walk.ts');
const {initialCommandState}=require('../../../runtime/settings/coordinator/initial.ts');
const {createConvoyAcknowledgementRoutes}=require('../../../runtime/movement/coordinator/routes.ts');
const {reconcileCurrentHuntParty}=require('../../../runtime/hunting/coordinator/hunt.ts');
function fixture(defense){
 const p={leader:'L',followers:{F:true},combatLogs:{},commands:{},nextCommandId:10,navigationIntents:{L:{revision:2},F:{revision:2}},
  monsterHunt:{convoyId:'c',stage:'returning',participants:['L','F'],missions:[],returnRetries:3},
  activeConvoy:{id:'c',epoch:1,phase:'assemble',purpose:'monster-hunt',leader:'L',participants:['L','F'],completed:[],
   location:{map:'main',x:120,y:0},rally:{map:'main',x:0,y:0},slowestSpeed:57,continuousReturn:1,returnRouting:true,walkingFailures:2},
  statuses:Object.fromEntries(['L','F'].map(n=>[n,{map:'main',x:0,y:0,server:'USII',seenAt:1000,hp:100,convoyProtocol:4,huntReturnProtocol:2,
    speed:57,combatSelection:{runtimeId:n},convoyNavigation:{runtimeId:n}}]))};
 let engine=createSharedConvoyNavigation(defense);engine.step(p,1000);p.activeConvoy.phase='travel';
 function report(now,phase='held') {for(const n of ['L','F']){const s=p.statuses[n],cmd=p.commands[n];s.seenAt=now;
  s.convoyNavigation={id:'c',epoch:p.activeConvoy.epoch,commandId:cmd.id,navigationRevision:cmd.navigationRevision,
   routeVersion:p.activeConvoy.routeVersion,runtimeId:s.combatSelection.runtimeId,phase};}}
 // A member's report reaches the coordinator at `now` and still names its last walk command, as one
 // sent across a coordinator restart does.
 function seen(now){for(const s of Object.values(p.statuses))s.seenAt=now;}
 // Every member reports at `now`; F's request to the coordinator failed, so it reports the walk's
 // communication hold. A member whose reports stop instead leaves the walk (`runtime-lost`).
 function lose(now){report(now,'communication-hold');p.statuses.F.convoyNavigation.communication={operation:'/status',kind:'timeout',since:now-100};}
 report(1000,'travelling');
 return {p,get e(){return engine;},report,seen,lose,step:now=>engine.step(p,now),stable(from){for(let t=from;t<=from+5000;t+=1000){report(t);engine.step(p,t);}},
  restart(now){Object.assign(p,initialCommandState(JSON.parse(JSON.stringify({activeConvoy:p.activeConvoy,convoyCompletionReceipts:p.convoyCompletionReceipts})),()=>now));engine=createSharedConvoyNavigation(defense);}};
}

// The completion client is walk-client.ts's. A failed or waiting acknowledgement asks again after the
// member's next report; `advance` completes that report.
function client(){
 let now=1000,owns=true;const logs=[],reports=[],calls=[];
 const host={parent:{},game_log:m=>logs.push(m)};
 const r={root:host,request:async(path,options)=>{calls.push({path,options});return {ok:true};}};
 Object.assign(r,createWalkClient(host,{...walkStatePorts(host),now:()=>now,character:()=>({name:'L'}),runtimeId:()=>'L',clockOffset:()=>0,request:(path,options)=>r.request(path,options),
  nextReport:()=>new Promise(resolve=>{reports.push(resolve);})}));
 const convoy={phase:'arrived'},cmd={id:1,convoyId:'c',epoch:2,navigationRevision:3,routeVersion:4};
 return {r,convoy,logs,reports,calls,start:()=>r.acknowledgeConvoyArrival(convoy,cmd,()=>owns),cancel(){owns=false;},
  async advance(){const report=reports.shift();if(report){now+=1000;report();}await new Promise(setImmediate);}};
}

function initialAssemblyCommunication() {
 const f=fixture(),c=f.p.activeConvoy;c.phase='assemble';c.purpose='party-travel';delete c.continuousReturn;delete c.runtimes;c.routeVersion=0;
 for(const n of c.participants)f.p.commands[n]=sharedCommand(f.p,c,'assemble',n);
 f.report(1000,'assembled');Object.assign(f.p.statuses.F.convoyNavigation,{phase:'communication-hold',communication:{operation:'/movement-plan',kind:'timeout',since:900}});
 return f;
}

module.exports = { fixture, client, initialAssemblyCommunication };
