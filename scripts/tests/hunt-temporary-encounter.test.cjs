const test=require('node:test'),assert=require('node:assert/strict');
const {createHunt}=require('../../runtime/hunting/coordinator/hunt.ts');

// A farming Hunt whose mission point (-48,704) lies on the way to the poisio spawn (-121,1360),
// through the hunting owner's Hunt service (hunt.ts `createHunt`).
function fixture(){
 const now=2000,names=['A','B'],original={map:'main',x:-121,y:1360,boundary:[-180,1300,-60,1420]},point={map:'main',in:'main',x:-48,y:704};
 const state={leader:'A',followers:{B:true},nextCommandId:10,targetMode:'hunt',partyFarmingMode:'default',
  monsterSearchRadiusByCharacter:{A:100},combatLogs:{},characterLocations:{},location:original,eventReturn:null,
  monsterHunterLocation:{map:'main',x:-100,y:-100},monsterChoices:[{id:'poisio',locations:[original]}],
  navigationIntents:{A:{revision:7},B:{revision:8}},statuses:{},activeConvoy:null,commands:{},
  monsterHunt:{stage:'farming',cycleId:'h',convoyId:null,currentIndex:0,target:'poisio',participants:names,
   missions:[{target:'poisio',owners:['A'],destination:{map:'main',x:-48,y:704}}],owner:'A',selectionLeader:'A'}};
 const target={...point,id:'p1',mtype:'poisio',server:'USII',hp:100};
 for(const n of names)state.statuses[n]={...point,server:'USII',seenAt:now,hp:100,convoyProtocol:4,
  monsterHunt:{id:'poisio',count:10,remainingMs:900000},groupedCombat:{currentAttackersAt:now,currentAttackers:[],candidates:[],sightings:[],deaths:[]}};
 const starts=[];
 const service=createHunt(state,{now:()=>now,participants:()=>names,online:()=>true,ownsTravel:()=>false,
  cancelConvoy(){state.activeConvoy=null;},persist(){},selectedDestination:()=>null,
  start(location){starts.push(location);state.activeConvoy={id:'new',phase:'assemble',purpose:'monster-hunt',location,participants:names};return true;},
  navigation:{authorize(){},intent:n=>state.navigationIntents[n]}});
 return {state,original,target,starts,tick:()=>service.tick(),get hunt(){return state.monsterHunt;}};
}

test('farming outside the origin recovers even with a follower nomination',()=>{
 const r=fixture();r.hunt.missions[0]={target:'poisio',owners:['A'],destination:r.original,destinationVersion:1};
 r.state.statuses.B.groupedCombat.candidates=[r.target];
 r.tick();assert.equal(r.starts.length,1);assert.deepEqual(r.starts[0],r.original);
});

test('legacy point destination is repaired without changing quest progress or cycle',()=>{
 const r=fixture();r.tick();const {map,x,y}=r.hunt.missions[0].destination;assert.deepEqual({map,x,y},{map:'main',x:-121,y:1360});assert.equal(r.hunt.missions[0].destinationVersion,1);
 assert.equal(r.hunt.cycleId,'h');assert.equal(r.state.statuses.A.monsterHunt.count,10);assert.equal(r.starts.length,1);
});
test('recognized legacy spawn is retained; missing catalog waits and retries',()=>{
 const valid=fixture();valid.hunt.missions[0].destination=valid.original;Object.values(valid.state.statuses).forEach(s=>Object.assign(s,valid.original));
 valid.tick();assert.equal(valid.hunt.missions[0].destinationVersion,1);assert.equal(valid.starts.length,0);
 const r=fixture(),catalog=r.state.monsterChoices;r.state.monsterChoices=null;r.tick();assert.equal(r.starts.length,0);r.state.monsterChoices=catalog;r.tick();assert.equal(r.starts.length,1);
});
test('the legacy spawn walk waits while a member navigation is cancelled',()=>{
 const r=fixture();r.state.navigationIntents.A.cancelled=true;r.tick();assert.equal(r.starts.length,0);
});
