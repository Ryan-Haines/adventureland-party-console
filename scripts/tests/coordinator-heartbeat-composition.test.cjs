const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorHeartbeatResponse}=require('../../runtime/coordinator/status/response-composition.ts');
function fixture(){
 const state={commands:{},statuses:{},followers:{},monsterFocus:['goo'],monsterFocusByCharacter:{},
  monsterPrioritiesByCharacter:{},monsterSearchRadiusByCharacter:{},monsterChoices:['catalog'],farmingPolicy:'normal',
  monsterHunt:null,bankQueue:[],bankbois:{},bankSnapshot:{},goldTargets:{},merchantCharacter:'M',gatheringModes:[]};
 let intent={revision:1},waypoint={map:'main'};
 const api=createCoordinatorHeartbeatResponse(state,{
  now:()=>100,activeNames:()=>[],enabled:()=>false,intent:()=>intent,escapeOwns:()=>false,rareControl:()=>null,
  convoySignal:(current,name)=>({current,name}),waypoint:()=>waypoint,resolveArea:(catalog,focus,point)=>({catalog,focus,point}),
  rareEncounter:()=>null,huntOwns:hunt=>!!hunt?.turnIn,mapSubscriberCount:()=>0,
  stackHomes:(bank,bankbois)=>({bank,bankbois}),groupedCombat:()=>null,selectedEvents:current=>current.selection,
  anniversary:()=>null,rareOwns:()=>false,
 });
 return {state,api,setIntent:value=>intent=value,setWaypoint:value=>waypoint=value};
}

test('BankBoi service commands survive repeated heartbeat delivery until completion',()=>{
 const {state,api}=fixture();const command={id:7,type:'bankboi-service'};state.commands.B=command;
 assert.equal(api.response('B').command,command);assert.equal(api.response('B').command,command);
 assert.equal(state.commands.B,command);
});
test('heartbeat follows replaced farming authority, navigation intent and storage snapshots',()=>{
 const {state,api,setIntent,setWaypoint}=fixture();
 assert.deepEqual(api.response('P').partyLocation.focus,['goo']);
 state.farmingPolicy='hunt';state.monsterHunt={target:'rat',turnIn:true};state.monsterChoices=['new catalog'];
 state.bankSnapshot={items0:['leather']};state.bankbois={B:['drapes']};state.selection=['franky'];
 const intent={revision:9},point={map:'mansion'};setIntent(intent);setWaypoint(point);
 state.commands={P:{type:'party-monster-travel'}};
 const result=api.response('P');
 assert.deepEqual(result.partyLocation,{catalog:state.monsterChoices,focus:['rat'],point});
 assert.equal(result.navigationIntent,intent);assert.equal(result.command.navigationRevision,9);
 assert.equal(result.bankStackHomes.bank,state.bankSnapshot);assert.equal(result.bankStackHomes.bankbois,state.bankbois);
 assert.equal(result.eventSelections,state.selection);assert.equal(result.huntTurnInPriority,true);
 state.monsterHunt={target:null};state.monsterFocus=[];
 assert.deepEqual(api.response('P').partyLocation.focus,[]);
});
test('combat-only heartbeat does not deliver or decorate pending navigation commands',()=>{
 const {state,api}=fixture();const command={type:'travel'};state.commands.P=command;
 const response=api.response('P','combat');
 assert.equal(response.convoySignal.current,state);assert.equal(response.convoySignal.name,'P');
 assert.equal(state.commands.P,command);assert.equal(command.navigationRevision,undefined);
 assert.equal(Object.hasOwn(response,'command'),false);
});
