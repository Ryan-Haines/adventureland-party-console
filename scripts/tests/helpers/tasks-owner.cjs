// The tasks owner's groups and tasks owner installed over one party record as its only combat group, the way
// application.ts installs it (runtime/tasks/coordinator/install.ts `installTasks`). A fixture passes
// the realm's hooks and the ports its rows drive; every other source reads the party record. The hunting owner's
// reads are not built, so the helper answers them as 07 does for a party with no Cave visit and a
// group it keeps no farm spot for (hunting/coordinator/install.ts `reads`).
const {installTasks}=require('../../../runtime/tasks/coordinator/install.ts');

// The hunting owner's reads with no Cave visit and no farm spot, on the registry the row asks.
function publishCaveReads(hooks){
 hooks.publish({name:'core:test-cave',folder:'core',author:'test',summary:"07's reads with no Cave visit and no farm spot.",
  hooks:{'farming.focus':()=>undefined,'cave.state':member=>member===undefined?{phase:'idle',run:null,members:[],travel:null}:{inside:false,owned:false}}});
}
function installTasksOver(party,{hooks,now,...ports}){
 publishCaveReads(hooks);
 const members=()=>[party.leader,...Object.keys(party.followers||{}).filter(name=>party.followers[name])];
 const group={get id(){return 'party:'+party.leader;},state:party};
 const groups={list:()=>[{id:group.id,kind:'party',members:members()}],combat:()=>[group],scopeOf:()=>party,solo:()=>null,
  scopePortsOf:()=>({}),walkGroup:()=>group};
 return installTasks({hooks,now,persist(){},record:()=>party,records:{save(){}},groups,members,activeNames:members,
  eventEnabled:()=>false,instanceAllowed:()=>false,attends:()=>false,monsters:()=>null,startConvoy:()=>true,
  navigation:()=>({members,authorize(){}}),visit:()=>null,rare:()=>null,reconcileVisit(){},releaseVisit:()=>null,reconcile(){},
  lockoutMs:()=>5000,paused:()=>false,...ports});
}

module.exports={installTasksOver,publishCaveReads};
