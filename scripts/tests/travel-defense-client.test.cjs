const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('characters/shared.js','utf8');
function fixture(grouped=false){
 const passive={id:'bee',type:'monster',mtype:'bee',visible:true,hp:100,x:0,y:0};
 const c=require('./helpers/client-dependencies.cjs').passingContext({root:{__partyTravelCombat:{id:'return',revision:3},__partyDefensiveHit:{at:1000,target:passive}},
  character:{name:'W',map:'main',in:'main'},parent:{entities:{bee:passive}},navigationIntent:{revision:3},
  reunionRealm:()=> 'USII',isAttackingPartyMember:e=>e.target==='P',groupedFarming:()=>grouped,
  groupedCombat:{protocol:4,target:{...passive,map:'main',in:'main',server:'USII',state:'engaged'}},
  isExternallyClaimedMonster:()=>false,combatTargetId:'bee',farmingTravelToken:null,departurePending:false,
  game_log(){},setTimeout,engagedMonster(){assert.fail('historic fight must not be consulted during travel');}});
 for(const [start,end] of [
  ['  function groupedEntityReport(', '  function groupedThreatReports('],
  ['  function departureTargetEngaged(', '  function inFarmRadius('],
  ['  function groupedAttackAllowed(', '  var groupRegroup ='],
  ['  function isAllowedTarget(', '  function sameEventTeamMember('],
  ['  function getNearestPartyAttacker(', '  function getNearestPartyTarget('],
  ['  async function afterCombat(', '  function inFarmArea('],
 ])vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)),c);
 return {c,passive};
}
for(const grouped of [false,true])test('travel rejects a passive retained bee but allows a current follower attacker; grouped='+grouped,()=>{
 const {c,passive}=fixture(grouped);
 assert.equal(c.isAllowedTarget(passive),false);assert.equal(c.groupedAttackAllowed(passive),false);
 assert.equal(c.currentTravelAttackers().length,0);
 passive.target='P';assert.equal(c.isAllowedTarget(passive),true);assert.equal(c.groupedAttackAllowed(passive),true);
 assert.equal(c.currentTravelAttackers()[0].target,'P');
 passive.target='outsider';assert.equal(c.currentTravelAttackers().length,0);
 passive.target='P';passive.hp=0;assert.equal(c.currentTravelAttackers().length,0);
});
test('local travel departs with a retained passive target and waits only until a live attacker disengages',async()=>{
 const {c,passive}=fixture();let moved=0;
 await c.afterCombat(()=>moved++,'return');assert.equal(moved,1);
 passive.target='P';c.setTimeout=fn=>{assert.equal(moved,1);passive.target=null;fn();};
 await c.afterCombat(()=>moved++,'return');assert.equal(moved,2);assert.equal(c.departurePending,false);
});

test('explicit hunt acquisition bypasses travel and destination gates while retaining claims and failed approaches',()=>{
 const {c,passive}=fixture();Object.assign(c,{farmApproach:{failed:{}},convoyTraveling:null,partyThreats:[]});
 const command={purpose:'monster-hunt',combatHandoffAllowed:true,huntTarget:'bee'};
 assert.equal(c.isAllowedTarget(passive,command),true);
 assert.equal(c.isAllowedTarget(passive),false,'ordinary attack selection is still travel-owned');
 c.isExternallyClaimedMonster=()=>true;assert.equal(c.isAllowedTarget(passive,command),false);
 c.isExternallyClaimedMonster=()=>false;c.farmApproach.failed.bee=Date.now()+10000;
 assert.equal(c.isAllowedTarget(passive,command),false);
});
test('cancelled and superseded travel controls cannot keep suppressing farming',()=>{
 const {c}=fixture();assert.equal(c.travelCombatActive(),true);
 c.navigationIntent.revision=4;assert.equal(c.travelCombatActive(),false);
 c.navigationIntent.revision=3;c.navigationIntent.cancelled=true;assert.equal(c.travelCombatActive(),false);
});
test('quiet connected maps report a fresh empty observation; disconnected clients cannot authorize travel',()=>{
 const {c}=fixture();c.parent.socket={connected:true};c.coordinatorClockOffset=20;c.Date={now:()=>1000};
 c.root.__partyEntitiesObservedAt=1;
 assert.equal(c.travelObservationAt(),1020);assert.equal(c.currentTravelAttackers().length,0);
 c.parent.socket.connected=false;assert.equal(c.travelObservationAt(),0);
});
test('an individual command keeps travel targeting until its local movement completes, even without a coordinator command',()=>{
 const {c,passive}=fixture();c.root.__partyTravelCombat=null;
 c.farmingTravelToken={id:9,revision:3,defensiveTravel:true,cancelled:false};
 assert.equal(c.travelCombatActive(),true);assert.equal(c.isAllowedTarget(passive),false);
 assert.equal(c.localTravelCommand().id,9);
 c.farmingTravelToken=null;assert.equal(c.travelCombatActive(),false);
});
test('the shared confirmed-death record excludes a cached monster whose old target still names a follower',()=>{
 const {c,passive}=fixture();passive.target='P';
 c.groupedCombat.deaths=[{id:'bee',map:'main',in:'main',server:'USII',at:900}];
 assert.equal(c.currentTravelAttackers().length,0);assert.equal(c.departureCombatPending(),false);
 c.groupedCombat.deaths[0].in='other';assert.equal(c.currentTravelAttackers().length,1);
});
