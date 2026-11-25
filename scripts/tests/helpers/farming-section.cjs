// The settings menu's Farming section (farming-settings-section.tsx) for unit tests: the real
// section with the character data, the settings writer and the add-on list stubbed, and a model
// whose `post`, `setFocus` and `openSettings` record their calls.
const load=require('./dashboard-query-module.cjs');
const React=require('../../../dashboard/node_modules/react');
function farmingSection(stubs={}){
 return load('farming-settings-section.tsx',{
  './dashboard-live':{useCharacterData:()=>({})},
  './settings-write':{useSettingsWrite:()=>({ready:true,notice:null,write:async()=>true})},
  // The add-on list holds no add-on, so every other slot export draws nothing.
  '../../../runtime/hooks/dashboard/slots':new Proxy({useAddonSlots:()=>({slots:{'target-mode':[]},addons:[]}),addonSections:()=>({sections:null,status:{}})},
   {get:(target,key)=>key in target?target[key]:key==='__esModule'?true:()=>null}),
  './monster-details-dialog':{MonsterDetailsDialog:props=>React.createElement('MonsterDetailsDialog',props)},
  ...stubs}).FarmingSettingsSection;
}
// `state` is the PartyState the section reads; `calls` collects every recorded call as [name, ...args].
function farmingModel(state,{monsters=[],calls=[]}={}){
 const record=name=>async(...args)=>{calls.push([name,...args]);};
 return {state:{characters:{},...state},monsters,selectedFocus:[],monsterAchievements:{},post:record('post'),setFocus:record('setFocus'),
  openSettings:(...args)=>calls.push(['openSettings',...args]),setMonsterNavigateTarget(){},setSelected(){},setSelectedBestiaryMonster(){},setActionError(){},calls};
}
module.exports={farmingSection,farmingModel};
