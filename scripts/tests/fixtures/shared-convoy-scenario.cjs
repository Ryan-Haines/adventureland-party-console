// The shared convoy engine's scenario builders (a
// shared setup lives in the harness). `party` is a three-member convoy assembling at the Main
// rally; the others step it to the phase a case starts from: travelling, or held for a geometry
// mismatch.
require('./coordinator-core.cjs');
const {runtime}=require('../helpers/native-convoy-runtime.cjs');
const {createSharedConvoyNavigation}=require('../../../runtime/movement/coordinator/walk.ts');
const {publishSharedRoute,sharedRoute}=require('../../../runtime/movement/coordinator/route-store.ts');
const engine=()=>createSharedConvoyNavigation();
const copy=x=>JSON.parse(JSON.stringify(x));
// The convoy and the engine that steps it, for a case that starts from assembly.
const partyEngine=()=>({p:party(),e:engine()});
function party(){
 const names=['L','F','P'];return {nextCommandId:10,commands:Object.fromEntries(names.map(n=>[n,{id:1,type:'party-monster-travel',convoyId:'test',epoch:7,navigationRevision:0}])),
 statuses:Object.fromEntries(names.map(n=>[n,{map:'main',x:0,y:0,speed:57,server:'USII',seenAt:1000,convoyProtocol:4,
 convoyNavigation:{runtimeId:n,phase:'assembled'}}])),
 activeConvoy:{id:'test',epoch:7,phase:'assemble',leader:'L',participants:names,completed:[],slowestSpeed:57,
 rally:{map:'main',x:0,y:0},location:{map:'main',x:120,y:0},purpose:null,combatHandoffAllowed:true}};
}

function travellingParty() {
 const {p,e}=partyEngine();e.step(p,1000);
 for(const name of p.activeConvoy.participants){report(p,name,'travelling',1000);p.statuses[name].combatSelection={runtimeId:name};}
 p.activeConvoy.phase='travel';return {p,e};
}

// A travelling event walk after Mr. Pumpkin, every member on Halloween beside the boss's last
// destination; `sight(at, x)` reports the boss at (x, 500) to P at `at` (design 2.3's re-aim).
function eventPursuit() {
 require('../../../runtime/movement/coordinator/planner-service.ts').setGameMonsters({mrpumpkin:{name:'Mr. Pumpkin',speed:40}});
 const {p,e}=travellingParty(),c=p.activeConvoy,now=2000;
 Object.assign(c,{purpose:'shared-walk',walkingActivity:'event',walkingEvent:'mrpumpkin',routeServer:'USII',sharedStartedAt:1000,
  location:{map:'halloween',in:'halloween',x:0,y:0},walkingParents:{},runtimes:{}});
 p.navigationIntents={};
 for(const name of c.participants){c.walkingParents[name]={revision:0};c.runtimes[name]=name;p.navigationIntents[name]={revision:0};
  Object.assign(p.statuses[name],{seenAt:now,joinedEvent:'mrpumpkin',map:'halloween',in:'halloween',x:0,y:0});}
 const sight=(at,x)=>{for(const s of Object.values(p.statuses))s.seenAt=at;
  p.statuses.P.eventCombatSighting={id:'boss-1',mtype:'mrpumpkin',map:'halloween',in:'halloween',x,y:500,observedAt:at};};
 sight(now,500);
 return {p,e,c,now,sight};
}

function mismatchedParty(){
 const {p,e}=partyEngine();e.step(p,1000);
 for(const n of p.activeConvoy.participants)p.statuses[n].movementGeometry={version:17139,fingerprint:n==='F'?'old':'current'};
 e.step(p,1100);return {p,e,c:p.activeConvoy};
}

function report(p,name,phase='route-ready',at=1000){const c=p.activeConvoy,cmd=p.commands[name],s=p.statuses[name];
 s.seenAt=at;s.convoyNavigation={id:c.id,epoch:c.epoch,commandId:cmd.id,navigationRevision:cmd.navigationRevision,
 runtimeId:name,routeVersion:c.routeVersion,phase,routeReady:phase==='route-ready'};}

function publication(p){const c=p.activeConvoy,cmd=p.commands.L;return {character:'L',convoyId:c.id,epoch:c.epoch,commandId:cmd.id,
 runtimeId:'L',navigationRevision:cmd.navigationRevision,routeVersion:c.routeVersion,
 route:{geometry:runtime().context.movement.identity,version:c.routeVersion,origin:c.rally,destination:c.location,plot:[{map:'main',x:0,y:0},{map:'main',x:120,y:0}],source:'search'}};}

function client(name,p,options={}){
 const r=runtime(options),c=r.context;r.context.character.name=name;c.convoyRuntimeId=name;
 c.groupWalk.signal={...engine().signal(p,name,1000)};
 c.request=async(url,options)=>{
  if(url==='/convoy-route'){const error=publishSharedRoute(p,copy(options.body),1000);if(error)throw Error(error);return {ok:true,ready:true};}
  if(url.startsWith('/convoy-route?'))return {ok:true,route:copy(sharedRoute(p.activeConvoy))};
  r.calls.push(['request',url,options]);return {ok:true,ready:true};
 };
 return r;
}

module.exports = { engine, copy, partyEngine, party, travellingParty, eventPursuit, mismatchedParty, report, publication, client };
