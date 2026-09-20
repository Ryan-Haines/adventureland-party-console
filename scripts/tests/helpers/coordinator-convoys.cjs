const {createPartyConvoys}=require('../../../runtime/coordinator/navigation/convoy.ts');
function convoyService(context){
 const party=context.party;
 const service=createPartyConvoys(party,{
  now:()=>context.Date.now(),nextCommand:()=>party.nextCommandId++,activeNames:()=>context.activeNames(),intent:name=>context.farmingNavigation.intent(name),
  resolve:input=>context.farmZones.resolve(party.monsterChoices||[],party.farmingPolicy==='hunt'&&party.monsterHunt?.target?[party.monsterHunt.target]:party.monsterFocus||[],input),
  persist:()=>context.persistSettings(),
 });
 return {partyConvoys:service,startPartyMonsterConvoy:service.start,cancelActiveConvoy:service.cancel};
}
module.exports={convoyService};
