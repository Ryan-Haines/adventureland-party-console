// The hunting owner's monster selection routes (runtime/hunting/coordinator/routes.ts) over a context that plants
// the old application names.
const {createMonsterSelectionRoutes}=require('../../../runtime/hunting/coordinator/routes.ts');
const {settingsWriter}=require('./settings-writer.cjs');
function monsterRoutes(context){
 const {party,farmingNavigation:nav}=context;
 return createMonsterSelectionRoutes(party,{now:()=>context.Date?.now?.()??Date.now(),destination:id=>context.monsterDestination(id),
  release:()=>context.escapeControl.release(),clearHunt:()=>context.clearMonsterHuntState(),members:()=>nav.members(),authorize:(...args)=>nav.authorize(...args),
  start:(...args)=>context.startPartyMonsterConvoy(...args),startPhoenix:()=>context.rareControl.start(),stopPhoenix:reason=>context.rareControl.stop(reason),
  persist:()=>context.persistSettings(),validPassive:settings=>context.rareHunting.validPassiveSettings(settings),setPassive:settings=>context.rareControl.setSettings(settings,'dashboard:rare-hunting'),
  write:settingsWriter(party).write,invalidate:(...args)=>nav.invalidate(...args)});
}
module.exports={monsterRoutes};
