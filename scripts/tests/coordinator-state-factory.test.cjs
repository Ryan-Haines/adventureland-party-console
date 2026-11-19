const test=require('node:test'),assert=require('node:assert/strict');
const {createInitialCoordinatorState}=require('../../runtime/settings/coordinator/initial.ts');

test('state initialization retains persisted Hunt trip and event boundary records, and loads a Hunt paused for an event at its own stage',()=>{
 const huntEventTrips={W:[{id:'trip',event:'anniversary',startedAt:10}]},eventBoundary={startedAt:10,endedAt:20};
 const state=createInitialCoordinatorState({persistedSettings:{huntEventTrips,eventBoundary,monsterHunt:{stage:'paused-event',resumeStage:'at-daisy',participants:[]}},persistedSelections:{},persistedHistory:{},persistedBankState:{},persistedRoster:{},persistedALData:{},initialHeadless:[],configuredRealm:'SR_USII'},
  {now:()=>100,loadBankVaultDefinitions:()=>[]});
 assert.equal(state.huntEventTrips,huntEventTrips);assert.equal(state.eventBoundary,eventBoundary);
 assert.equal(state.monsterHunt.stage,'at-daisy');assert.equal(state.monsterHunt.resumeStage,undefined);
});

// v1.5.0 saved the event boundary as combatEventHandoff (hunt-trip.ts:23-24).
test('a combatEventHandoff loads as the event boundary',()=>{
 const combatEventHandoff={startedAt:10};
 const state=createInitialCoordinatorState({persistedSettings:{combatEventHandoff},persistedSelections:{},persistedHistory:{},persistedBankState:{},persistedRoster:{},persistedALData:{},initialHeadless:[],configuredRealm:'SR_USII'},
  {now:()=>100,loadBankVaultDefinitions:()=>[]});
 assert.deepEqual(state.eventBoundary,{startedAt:10});
});
for(const merchant of ['FonzeMerch','GoldMajesty'])test('new merchant '+merchant+' has no invented lucky slot',()=>{
 const {initialMerchantRuntime}=require('../../runtime/settings/coordinator/initial.ts');
 assert.deepEqual(initialMerchantRuntime({},merchant).luckyUpgradeSlots,{});
});
test('persisted character-specific lucky slots retain zero and other verified values',()=>{
 const {initialMerchantRuntime}=require('../../runtime/settings/coordinator/initial.ts');
 assert.deepEqual(initialMerchantRuntime({luckyUpgradeSlots:{FonzeMerch:0,Other:41}},'FonzeMerch').luckyUpgradeSlots,{FonzeMerch:0,Other:41});
});
test('retire the old hardcoded slot 7 without mutating saved settings or other slots',()=>{
 const {initialMerchantRuntime}=require('../../runtime/settings/coordinator/initial.ts');
 const saved={luckyUpgradeSlots:{GoldMajesty:7,FonzeMerch:0}};
 assert.deepEqual(initialMerchantRuntime(saved,'GoldMajesty').luckyUpgradeSlots,{FonzeMerch:0});
 assert.equal(saved.luckyUpgradeSlots.GoldMajesty,7);
});

// "While the party is at an event I'm not in" is gone, so a value a build before it saved loads
// into no field and the next save writes it nowhere. The settings table's declarations name the
// fields the load reads and the save writes.
test('a saved eventApartByCharacter loads into nothing and the next save drops it',()=>{
 const {createCoordinatorPersistence}=require('../../runtime/settings/coordinator/persistence/writer.ts');
 const state=createInitialCoordinatorState({persistedSettings:{eventApartByCharacter:{W:'farm'},leader:'W'},persistedSelections:{},persistedHistory:{},persistedBankState:{},persistedRoster:{},persistedALData:{},initialHeadless:[],configuredRealm:'SR_USII'},
  {now:()=>100,loadBankVaultDefinitions:()=>[]});
 assert.equal(Object.hasOwn(state,'eventApartByCharacter'),false);assert.equal(state.leader,'W');
 const writes=[];createCoordinatorPersistence(state,{set:(key,value)=>writes.push([key,JSON.stringify(value)])},{setTimeout,clearTimeout}).settings();
 assert.equal(writes.some(([,json])=>json.includes('eventApartByCharacter')),false,'no saved document carries it');
});
