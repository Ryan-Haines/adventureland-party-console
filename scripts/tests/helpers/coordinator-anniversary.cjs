const {createAnniversaryReturns}=require('../../../runtime/coordinator/anniversary/returns.ts');
function anniversaryService(context){
 const party=context.party;
 const service=createAnniversaryReturns(party.anniversary,{
  now:()=>context.Date.now(),merchant:()=>party.merchantCharacter,participants:()=>context.anniversaryCombatParticipants(),activeNames:()=>context.activeNames(),
  intent:name=>context.farmingNavigation.intent(name),location:(cycle,name)=>context.farmingNavigation.location(cycle,name),
  defer:(name,recovery)=>{party.deferredEventReturns[name]=recovery;},log:(...args)=>context.anniversaryLog(...args),persist:()=>context.persistSettings(),
  convoyBusy:()=>!!party.activeConvoy,townBusy:()=>!!party.townCycle,dispatch:(cycle,names)=>context.farmingNavigation.dispatch(cycle,'anniversary-return',names),
  capture:names=>context.farmingNavigation.capture(names),reconcile:cycle=>context.farmingNavigation.reconcile(cycle,'anniversary-return'),schedule:()=>context.scheduleAnniversaryReturnConvoy(),
 });
 return {anniversaryReturns:service,abortAnniversaryRound:service.abort,finishAnniversaryAbort:service.finishAbort,
  anniversaryReturnDeadline:service.deadline,dispatchAnniversaryReturn:service.dispatch,
  reconcileAnniversaryReturnFromStatus:service.reconcile};
}
module.exports={anniversaryService};
