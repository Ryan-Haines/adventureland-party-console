const {createEventAcknowledgementRoutes}=require('../../../runtime/coordinator/http/event-acknowledgements.ts');
function acknowledgementRoutes(context){
 const {party,farmingNavigation:nav}=context;
 return createEventAcknowledgementRoutes(party,{
  now:()=>context.Date?.now?.()??Date.now(),owned:name=>context.ownedCharacter(name),intent:name=>nav.intent(name),
  nextCommand:()=>party.nextCommandId++,persist:()=>context.persistSettings(),selectedDestination:name=>context.selectedMonsterDestination(name),
  finishReturn:()=>context.finishEventReturnIfReady(),contains:(...args)=>context.farmZones.contains(...args),
 });
}
module.exports={acknowledgementRoutes};
