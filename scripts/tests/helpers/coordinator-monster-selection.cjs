const {createMonsterSelectionRoutes}=require('../../../runtime/coordinator/http/monster-selection.ts');
function monsterRoutes(context){
 const {party,farmingNavigation:nav}=context;
 return createMonsterSelectionRoutes(party,{now:()=>context.Date?.now?.()??Date.now(),validPhoenixOrder:order=>context.rareHunting.validateOrder(party.monsterChoices,order),
  validLocation:(id,location)=>context.validFarmingLocation(party.monsterChoices||[],[id],location),destination:id=>context.monsterDestination(id),
  release:()=>context.escapeControl.release(),clearHunt:()=>context.clearMonsterHuntState(),members:()=>nav.members(),authorize:(...args)=>nav.authorize(...args),
  start:(...args)=>context.startPartyMonsterConvoy(...args),startPhoenix:order=>context.rareControl.start(order),stopPhoenix:reason=>context.rareControl.stop(reason),
  persist:()=>context.persistSettings(),validPassive:settings=>context.rareHunting.validPassiveSettings(settings),setPassive:settings=>context.rareControl.setSettings(settings),
  invalidate:(...args)=>nav.invalidate(...args)});
}
module.exports={monsterRoutes};
