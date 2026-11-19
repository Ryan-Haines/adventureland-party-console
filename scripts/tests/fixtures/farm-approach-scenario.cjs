// Setups for the farm approach and farm area control tests (scripts/tests/farm-zone-recovery.test.cjs),
// in the shared harness: a fighter's farm approach
// (runtime/movement/character/approach.ts, helpers/approach.cjs), and the coordinator's farm area control for a two-member party.
const fs=require('node:fs');
const vm=require('node:vm');
const { createMovementContext } = require('./movement-owner-callers.cjs');
const zones=require('../../../.build/shared/farming-zones.cjs');
const shared=fs.readFileSync(process.env.AL_SHARED_SOURCE || 'characters/shared.js','utf8');
// The farm approach's journey is the live one until another requester replaces it (`replace`).
// Step 10: the approach ends it by releasing its own journey (design section 1.3), so `stops`
// counts those releases; a release of a journey it no longer holds is a no-op.
function movement() {
 let now=10000,calls=0,stops=0,resolve,reject,live=null;const notices=[];
 const target={id:'bee',x:0,y:200,map:'main'},character={name:'W',map:'main',x:0,y:0,speed:60};
 const c=createMovementContext({character,parent:{entities:{}},partyLocation:{id:'a',map:'main',x:0,y:200,shapes:[{boundary:[-50,150,50,250]}]},
  runtimeCurrent:()=>true,eventAttend:{active:()=>false, joined: () => null, traveling: () => null},eventAnniversary:{staging:()=>false,busy:()=>false},
  groupedFarming:()=>false,requestGroupApproach:()=>false,
  navigationIntent:{revision:1},Date:{now:()=>now},is_in_range:()=>false,combatDistance:()=>200,lastAttackAt:0,
  partyConvoyActive:false,groupWalk:{travel:null},farmTravelPaused:false,can_walk:()=>true,can_move:()=>true,can_move_to:()=>false,safeCombatPoint:()=>true,formationBody:()=>({}),recoverFormationCorner:()=>false,
  inFarmArea:(target,area)=>zones.contains(area,target,0,400),partyFarmingZones:zones,combatApproachPoint:()=>({x:0,y:190}),smart:{},
  smart_move:(p,callback,options)=>{calls++;live={id:'journey-'+calls,owner:options&&options.request&&options.request.owner};return new Promise((r,j)=>{resolve=r;reject=j;});},stop:()=>Promise.resolve(),__partyHooks:{notify:(name,payload)=>notices.push([name,payload])},
  // The walking try's clock (steps.ts `stepStalled`): a 200 ms measured round trip and 1 s reports.
  movement:{report:()=>live&&{id:live.id},release:owner=>{if(!live||live.owner!==owner)return false;live=null;stops++;return true;},
   roundTrip:()=>200,reportInterval:()=>1000}});c.root=c;
 require('../helpers/approach.cjs').installApproach(c);
 return {c,target,calls:()=>calls,stops:()=>stops,now:v=>now=v,resolve:()=>resolve(),reject:()=>reject(Error('no path')),notices,replace:()=>{live={id:'other',owner:'other'};}};
}
function controlFixture() {
 let now=10000;const starts=[];
 const catalog=[{id:'bee',locations:[{map:'main',x:50,y:50,boundary:[0,0,100,100]},{map:'main',x:350,y:50,boundary:[300,0,400,100]}]}];
 const areas=zones.zones(catalog,['bee']);
 const party={leader:'W',followers:{P:true},statuses:{W:{name:'W',seenAt:now},P:{name:'P',seenAt:now}},monsterChoices:catalog,
   monsterFocus:['bee'],location:areas[0],farmAreaState:{},commands:{},combatMode:'auto'};
 const c={party,farmingAreas:require('../../../.build/shared/farming-areas.cjs').farmingAreas,character_manage:{W:{},P:{},Merchant:{}},farmZones:zones,
   huntTurnInOwnsTravel:require('../../../runtime/tasks/api.ts').priority,
   huntPolicy:require('../../../runtime/hunting/coordinator/hunt.ts'),
   Date:{now:()=>now},farmingNavigation:{members:()=>['W','P'],intent:()=>({cancelled:false,revision:1}),authorize(){}},persistSettings(){},
   cancelActiveConvoy(){party.activeConvoy=null;},advanceHuntMission(h){h.advanced=true;},
   startPartyMonsterConvoy(location){starts.push(location);party.activeConvoy={phase:'assemble'};},
   startHuntConvoy(h,location){starts.push(location);party.activeConvoy={phase:'assemble'};}};
 require('../helpers/travel-observations.cjs').observeTravel(party.statuses);
 for(const [name,s] of Object.entries(party.statuses))Object.assign(s,{map:'main',in:'main',server:'USII',combatSelection:{runtimeId:name},farmCompetition:{at:now,runtimeId:name,revision:1,areaId:areas[0].id,map:'main',in:'main',server:'USII',radius:require('../../../runtime/hunting/zones.ts').defaultSearchRadius,monsters:{},players:['Other']}});
 Object.assign(c,require('../helpers/coordinator-farm-areas.cjs').farmAreaService(c));
 return {c,party,areas,starts,advance(ms=1100){now+=ms;for(const s of Object.values(party.statuses)){s.seenAt=now;if(s.farmCompetition)s.farmCompetition.at=now;}},now:()=>now};
}
module.exports={movement,controlFixture};
