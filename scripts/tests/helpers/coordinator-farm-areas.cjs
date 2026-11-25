// The hunting owner's farm area service (runtime/hunting/coordinator/farm.ts `createFarm`) over a context that
// plants the old application names. `farmAreaTick` runs one leader report's pass.
const {createFarm}=require('../../../runtime/hunting/coordinator/farm.ts');
const {partyHooks}=require('../../../runtime/hooks/index.ts');
const {settingsWriter}=require('./settings-writer.cjs');
// farm.ts reads the relocation switch through the settings owner's `settings.read`; the one
// registration answers from the newest fixture's writer.
let settings;
if(!partyHooks().map().registrations.some(r=>r.name==='core:farm-settings-fixture'))
 partyHooks().register({name:'core:farm-settings-fixture',folder:'core',author:'test',summary:'test',
  hooks:{'settings.read':query=>settings.read(query),'settings.write':batch=>settings.write(batch)}});
function farmAreaService(context){
 const party=context.party;
 settings=settingsWriter(party);
 const service=createFarm(party,context.character_manage,{
  now:()=>context.Date.now(),rareOwns:()=>context.rareControl?.owns()||false,members:()=>context.farmingNavigation.members(),
  intent:name=>context.farmingNavigation.intent(name),huntOwns:hunt=>context.huntTurnInOwnsTravel(hunt),
  cancelConvoy:()=>context.cancelActiveConvoy(),farmingLive:()=>false,
  hunt:{relocate(){},promote(){},skipMission:()=>context.advanceHuntMission(party.monsterHunt)},
  // A shared walk's authorize saves the party's spot, as farm.ts createFarmingIntents `authorize` does.
  authorize:(names,location,shared)=>{if(shared)party.location=location;context.farmingNavigation.authorize(names,location,shared);},startConvoy:(...args)=>context.startPartyMonsterConvoy(...args),persist:()=>context.persistSettings(),
 });
 return {farmAreaNavigation:service,farmAreaTick:()=>service.tick(party.leader),settings};
}
module.exports={farmAreaService};
