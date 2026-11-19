const test=require('node:test'),assert=require('node:assert/strict');
const {createFarm}=require('../../runtime/hunting/coordinator/farm.ts');
// The group's farm service over a one-member party: the Hunt's own row records what
// the farm asks of the Hunt record, since only hunt.ts writes it.
function fixture(){
 let now=100000;
 const area={id:'a',map:'main',x:0,y:0},next={id:'b',map:'main',x:20,y:30};
 const state={leader:'P',combatMode:'auto',monsterHunt:null,monsterFocus:['goo'],
  monsterChoices:[{id:'goo',locations:[area,next]},{id:'bee',locations:[area,next]},{id:'rat',locations:[area,next]}],
  location:area,statuses:{P:{map:'main',x:0,y:0,seenAt:now}},farmAreaState:{recoveryVersion:2}};
 require('./helpers/travel-observations.cjs').observeTravel(state.statuses);
 const calls=[];
 const farm=createFarm(state,{P:{}},{
  now:()=>now,rareOwns:()=>false,members:()=>['P'],intent:()=>({revision:7}),huntOwns:()=>false,farmingLive:()=>false,
  cancelConvoy:()=>calls.push(['cancel']),authorize:(...args)=>calls.push(['authorize',...args]),
  startConvoy:(...args)=>calls.push(['convoy',...args]),persist:()=>calls.push(['persist']),
  hunt:{relocate:(...args)=>calls.push(['relocate',...args]),promote:(...args)=>calls.push(['promote',...args]),skipMission:(...args)=>calls.push(['skip',...args])},
 });
 return {state,calls,area,next,tick:()=>farm.tick('P'),advance:()=>{now+=1000;state.statuses.P.seenAt=now;}};
}
test('a pending Hunt relocation moves the mission through the Hunt row once the farm areas tick',()=>{
 const {state,tick,calls,next,advance}=fixture();
 state.targetMode='hunt';state.monsterHunt={target:'bee',stage:'farming',currentIndex:0,missions:[{}]};
 state.farmAreaState.pending={destination:next,revisions:{P:7},at:0,reason:'relocate'};
 advance();tick();
 assert.deepEqual(calls.find(call=>call[0]==='relocate'),['relocate',next,undefined]);
 assert.equal(state.farmAreaState.pending,null);
 assert.equal(calls.some(call=>call[0]==='convoy'),false);
});

test('Hunt route recovery keeps its spawn and budget out of the farming retry',()=>{
 const {state,tick,calls,next,area}=fixture();
 state.targetMode='hunt';state.location=next;
 state.monsterHunt={cycleId:'H',target:'rat',stage:'mission-travel',currentIndex:0,missions:[{target:'rat',destination:area}]};
 state.activeConvoy={id:'relocation',purpose:'monster-hunt',phase:'failed',location:next,failure:'Native planning timed out',routeRecovery:{key:'original',stage:'relocation'}};
 state.farmAreaState.pending={destination:next,revisions:{P:7},at:0,reason:'Travel failed'};
 tick();assert.equal(state.monsterHunt.missions[0].destination,area);
 assert.equal(calls.some(c=>['relocate','convoy','authorize','cancel'].includes(c[0])),false);
 assert.equal(state.activeConvoy.id,'relocation');
});
// HN18 (the empty spawn return): the coordinator tick walks the party back only while
// farming holds the group and no walk runs, and asks again only on a leader report after its walk ended.
test('HN18: the empty spawn return walks only while farming holds the group and no walk runs',()=>{
 let now=100000,live=false;const walks=[];
 const location={id:'goo-main',map:'main',x:0,y:0,monsterIds:['goo']};
 const party={leader:'W',targetMode:'farming',monsterHunt:null,monsterFocus:['goo'],monsterChoices:[{id:'goo',locations:[{map:'main',x:0,y:0}]}],location,
  statuses:{W:{map:'main',x:2000,y:0,seenAt:now}},farmAreaState:{recoveryVersion:2},monsterSearchRadiusByCharacter:{W:100}};
 const farm=createFarm(party,{},{now:()=>now,rareOwns:()=>false,members:()=>['W'],intent:()=>({revision:1}),huntOwns:()=>false,cancelConvoy(){},
  authorize(){},startConvoy:(_l,_label,_names,purpose)=>{walks.push(purpose);party.activeConvoy={id:'w'+walks.length,purpose};},persist(){},
  farmingLive:()=>live,hunt:{relocate(){},promote(){},skipMission(){}}});
 // The leader's reports stand outside for farm.ts SPAWN_OUTSIDE_MS (b9b5c91e shared.js:17665-17683)
 // before it asks, so a step out while it fights pulls no one back.
 const report=ms=>{now+=ms;party.statuses.W.seenAt=now;farm.tick('W');};
 farm.tick('W');assert.deepEqual(walks,[]);
 live=true;farm.tick('W');assert.deepEqual(walks,[],'the first report outside starts the wait');
 report(1500);assert.deepEqual(walks,['empty-spawn-recovery']);
 farm.tick('W');assert.equal(walks.length,1,'no second walk while the first runs');
 party.activeConvoy=null;farm.tick('W');assert.equal(walks.length,1,'the next ask waits for a report after the walk ended');
 report(1000);assert.equal(walks.length,1,'that report starts the wait again');
 report(1500);assert.equal(walks.length,2);
});
