const {createPartyConvoys}=require('../../../runtime/movement/coordinator/walk.ts');
const {createRegistry}=require('../../../runtime/hooks/registry.ts');
const {groupId}=require('../../../runtime/tasks/coordinator/groups.ts');
const {installTasksOver}=require('./tasks-owner.cjs');
function convoyService(context){
 const party=context.party;
 // The live task is the tasks owner's answer for the party group (application.ts `liveTask`), from the owner
 // installed over this party.
 const tasks=installTasksOver(party,{hooks:createRegistry(),now:()=>context.Date.now()});
 const live=()=>tasks.live(groupId('party',party.leader));
 const service=createPartyConvoys(party,{
  now:()=>context.Date.now(),nextCommand:()=>party.nextCommandId++,activeNames:()=>context.activeNames(),intent:name=>context.farmingNavigation.intent(name),
  resolve:input=>context.farmZones.resolve(party.monsterChoices||[],party.targetMode==='hunt'&&party.monsterHunt?.target?[party.monsterHunt.target]:party.monsterFocus||[],input),
  persist:()=>context.persistSettings(),live,
 });
 return {partyConvoys:service,startPartyMonsterConvoy:service.start,cancelActiveConvoy:service.cancel};
}
module.exports={convoyService};
