const {createHuntModeRoute}=require('../../../runtime/coordinator/http/hunt-mode.ts');
function huntMode(context){
 const {party,farmingNavigation:nav}=context;
 return createHuntModeRoute(party,{
  participants:()=>context.huntParticipants(),cancelled:name=>nav.intent(name).cancelled,release:()=>context.escapeControl.release(),
  authorize:(...args)=>nav.authorize(...args),monsterDestination:id=>context.monsterDestination(id),clear:()=>context.clearMonsterHuntState(),
  selectedDestination:name=>context.selectedMonsterDestination(name),convoy:(...args)=>context.startPartyMonsterConvoy(...args),
  returnToDaisy:hunt=>context.returnHuntToDaisy(hunt),begin:(...args)=>context.beginMonsterHuntCycle(...args),
  waypoint:name=>nav.waypoint(name),validLocation:(focus,location)=>context.validFarmingLocation(party.monsterChoices||[],focus,location),persist:()=>context.persistSettings(),
 });
}
module.exports={huntMode};
