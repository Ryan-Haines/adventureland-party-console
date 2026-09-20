const {createAnniversaryNavigationRoutes}=require('../../../runtime/coordinator/http/anniversary-navigation.ts');
function navigationRoutes(context){
 const {party,farmingNavigation:nav}=context;
 return createAnniversaryNavigationRoutes(party.anniversary,{
  now:()=>context.Date.now(),owned:name=>context.ownedCharacter(name),merchant:()=>party.merchantCharacter,
  leader:()=>party.leader,revision:name=>nav.intent(name).revision,persist:()=>context.persistSettings(),
  scheduleReturn:()=>context.scheduleAnniversaryReturnConvoy(),huntOwns:()=>context.huntTurnInOwnsTravel(party.monsterHunt),
  supersede:cycle=>nav.supersede(cycle),convoy:()=>party.activeConvoy,cancelConvoy:()=>context.cancelActiveConvoy(),
  log:(...args)=>context.anniversaryLog(...args),location:()=>party.location,
  fallback:candidate=>context.anniversaryFallbackDestination(candidate),participants:()=>context.anniversaryCombatParticipants(),
  capture:names=>nav.capture(names),
 });
}
module.exports={navigationRoutes};
