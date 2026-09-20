const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorRecoveryHooks}=require('../../runtime/coordinator/navigation/recovery-hooks.ts');
function fixture(){
 const state={monsterHunt:null,escape:null,commands:{}},calls=[];
 const ports={huntParticipants:()=>['P'],members:()=>['P','W'],intent:()=>({revision:8}),
  cancelConvoy:()=>calls.push('cancel'),convoy:(...args)=>{calls.push(['convoy',...args]);return false;},
  persist:()=>calls.push('persist'),prepareHunt:hunt=>calls.push(['prepare',structuredClone(hunt)]),
  escape:names=>names,releaseEscape:()=>{},abandonRare:()=>{},resumeHunt:()=>{}};
 return {state,calls,ports,hooks:createCoordinatorRecoveryHooks(state,ports)};
}
test('rare recovery resets the supplied Hunt before optional quest preparation and reads current turn-in ownership',()=>{
 const {state,calls,hooks}=fixture();assert.equal(hooks.rare.turnIn(),false);
 state.monsterHunt={stage:'at-daisy'};assert.equal(hooks.rare.turnIn(),true);
 state.monsterHunt={stage:'travel',turnIn:{phase:'claiming'}};assert.equal(hooks.rare.turnIn(),true);
 const hunt={cycleId:'saved',turnIn:{phase:'claiming'},stage:'farming',target:'rat',currentIndex:2,missions:[{}],pickupPending:true,waitForExpiry:true};
 hooks.rare.resumeHunt(hunt,false);assert.equal(calls.length,0);
 assert.deepEqual(hunt,{cycleId:'saved',stage:'checking-quests',target:null,currentIndex:-1,missions:[],pickupPending:false,waitForExpiry:false});
 hooks.rare.resumeHunt(hunt,true);assert.deepEqual(calls,[['prepare',hunt]]);
 assert.equal(state.monsterHunt.stage,'travel','reset applies to the supplied saved Hunt');
});
test('Escape cancellation reads participants and commands after convoy cancellation and preserves unrelated commands',()=>{
 const {state,calls,ports}=fixture();
 state.escape={participants:['old']};state.commands={old:{}};
 ports.cancelConvoy=()=>{calls.push('cancel');state.escape={participants:['P','W']};state.commands={P:{},W:{},M:{type:'bank'}};};
 const hooks=createCoordinatorRecoveryHooks(state,ports);hooks.escape.cancel();
 assert.deepEqual(state.commands,{M:{type:'bank'}});assert.deepEqual(calls,['cancel']);
 state.escape=null;hooks.escape.cancel();assert.deepEqual(state.commands,{M:{type:'bank'}});
});
test('recovery convoys preserve failure results, destinations, participants and purposes',()=>{
 const {hooks,calls}=fixture(),names=['P','W'],location={map:'cave',x:10,y:20};
 assert.equal(hooks.escape.convoy(names),false);
 assert.equal(hooks.disengagement.returnToFarm(location,names),false);
 assert.deepEqual(calls,[['convoy',{map:'main',x:0,y:0},'escape recovery',names,'escape-recovery'],
  ['convoy',location,'Returning after party death',names,'death-recovery']]);
});
