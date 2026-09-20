const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('characters/shared.js','utf8');
function fixture(){
 const target={id:'locked',type:'monster',mtype:'wolfie',visible:true};
 const r=require('./helpers/client-dependencies.cjs').passingContext({travelCombatActive:()=>false,root:{},character:{map:'winterland',in:'winterland'},
  groupedCombat:{target:{id:'locked',map:'winterland',in:'winterland',server:'USII'}},
  groupedFarming:()=>true,unfinishedFight:()=>true,groupedFresh:()=>true,
  leaderLockAllows:e=>e.id==='locked',reunionRealm:()=> 'USII',rareTarget:()=>null,
  isExternallyClaimedMonster:()=>false,isAttackingPartyMember:()=>false,activeCombatEvent:()=>false,joinedEvent:null,isPartyThreat:()=>false,
  inFarmArea:()=>false,inFarmRadius:()=>false,partyLocation:{},combatTargetId:null,lastAttackTarget:null,lastAttackAt:0,farmApproach:{failed:{}}});
 vm.runInContext(source.slice(source.indexOf('  function isAllowedTarget('),source.indexOf('  function sameEventTeamMember(')),r);
 return {r,target};
}
test('exact unfinished monster remains eligible outside farm bounds and focus',()=>{
 const {r,target}=fixture();assert.equal(r.isAllowedTarget(target),true);
});
test('boundary exception never permits another neutral pull or a claimed monster',()=>{
 const {r,target}=fixture();assert.equal(r.isAllowedTarget({...target,id:'new'}),false);
 r.isExternallyClaimedMonster=()=>true;assert.equal(r.isAllowedTarget(target),false);
});
test('wrong-realm and wrong-instance locks do not bypass boundaries',()=>{
 for(const kind of ['realm','instance']){
  const {r,target}=fixture();if(kind==='stale')r.groupedFresh=()=>false;
  if(kind==='realm')r.groupedCombat.target.server='EUI';
  if(kind==='instance')r.groupedCombat.target.in='other';
  assert.equal(r.isAllowedTarget(target),false);
 }
});
test('no selected target during unfinished fight cannot start empty-area search',()=>{
 let cancelled=0;const r=require('./helpers/client-dependencies.cjs').passingContext({unfinishedFight:()=>true,cancelFarmApproach:()=>cancelled++});
 const start=source.indexOf('  function recoverFarmApproach(');
 // Execute only the entry guard: any fallthrough is a regression.
 const guard=source.slice(start,source.indexOf('    var now',start));
 vm.runInContext(guard+'throw new Error("entered area search");}',r);
 assert.equal(r.recoverFarmApproach(null),true);assert.equal(cancelled,1);
});
