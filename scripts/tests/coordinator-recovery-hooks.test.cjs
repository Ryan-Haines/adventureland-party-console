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
 state.monsterHunt={stage:'returning',turnIn:{phase:'returning'}};assert.equal(hooks.rare.turnIn(),true);
 state.monsterHunt={stage:'travel',turnIn:{phase:'claiming'}};assert.equal(hooks.rare.turnIn(),true);
 const hunt={cycleId:'saved',turnIn:{phase:'claiming'},stage:'farming',target:'rat',currentIndex:2,missions:[{}],pickupPending:true,waitForExpiry:true};
 hooks.rare.resumeHunt(hunt,false);assert.equal(calls.length,0);
 assert.deepEqual(hunt,{cycleId:'saved',stage:'checking-quests',target:null,currentIndex:-1,missions:[],pickupPending:false,waitForExpiry:false});
 hooks.rare.resumeHunt(hunt,true);assert.deepEqual(calls,[['prepare',hunt]]);
 assert.equal(state.monsterHunt.stage,'travel','reset applies to the supplied saved Hunt');
});
test('real rare-controller wiring cannot repeatedly replace a protected Daisy return with Tiny P',()=>{
 const {createRareHunting}=require('../../runtime/coordinator/navigation/rare-hunting.ts');
 const f=fixture(),now=100000;
 Object.assign(f.state,{leader:'P',farmingPolicy:'hunt',monsterFocus:['ghost'],location:{map:'main',x:126,y:-413},
  passiveRareHunts:{tinyp:true},statuses:{P:{ctype:'warrior',seenAt:now,map:'halloween',in:'halloween',server:'USII',hp:100,x:0,y:0,
    rareSightings:[{id:'225',mtype:'tinyp',x:20,y:0,hp:100,visible:true}]}},
  monsterHunt:{cycleId:'hunt',stage:'returning',participants:['P'],turnIn:{owner:'P',phase:'returning'}},
  activeConvoy:{id:'daisy',purpose:'monster-hunt',phase:'shared-prepare'}});
 const convoy=f.state.activeConvoy;
 const rare=createRareHunting(f.state,{...f.hooks.rare,now:()=>now});
 for(let i=0;i<5;i++){rare.report('P',f.state.statuses.P);rare.tick();}
 assert.equal(rare.encounter(),false);assert.equal(f.state.activeConvoy,convoy);assert.equal(f.calls.includes('cancel'),false);
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
