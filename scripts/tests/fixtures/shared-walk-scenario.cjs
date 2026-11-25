// Shared walk services over a three-member party (a shared setup lives in the harness).
const {createSharedWalks}=require('../../../runtime/movement/coordinator/walk.ts');
const {createPartyConvoys}=require('../../../runtime/movement/coordinator/walk.ts');
// Every `member.holder` answer the console registers is asked: movement's own
// (core:movement `memberHolds`: the manual control and stand-in), the lifecycle owner's (lease.ts
// `memberHolds`: the paused, loading and lost members), survival's
// (`survivalHolds`: the dead, reviving and escaping) and the
// groups and tasks owner's wind-down, as its core:tasks registration answers it: the
// live trip from the group's walk, the healer by class, and the fight's finish by survival's
// verdict for the group (`survival.verdict({group})`), here over the
// members' reported threats and no game data. The tasks owner's `walk:event` keeps the live trip from an
// event walk's takeover while the trip winds down. A row that names its own `holders` (each
// `{name, answer, holder?}`) gets those in place of the tasks and survival owners', beside movement's and the lifecycle owner's; a row
// whose holders name the lifecycle owner replaces its answer too. A row that hands its own registry as `listeners` replaces
// the holders and movement both.
// The wind-down reads the walk's spawn and window from the events owner's `event.schedule`,
// not from the walk's ask. Each fixture publishes a schedule answer over its own table, which a row
// fills with `scheduled(event, spawnAt)`; the newest fixture's table answers. The fixture's walks
// name no group, so an occurrence is `party:|<event>` (groups.ts `groupKey(null)`). The planned walk
// stays unanswered (`walkMs` undefined), which the cut-off counts as no walk, as b9b5c91e's straight
// walk from another map did.
const {tripWindsDown}=require('../../../runtime/tasks/coordinator/wind-down.ts');
const {memberHolds}=require('../../../runtime/tasks/coordinator/install.ts');
const {walkAllowed}=require('../../../runtime/tasks/rules.ts');
const {createRegistry}=require('../../../runtime/hooks/registry.ts');
const {installCoordinatorMovement}=require('../../../runtime/movement/coordinator/runtime.ts');
const {createVerdicts}=require('../../../runtime/coordinator/survival/verdict.ts');
const {survivalHolds}=require('../../../runtime/coordinator/survival/install.ts');
const lifecycleHolds=require('../../../runtime/lifecycle/coordinator/lease.ts').memberHolds;
const {eventShortWindow,occurrenceId,publishEventAnswers}=require('../../../runtime/events/api.ts');
const {gameEvents}=require('../../../runtime/movement/coordinator/planner-service.ts');
const {groupKey}=require('../../../runtime/tasks/coordinator/groups.ts');
// `listeners` is the registry the walk tells and asks (walk.ts WalkListeners); the fixture's own by default.
function fixture(merchant=false,listeners,holders){
 let now=1000,starts=0;const names=merchant?['L','F','P','M']:['L','F','P'];
 const state={leader:'L',merchantCharacter:'M',followers:{F:true,P:true},navigationEpoch:0,nextCommandId:1,activeConvoy:null,commands:{},
 navigationIntents:Object.fromEntries(names.map(n=>[n,{revision:1}])),
 statuses:Object.fromEntries(names.map(n=>[n,{map:'main',x:0,y:0,seenAt:now,server:'USII',speed:57,convoyProtocol:4}]))};
 // The live task the walks serve: the attendance unless a scenario sets another.
 const live={kind:'event-attendance',tier:'event-attendance',owner:'attend'};
 const hooks=createRegistry();
 const convoys=createPartyConvoys(state,{now:()=>now,nextCommand:()=>state.nextCommandId++,activeNames:()=>names,
 intent:n=>state.navigationIntents[n],resolve:x=>x,persist(){},live:()=>live,listeners:listeners||hooks});
 const verdicts=createVerdicts({now:()=>now,monsters:()=>null});
 const fight=()=>({survivors:names.map(n=>({name:n,hp:100,...state.statuses[n]})),foes:names.flatMap(n=>state.statuses[n].threats||[]).map(t=>({id:t.id,mtype:t.mtype,hp:t.hp}))});
 const onTrip=member=>{const trip=state.activeConvoy;return !!trip&&trip.phase!=='failed'&&(member?trip.participants.includes(member):trip.participants.length>0);};
 const walks=createSharedWalks(state,{now:()=>now,members:()=>names,owned:n=>names.includes(n),enabled:()=>true,live:()=>live,
 allowed:(activity,takeover)=>walkAllowed(activity,false,false,!!takeover&&onTrip()&&tripWindsDown(takeover)),
 start:(...args)=>{starts++;return convoys.start(...args);},cancel:()=>convoys.cancel(),persist(){}});
 const schedules=new Map();
 // The short window is the game-data column, as occurrences.ts `schedule` reads it.
 publishEventAnswers({schedule:id=>{const o=schedules.get(id);return o?{...o,occurrence:id,group:groupKey(null),realm:'USII',walkMs:undefined,
  leadMs:120_000,phase:'scheduled',shortWindow:eventShortWindow(o.event,{events:gameEvents()??undefined})}:null;}});
 const scheduled=(event,spawnAt)=>schedules.set(occurrenceId(groupKey(null),event),{event,spawnAt});
 installCoordinatorMovement(hooks,()=>({state,partyConvoys:convoys}),{time:async()=>0,statuses:()=>state.statuses});
 // The tasks owner's own `member.holder` answer over this scope (tasks/coordinator/install.ts `memberHolds`) with
 // survival's verdict on the group's fight; it speaks for the tasks owner as tasksRegistration does.
 const owners=holders??[
  {name:'core:test-tasks',holder:'01',answer:ask=>memberHolds(ask,state,()=>{const f=fight();return verdicts.decide('group:party:L',f.survivors,f.foes,now).verdict;})},
  {name:'core:test-survival',answer:ask=>survivalHolds(state,ask,'party:L',()=>false)}];
 if(!owners.some(h=>h.holder==='13'))hooks.register({name:'core:test-lifecycle',folder:'core',author:'test',holder:'13',summary:"13's member holds.",
  hooks:{'member.holder':({member})=>lifecycleHolds(member,{now:()=>now,report:n=>state.statuses[n],worker:()=>undefined})}});
 for(const h of owners)hooks.register({name:h.name,folder:'core',author:'test',...(h.holder?{holder:h.holder}:{}),summary:h.name+"'s member holds.",hooks:{'member.holder':h.answer}});
 const body=(name,extra={})=>({character:name,runtimeId:name,navigationRevision:1,token:name,activity:'event',key:'icegolem',
 destination:{map:'winterland',x:100,y:100},...extra});
 return {state,walks,convoys,body,live,hooks,scheduled,now:()=>now,starts:()=>starts,advance:ms=>{now+=ms;for(const s of Object.values(state.statuses))s.seenAt=now;}};
}

function goobrawlReturnFixture(activity='farm-recovery') {
 const t=fixture(), names=['L','F','P'], checkpoint={map:'spookytown',x:677,y:129};
 if(activity==='farm-recovery')Object.assign(t.live,{kind:'farming',tier:'farming',owner:'farm'});
 if(activity==='event-return')Object.assign(t.live,{kind:'event-return',tier:'event-return',owner:'return'});
 Object.assign(t.state,{eventReturn:null,eventReturnLast:null,deferredEventReturns:{},anniversary:{},eventSessions:{}});
 for(const name of names)Object.assign(t.state.statuses[name],{map:'goobrawl',x:244,y:-6});
 const farm=name=>t.body(name,{activity,key:activity==='event'?'icegolem':'farming',destination:checkpoint});
 for(const name of names)t.walks.submit(farm(name));
 const old=t.state.activeConvoy;
 if(activity==='event')Object.assign(old,{phase:'failed',failure:'Convoy unavailable',failureCode:'unavailable'});
 const capture=members=>Object.fromEntries(members.map(name=>[name,{revision:t.state.navigationIntents[name].revision,location:checkpoint}]));
 const {createCoordinatorEventReturns}=require('../../../runtime/events/coordinator/returns.ts');
 const service=createCoordinatorEventReturns(t.state,{
  now:()=>1000,nextCommand:()=>t.state.nextCommandId++,activeNames:()=>names,enabled:()=>true,checkpoint:()=>checkpoint,
  cancelConvoy:()=>t.convoys.cancel(),startConvoy:(...args)=>t.convoys.start(...args),
  anniversaryParticipants:()=>[],persist(){},navigation:{capture,
   dispatch:(owner,purpose,members)=>t.convoys.start(owner.checkpoint,'saved checkpoint',members,purpose),
   reconcile:()=>false,finish(){}}
 });
 return {...t,names,checkpoint,farm,old,service};
}

module.exports = { fixture, goobrawlReturnFixture };
