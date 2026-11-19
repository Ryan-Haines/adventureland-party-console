// The hunting owner's Hunt routes (runtime/hunting/coordinator/routes.ts `createHuntRoutes`) over a context that
// plants the old application names; `huntMode` answers the farming-mode route.
const {createHuntRoutes}=require('../../../runtime/hunting/coordinator/routes.ts');
const {settingsWriter}=require('./settings-writer.cjs');
function huntRoutes(context){
 const {party,farmingNavigation:nav}=context;
 return createHuntRoutes(party,{
  participants:()=>context.huntParticipants(),release:()=>context.escapeControl.release(),
  authorize:(...args)=>nav.authorize(...args),monsterDestination:id=>context.monsterDestination?.(id),clear:()=>context.clearMonsterHuntState(),
  selectedDestination:name=>context.selectedMonsterDestination?.(name)??null,convoy:(...args)=>context.startPartyMonsterConvoy?.(...args),
  begin:(...args)=>context.beginMonsterHuntCycle(...args),now:()=>Date.now(),fighting:()=>false,intent:name=>nav.intent(name),
  waypoint:name=>nav.waypoint(name),write:settingsWriter(party).write,owned:()=>null,ownsTravel:()=>false,fresh:()=>true,
  cancelConvoy(){},start:()=>false,persist:()=>context.persistSettings(),group:()=>null,
 });
}
const huntMode=context=>huntRoutes(context).mode;
module.exports={huntMode,huntRoutes};
