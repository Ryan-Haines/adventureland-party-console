// Achievement Hunt bosses on the fighter side (docs/achievement-hunt.md § Bosses, failure mode 29).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('characters/shared.js','utf8');
const slice=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));

function fixture(entities){
 const r=require('./helpers/client-dependencies.cjs').passingContext({travelCombatActive:()=>false,root:{},character:{map:'winterland',in:'winterland'},
  groupedCombat:null,groupedFarming:()=>true,unfinishedFight:()=>false,groupedFresh:()=>true,
  leaderLockAllows:()=>true,reunionRealm:()=> 'USIII',rareTarget:()=>null,
  isExternallyClaimedMonster:()=>false,isAttackingPartyMember:e=>e.target==='Sadokunn',activeCombatEvent:()=>false,joinedEvent:null,isPartyThreat:()=>false,
  inFarmArea:()=>true,inFarmRadius:()=>true,partyLocation:{},combatTargetId:null,lastAttackTarget:null,lastAttackAt:0,farmApproach:{failed:{}},
  convoyTraveling:false,partyThreats:[],scatterBreakTarget:null,eventTargetTypes:[],farmingMode:'default',partyFarmingMonsterType:null,
  followLeader:false,leaderTarget:null,
  monsterFocus:['wolf'],avoidMonsters:['stompy'],parent:{entities},G:{monsters:{stompy:{range:64},wolf:{range:30}}}});
 vm.runInContext(slice('  /** Visible, living bosses from the coordinator\'s avoid list. */','  function rareSightings('),r);
 vm.runInContext(slice('  function isAllowedTarget(','  function sameEventTeamMember('),r);
 return r;
}
const wolf=(id,x,extra={})=>({id,type:'monster',mtype:'wolf',visible:true,x,y:0,...extra});
const stompy={id:'s',type:'monster',mtype:'stompy',visible:true,x:0,y:0,target:null};

test('a fighter skips a new pull near a visible boss and takes one farther away',()=>{
 const near=wolf('near',200),far=wolf('far',400);
 const r=fixture({s:stompy,near,far});
 // Stompy's range is 64, so pulls within 150 + 2 × 64 = 278 of it are skipped.
 assert.equal(r.isAllowedTarget(near),false);
 assert.equal(r.isAllowedTarget(far),true);
});
test('the boss rule never drops a fight already under way or a monster attacking the party',()=>{
 const r=fixture({s:stompy});
 r.combatTargetId='near';assert.equal(r.isAllowedTarget(wolf('near',100)),true);
 r.combatTargetId=null;assert.equal(r.isAllowedTarget(wolf('biting',100,{target:'Sadokunn'})),true);
});
test('without an avoid list, or once the boss is dead or out of sight, pulls near it are allowed',()=>{
 const near=wolf('near',100);
 const off=fixture({s:stompy});off.avoidMonsters=[];assert.equal(off.isAllowedTarget(near),true);
 assert.equal(fixture({s:{...stompy,dead:true}}).isAllowedTarget(near),true);
 assert.equal(fixture({s:{...stompy,visible:false}}).isAllowedTarget(near),true);
});
test('the status reports visible bosses and whom they attack, for the coordinator to leave the target',()=>{
 const r=fixture({s:{...stompy,target:'Icelocked'},w:wolf('w',50)});
 assert.deepEqual(JSON.parse(JSON.stringify(r.avoidSightings())),[{id:'s',mtype:'stompy',x:0,y:0,target:'Icelocked'}]);
});
