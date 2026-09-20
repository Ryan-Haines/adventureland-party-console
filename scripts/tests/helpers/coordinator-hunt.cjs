const {createHuntTick}=require('../../../runtime/coordinator/hunt/tick.ts');
const {createHuntConvoy}=require('../../../runtime/coordinator/hunt/convoy.ts');
const {createHuntQuests}=require('../../../runtime/coordinator/hunt/quests.ts');
const {createHuntLifecycle}=require('../../../runtime/coordinator/hunt/lifecycle.ts');
function installHuntTick(r){
 const party=r.party;
 r.huntLifecycle=createHuntLifecycle(party,{
  now:()=>r.Date.now(),nextCommand:()=>party.nextCommandId++,participants:()=>r.huntParticipants(),cancelConvoy:()=>r.cancelHuntConvoy(),
  clear:()=>r.clearMonsterHuntState(),prepare:hunt=>r.prepareHuntQuests(hunt),persist:()=>r.persistSettings(),
  selectedDestination:name=>r.selectedMonsterDestination(name),authorize:(...args)=>r.farmingNavigation.authorize(...args),start:(...args)=>r.startPartyMonsterConvoy(...args),
 });
 r.huntTurnInOwnsTravel=r.huntPolicy.priority;
 for(const [name,method]of Object.entries({endBlacklistedHunt:'endBlacklisted',beginMonsterHuntCycle:'begin',freshHuntParty:'fresh',finishFailedHunt:'finishFailed'}))r[name]=r.huntLifecycle[method];
 r.huntConvoy=createHuntConvoy(party,{
  now:()=>r.Date.now(),intent:name=>r.farmingNavigation.intent(name),processDaisy:hunt=>r.processHuntsAtDaisy(hunt),
  authorize:(...args)=>r.farmingNavigation.authorize(...args),start:(...args)=>r.startPartyMonsterConvoy(...args),
 });
 r.huntQuests=createHuntQuests(party,{
  now:()=>r.Date.now(),nextCommand:()=>party.nextCommandId++,fresh:hunt=>r.freshHuntParty(hunt),endBlacklisted:hunt=>r.endBlacklistedHunt(hunt),
  start:(...args)=>r.startHuntConvoy(...args),missionDestination:hunt=>r.huntSafety.missionDestination(hunt,r.monsterDestination),monsterDestination:type=>r.monsterDestination(type),
  cancelConvoy:()=>r.cancelHuntConvoy(),persist:()=>r.persistSettings(),clear:()=>r.clearMonsterHuntState(),selectedDestination:name=>r.selectedMonsterDestination(name),
  startNormal:(...args)=>r.startPartyMonsterConvoy(...args),
 });
 r.startHuntConvoy=r.huntConvoy.start;
 for(const [name,method]of Object.entries({issueHuntInteraction:'issue',buildHuntMissions:'build',returnHuntToDaisy:'returnToDaisy',
  advanceHuntMission:'advance',prepareHuntQuests:'prepare',processHuntsAtDaisy:'process'}))r[name]=r.huntQuests[method];
 r.huntTick=createHuntTick(party,{
  now:()=>r.Date.now(),rareEncounter:()=>r.rareControl?.encounter(),begin:()=>r.beginMonsterHuntCycle(),
  intent:name=>r.farmingNavigation.intent(name),finishFailed:hunt=>r.finishFailedHunt(hunt),ownsTravel:hunt=>r.huntTurnInOwnsTravel(hunt),
  cancelHuntConvoy:()=>r.cancelHuntConvoy(),cancelConvoy:()=>r.cancelActiveConvoy(),prepare:hunt=>r.prepareHuntQuests(hunt),persist:()=>r.persistSettings(),
  fresh:hunt=>r.freshHuntParty(hunt),start:(...args)=>r.startHuntConvoy(...args),recordDeaths:hunt=>r.huntSafety.recordDeaths(hunt,party.statuses,r.Date.now()),
  buildMissions:hunt=>r.buildHuntMissions(hunt),advance:hunt=>r.advanceHuntMission(hunt),participants:()=>r.huntParticipants(),returnToDaisy:hunt=>r.returnHuntToDaisy(hunt),
  destination:hunt=>r.huntSafety.missionDestination(hunt,r.monsterDestination),processDaisy:hunt=>r.processHuntsAtDaisy(hunt),contains:(...args)=>r.farmZones.contains(...args),
  arrivalProtected:(hunt,status,destination)=>r.huntSafety.arrivalProtected(hunt,party.leader,status,r.farmingNavigation.intent(party.leader),destination,r.Date.now()),
  partyFighting:hunt=>r.huntSafety.partyFighting(hunt,party.statuses,r.Date.now()),
 });
 // Call the module directly, independent of the coordinator's compatibility wrapper.
 r.monsterHuntTick=r.huntTick.tick;
}
module.exports={installHuntTick};
