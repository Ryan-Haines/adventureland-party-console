// The hunting owner's farming intents and the events owner's event return travel, composed as the coordinator composes them
// (runtime/coordinator/application.ts), for the tests that drove scripts/farming-navigation.cjs.
const {createFarmingIntents}=require('../../../runtime/hunting/coordinator/farm.ts');
const {createEventReturnTravel}=require('../../../runtime/events/coordinator/api.ts');
module.exports=function farmingNavigation(party,hooks){
  const now=hooks.now||Date.now;
  // A test that names no online answer has every named character online.
  const intents=createFarmingIntents(party,{now,names:hooks.names,online:hooks.online||(()=>true),cancelConvoy:hooks.cancelConvoy,startConvoy:hooks.startConvoy,
    events:()=>travel,persist:hooks.persist});
  const travel=createEventReturnTravel(party,{now,nextCommand:()=>party.nextCommandId++,intent:intents.intent,members:intents.members,waypoint:intents.waypoint,
    activeNames:hooks.activeNames,cancelConvoy:hooks.cancelConvoy,startConvoy:hooks.startConvoy,
    persist:hooks.persist,log:hooks.log});
  return {...intents,...travel};
};
