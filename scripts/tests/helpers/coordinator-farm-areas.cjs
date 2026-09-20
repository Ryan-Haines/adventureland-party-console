const {createFarmAreaNavigation}=require('../../../runtime/coordinator/navigation/farm-areas.ts');
function farmAreaService(context){
 const party=context.party;
 const service=createFarmAreaNavigation(party,{
  now:()=>context.Date.now(),rareOwns:()=>context.rareControl?.owns()||false,members:()=>context.farmingNavigation.members(),
  areas:ids=>context.farmingAreas(party.monsterChoices||[],ids),resolve:(ids,location)=>context.farmZones.resolve(party.monsterChoices||[],ids,location),areaId:area=>context.farmZones.id(area),
  record:(state,reports,areas,now)=>context.farmAreaControl.record(state,reports,Object.keys(context.character_manage),areas,now),
  intent:name=>context.farmingNavigation.intent(name),contains:(...args)=>context.farmZones.contains(...args),huntOwns:hunt=>context.huntTurnInOwnsTravel(hunt),
  eventOwns:hunt=>context.huntPolicy.eventOwnsTravel(hunt,party),cancelConvoy:()=>context.cancelActiveConvoy(),alternatives:(...args)=>context.farmAreaControl.alternatives(...args),
  advanceHunt:hunt=>context.advanceHuntMission(hunt),fighting:(...args)=>context.farmAreaControl.fighting(...args),startHunt:(...args)=>context.startHuntConvoy(...args),
  authorize:(...args)=>context.farmingNavigation.authorize(...args),startConvoy:(...args)=>context.startPartyMonsterConvoy(...args),persist:()=>context.persistSettings(),
 });
 return {farmAreaNavigation:service,farmAreaTick:service.tick};
}
module.exports={farmAreaService};
