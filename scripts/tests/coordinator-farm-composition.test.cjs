const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorFarmNavigation}=require('../../runtime/coordinator/navigation/farm-composition.ts');
function fixture(){
 let now=100000,eventOwns=true;
 const area={id:'a',map:'main',x:0,y:0,shapes:[]},next={id:'b',map:'main',x:20,y:30};
 const workers={P:{}},state={leader:'P',farmingPolicy:'normal',monsterHunt:null,monsterFocus:['goo'],monsterChoices:['catalog'],
  location:area,statuses:{P:{map:'main',x:0,y:0,seenAt:now}},farmAreaState:{recoveryVersion:2}};
 require('./helpers/travel-observations.cjs').observeTravel(state.statuses);
 const calls=[];
 const api=createCoordinatorFarmNavigation(state,workers,{
  now:()=>now,rareOwns:()=>false,members:()=>['P'],
  areas:(catalog,ids)=>{calls.push(['areas',catalog,ids]);return [area,next];},
  resolve:(catalog,ids,location)=>{calls.push(['resolve',catalog,ids,location]);return area;},areaId:value=>value.id,
  record:(current,reports,names,areas,time)=>calls.push(['record',current,reports,names,areas,time]),
  intent:()=>({revision:7}),contains:()=>true,huntOwns:()=>false,
  eventOwns:(hunt,current)=>{calls.push(['ownership',hunt,current]);return eventOwns;},
  cancelConvoy:()=>{},alternatives:()=>[next],advanceHunt:()=>{},fighting:()=>false,
  startHunt:(...args)=>calls.push(['hunt',...args]),authorize:(...args)=>calls.push(['authorize',...args]),
  startConvoy:(...args)=>calls.push(['convoy',...args]),persist:()=>calls.push(['persist']),
 });
 return {state,workers,api,calls,area,next,advance:()=>{now+=1000;state.statuses.P.seenAt=now;},release:()=>eventOwns=false};
}
test('farm navigation resolves the current catalog and records newly added workers on each tick',()=>{
 const {state,workers,api,calls,advance}=fixture();api.tick();calls.length=0;
 state.monsterChoices=['replacement'];state.monsterFocus=['rat'];workers.M={};advance();api.tick();
 assert.equal(calls[0][1],state.monsterChoices);assert.deepEqual(calls[0][2],['rat']);
 assert.equal(calls[1][1],state.monsterChoices);assert.equal(calls[1][3],state.location);
 const record=calls.find(call=>call[0]==='record');
 assert.equal(record[1],state.farmAreaState);assert.equal(record[2][0],state.statuses.P);
 assert.deepEqual(record[3],['P','M']);assert.equal(record[5],101000);
});
test('event ownership holds a pending Hunt relocation until the live owner releases travel',()=>{
 const {state,api,calls,next,advance,release}=fixture();
 state.farmingPolicy='hunt';state.monsterHunt={target:'rat',stage:'farming',currentIndex:0,missions:[{}]};
 state.farmAreaState.pending={destination:next,revisions:{P:7},at:0,reason:'relocate'};
 api.tick();assert.ok(state.farmAreaState.pending);assert.equal(calls.some(call=>call[0]==='hunt'),false);
 const ownership=calls.find(call=>call[0]==='ownership');
 assert.equal(ownership[1],state.monsterHunt);assert.equal(ownership[2],state);
 state.monsterHunt={...state.monsterHunt,target:'bee',missions:[{}]};release();advance();api.tick();
 const started=calls.find(call=>call[0]==='hunt');
 assert.deepEqual(started,['hunt',state.monsterHunt,next,'Monster Hunt: bee','mission-travel']);
 assert.equal(state.monsterHunt.missions[0].destination,next);assert.equal(state.farmAreaState.pending,null);
 assert.equal(calls.some(call=>call[0]==='convoy'),false);
});


test('Hunt route recovery retains its spawn and budget instead of entering the farming retry owner',()=>{
 const {state,api,calls,next,area,release}=fixture();release();
 state.farmingPolicy='hunt';state.location=next;
 state.monsterHunt={cycleId:'H',target:'rat',stage:'mission-travel',currentIndex:0,missions:[{target:'rat',destination:area}]};
 state.activeConvoy={id:'relocation',purpose:'monster-hunt',phase:'failed',location:next,failure:'Native planning timed out',routeRecovery:{key:'original',stage:'relocation'}};
 state.farmAreaState.pending={destination:next,revisions:{P:7},at:0,reason:'Travel failed'};
 api.tick();assert.equal(state.monsterHunt.missions[0].destination,area);
 assert.equal(calls.some(c=>['hunt','convoy','authorize'].includes(c[0])),false);
 assert.equal(state.activeConvoy.id,'relocation');
});
