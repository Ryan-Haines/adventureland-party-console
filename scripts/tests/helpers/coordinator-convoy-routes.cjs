// Movement's convoy routes over a sliced coordinator context. The empty spawn return has no route:
// farm.ts `returnToSpawn` decides it on the coordinator tick.
const {createConvoyEngagementRoutes,createConvoyAcknowledgementRoutes}=require('../../../runtime/movement/coordinator/routes.ts');
function convoyRoutes(context){
 const {party,farmingNavigation:nav}=context,now=()=>context.Date?.now?.()??Date.now();
 const ports={now,owned:name=>context.ownedCharacter(name),intent:name=>nav.intent(name),group:()=>context.groupedCombatSnapshot(),
  huntOwns:()=>context.huntTurnInOwnsTravel(party.monsterHunt),engage:(body,options)=>context.convoyNavigation.engage(party,body,options),
  acceptArrival:(active,body,at)=>context.huntSafety.acceptArrival(party.monsterHunt,active,body,at),persist:()=>context.persistSettings(),
  waypoint:name=>nav.waypoint(name),contains:(...args)=>context.farmZones.contains(...args),start:(...args)=>context.startPartyMonsterConvoy(...args),
  active:()=>context.activeNames(),members:()=>nav.members()};
 const engagement=createConvoyEngagementRoutes(party,ports);
 const acknowledgements=createConvoyAcknowledgementRoutes(party,{now,owned:ports.owned,valid:body=>context.convoyNavigation.validReport(party,body),
  nextCommand:()=>party.nextCommandId++,persist:ports.persist,history:()=>context.persistHistory(),hold:(...args)=>context.convoyNavigation.hold(party,...args),error:message=>context.console.error(message)});
 return {'convoy-engage':engagement.engage,'grouped-approach':engagement.approach,
  'convoy-complete':acknowledgements.complete,'convoy-failed':acknowledgements.failed};
}
module.exports={convoyRoutes};
