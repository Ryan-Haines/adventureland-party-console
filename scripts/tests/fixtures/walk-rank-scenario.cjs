// A two-member party and its convoy starter (a shared setup lives in the harness).
// Isolated test for the coordinator's walk replacement rule.
// Failure list first, in
// e2e/movement-owner-failures.md. The walks scenario covers a party
// travel against a farm walk in play; the pairs below, such as a Hunt roster reconcile
// against an event return walk, do not meet in a run that can be set up on demand.
const test=require('node:test'), assert=require('node:assert/strict');
const {createPartyConvoys}=require('../../../runtime/movement/coordinator/walk.ts');
// `ports.live` replaces the fixed live task, for a row that ticks a real task owner.
function party(ports={}){
  let now=1_000_000,command=0;
  const status=(map,x,y)=>({seenAt:now,map,x,y,server:'EUI',speed:50,hp:100});
  const state={leader:'W',merchantCharacter:'M',followers:{P:true},statuses:{W:status('main',0,0),P:status('main',5,5)},
    commands:{},activeConvoy:null,navigationEpoch:0,location:null,convoyHistory:[]};
  // The group's live task: a walk with no named tier takes this task's tier.
  const live={kind:'farming',tier:'farming',owner:'farm'};
  const convoys=createPartyConvoys(state,{now:()=>now,nextCommand:()=>++command,activeNames:()=>['W','P'],
    intent:()=>({revision:0}),resolve:input=>input,persist(){},live:ports.live||(()=>live)});
  return {state,convoys,live};
}
// The party with a real task owner and the manual provider, wired as application.ts wires them:
// a walk's start reads the live task, which ticks the providers and the owner unless a tick is
// already running (`liveTask`); `report` is one status report's tick (`askProviders`); `trip` is
// `startPartyMonsterConvoy` for a player's trip, which asks `begin` before the walk starts.
function manualParty(){
  const {createTaskOwner}=require('../../../runtime/tasks/coordinator/owner.ts'),{createManualProvider}=require('../../../runtime/tasks/coordinator/manual.ts');
  const group='party:W',names=['W','P'];let asking=false,manual=null,f=null;
  const owner=createTaskOwner({now:()=>1_000_000,notify(){},snapshot(){},walkLive:id=>f.state.activeConvoy?.id===id});
  owner.sync([{id:group,kind:'party',members:names}]);
  const ask=()=>{manual.tick(group);owner.tick();};
  const report=()=>{asking=true;try{ask();}finally{asking=false;}};
  f=party({live:()=>{if(!asking)report();const l=owner.live(group);return l?{kind:l.kind,tier:l.tier,owner:l.owner}:null;}});
  const trip=goal=>manual.begin(group,goal,names)!=='refused'&&f.convoys.start(goal.destination,goal.label,names,goal.purpose);
  manual=createManualProvider(owner,{now:()=>1_000_000,travel:goal=>trip(goal),record:()=>f.state});
  f.state.combatLogs={};
  // The group's diagnostics row: its live task with the walk it names.
  const live=()=>owner.diagnostics().groups.find(g=>g.id===group).live;
  return {...f,group,names,owner,manual,trip,report,live};
}

module.exports = { party, manualParty };
