// The coordinator's groups and tasks owner installed over a two-member party with no other owner
// built (a shared setup lives in the harness). Movement's
// `walks.request` and `walks.end` answers record each ask and start or end nothing.
const {createRegistry}=require('../../../runtime/hooks/registry.ts');
const {installTasksOver}=require('../helpers/tasks-owner.cjs');

// `releaseVisit` answers as the hunting owner's Cave release does: null, or the refusal while a member is inside.
function installedTasks({releaseVisit=()=>null}={}){
 let now=100000;const asks=[],reconciled=[],hooks=createRegistry();
 hooks.register({name:'core:test-movement',folder:'core',author:'test',summary:'Records the walk asks.',
  hooks:{'walks.request':(group,ask)=>{asks.push(['request',group,ask]);return true;},'walks.end':(group,code)=>{asks.push(['end',group,code]);return true;}}});
 const status=name=>({name,map:'main',x:0,y:0,seenAt:now,server:'USII',ctype:'warrior'});
 const party={leader:'L',followers:{F:true},merchantCharacter:null,statuses:{L:status('L'),F:status('F')},headlessSlots:['L','F'],steamMembers:[],
  activeConvoy:null,manualTasks:[],combatLogs:{}};
 // A coordinator start in the same process (a reload) installs again on the realm's one registry.
 const install=start=>installTasksOver(party,{hooks,now:()=>now,releaseVisit,reconcile(){reconciled.push(start);}});
 const tasks=install(1);
 return {tasks,party,asks,hooks,reconciled,reinstall:()=>install(2),advance:ms=>{now+=ms;for(const s of Object.values(party.statuses))s.seenAt=now;}};
}

module.exports={installedTasks};
