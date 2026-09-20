const {createEventReturns}=require('../../../runtime/coordinator/events/returns.ts');
function eventService(context){
 const party=context.party;
 const service=createEventReturns({
  get current(){return party.eventReturn;},set current(value){party.eventReturn=value;},
  get last(){return party.eventReturnLast;},set last(value){party.eventReturnLast=value;},
  get deferred(){return party.deferredEventReturns;},
 },{
  now:()=>context.Date?.now?.() ?? Date.now(),nextCommandId:()=>party.nextCommandId++,
  activeNames:()=>context.activeNames(),merchant:()=>party.merchantCharacter,enabled:(...args)=>context.eventsEnabledFor(...args),
  statuses:()=>party.statuses,commands:()=>party.commands,clearCommand:name=>{delete party.commands[name];},
  town:(name,r)=>{party.commands[name]={id:party.nextCommandId++,type:'event-return-town',cycleId:r.cycleId,event:r.event,checkpoint:r.checkpoint};},
  checkpoint:()=>context.eventCheckpoint(),capture:names=>context.farmingNavigation.capture(names),clearABStrategy:()=>{party.abtestingStrategy=null;},
  convoy:()=>party.activeConvoy,cancelConvoy:()=>context.cancelActiveConvoy(),
  startExit:names=>context.startPartyMonsterConvoy({map:'main',x:0,y:0},'Mainland exit',names,'franky-exit'),townBusy:()=>!!party.townCycle,
  anniversary:()=>party.anniversary?.eventCycle,anniversaryParticipants:()=>context.anniversaryCombatParticipants(),sessions:()=>Object.values(party.eventSessions),
  dispatch:(r,names)=>context.farmingNavigation.dispatch(r,'event-return',names),reconcile:r=>context.farmingNavigation.reconcile(r,'event-return'),
  finish:(cycle,reason)=>context.farmingNavigation.finish(cycle,reason),persist:()=>context.persistSettings(),
 });
 return {service,goobrawlStillFighting:service.goobrawlStillFighting,cancelPrematureGoobrawlReturn:service.cancelPrematureGoobrawlReturn,
  beginEventReturn:service.begin,startFrankyExitConvoy:service.startFrankyExitConvoy,finishEventReturnIfReady:service.finishIfReady,
  completeCombatEventReturn:service.complete,reconcileCombatEventReturn:service.reconcile};
}
module.exports={eventService};
