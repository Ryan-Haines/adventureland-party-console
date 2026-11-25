const vm = require('node:vm');
// The Franky exit's coordinator setup: a three-member return where A stands on Main and B and C are
// remote on level2w.
function fixture() {
  const recovery = {event:'franky', cycleId:'return', participants:['A','B','C'], pending:['A','B','C']};
  const party = {leader:'A', followers:{B:true,C:true}, statuses:{}, commands:{}, nextCommandId:1,
    navigationEpoch:0, headlessSlots:['A','B','C'], steamMembers:[], location:{map:'cave',x:20,y:30}, eventReturn:recovery};
  for(const name of recovery.pending) party.statuses[name] = {map:name==='A'?'main':'level2w',x:10,y:20,speed:60,seenAt:Date.now(),server:'I'};
  const context = vm.createContext({farmZones: require('../../../.build/shared/farming-zones.cjs'), party, Date, Number, Math, Set, Array,
    farmingNavigation:{intent:()=>({cancelled:true})}, activeNames:()=>['A','B','C'], persistSettings:()=>{},
    cancelActiveConvoy:()=>{for(const name of party.activeConvoy?.participants || []) delete party.commands[name]; party.activeConvoy=null;}});
  Object.assign(context,require('../helpers/coordinator-convoys.cjs').convoyService(context));
  Object.assign(context, require('../helpers/coordinator-events.cjs').eventService(context));
  return {context,party,recovery};
}

module.exports = { fixture };
