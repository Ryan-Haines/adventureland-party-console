const { targetingContext } = require('./helpers/targeting-module.cjs');
// The client's travel defense checks, each run by targeting's module (helpers/targeting-module.cjs)
// over the client's install: the first row over the travel combat slice
// (fixtures/travel-defense-client-scenario.cjs) checks the passing row and the group lock, and the
// rows over the movement harness (fixtures/movement-owner-callers.cjs) check a captured target
// against the Hunt control.
const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./fixtures/travel-defense-client-scenario.cjs');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
for(const grouped of [false,true])test('travel rejects a passive retained bee but allows a current follower attacker; grouped='+grouped,()=>{
 const {c,passive}=fixture(grouped);
 assert.equal(c.isAllowedTarget(passive),false);assert.equal(c.groupedAttackAllowed(passive),false);
 assert.equal(c.currentTravelAttackers().length,0);
 passive.target='P';assert.equal(c.isAllowedTarget(passive),true);assert.equal(c.groupedAttackAllowed(passive),true);
 assert.equal(c.currentTravelAttackers()[0].target,'P');
 passive.target='outsider';assert.equal(c.currentTravelAttackers().length,0);
 passive.target='P';passive.hp=0;assert.equal(c.currentTravelAttackers().length,0);
});
test('explicit hunt acquisition bypasses travel and destination gates while retaining claims',()=>{
 const {c,passive}=fixture();Object.assign(c,{convoyTraveling:null,partyThreats:[]});
 const command={purpose:'monster-hunt',combatHandoffAllowed:true,huntTarget:'bee'};
 assert.equal(c.isAllowedTarget(passive,command),true);
 assert.equal(c.isAllowedTarget(passive),false,'ordinary attack selection is still travel-owned');
 c.isExternallyClaimedMonster=()=>true;assert.equal(c.isAllowedTarget(passive,command),false);
});
scenarioTable('the character keeps travel targeting only while its travel control is live (MOV-132)', fixture, [
 ['cancelled and superseded travel controls cannot keep suppressing farming', ({c})=>{
 assert.equal(c.travelCombatActive(),true);
 c.navigationIntent.revision=4;assert.equal(c.travelCombatActive(),false);
 c.navigationIntent.revision=3;c.navigationIntent.cancelled=true;assert.equal(c.travelCombatActive(),false);
 }],
 ['quiet connected maps report a fresh empty observation; disconnected clients cannot authorize travel', ({c})=>{
 c.parent.socket={connected:true};c.coordinatorClockOffset=20;c.Date={now:()=>1000};
 c.root.__partyEntitiesObservedAt=1;
 assert.equal(c.travelObservationAt(),1020);assert.equal(c.currentTravelAttackers().length,0);
 c.parent.socket.connected=false;assert.equal(c.travelObservationAt(),0);
 }],
 ['the shared confirmed-death record excludes a cached monster whose old target still names a follower', ({c,passive})=>{
 passive.target='P';
 c.groupedCombat.deaths=[{id:'bee',map:'main',in:'main',server:'USII',at:900}];
 assert.equal(c.currentTravelAttackers().length,0);assert.equal(c.departureCombatPending(),false);
 // Each coordinator response carries a new deaths list; departureTargetEngaged indexes it per list.
 c.groupedCombat.deaths=[{...c.groupedCombat.deaths[0],in:'other'}];assert.equal(c.currentTravelAttackers().length,1);
 }],
]);
test('an individual command keeps travel targeting until its local movement completes, even without a coordinator command',()=>{
 const {c,passive}=fixture();c.root.__partyTravelCombat=null;
 c.farmingTravelToken={id:9,revision:3,defensiveTravel:true,cancelled:false};
 assert.equal(c.travelCombatActive(),true);assert.equal(c.isAllowedTarget(passive),false);
 assert.equal(c.localTravelCommand().id,9);
 c.farmingTravelToken=null;assert.equal(c.travelCombatActive(),false);
});

test('continuous Hunt return reports passing attackers for the walking policy without granting normal combat ownership',()=>{
 const {c,passive}=fixture(true);
 c.groupWalk.travel={purpose:'monster-hunt',nonPreemptible:true,continuousReturn:1,phase:'travelling'};
 c.get_entity=id=>id===passive.id?passive:null;
 require('./helpers/targeting-module.cjs').drivePositions(c,[{name:'P',map:'main'}]);
 // The row checks the passing row and the group lock; the return defence, which the slice
 // left out before targeting's module, answers first in play, so the row keeps it off.
 c.returnCombatActive=()=>false;
 c.peerPassingEncounters=[{...passive,map:'main',in:'main',server:'USII',at:Date.now()}];
 passive.target='P';
 assert.equal(c.currentTravelAttackers().length,1);
 const diagnostic={};
 assert.equal(c.isAllowedTarget(passive,null,diagnostic),false);
 assert.equal(diagnostic.reason,'passing attack owns this encounter');
 c.groupedCombat.target=null;
 assert.equal(c.isAllowedTarget(passive),false,'still requires the group selection');
 c.groupedCombat.target={...passive,map:'main',in:'main',server:'USII',state:'engaged'};
 passive.target='outsider';assert.equal(c.isAllowedTarget(passive),false);
 passive.target='P';c.groupWalk.travel.phase='travelling';
 assert.equal(c.currentTravelAttackers().length,1,'passing retaliation remains visible to the walking policy');
 c.groupWalk.travel.phase='defending';c.groupWalk.travel.returnWalking=true;
 assert.equal(c.isAllowedTarget(passive),false,'walking fallback retains movement ownership');
});

// (and upstream issues" row 28): a captured neutral rare holds the walk until a Hunt travel control of
// the current convoy that arrived after the capture drops it, and a monster attacking the party stays
// engaged whatever the control lists.
{
  const { scenarioTable } = require('./fixtures/scenarios.cjs');
  const rare = { id: 'phoenix1', type: 'monster', mtype: 'phoenix', visible: true, hp: 100, map: 'main', in: 'main' };
  // The capture is on movement's group walk and the Hunt walk's defense and control on the hunting
  // owner's Hunt client, whose control a row replaces.
  const world = () => {
    const hunt = { defense: () => true, control: () => null };
    const c = targetingContext(createMovementContext({ character: { name: 'W', map: 'main', in: 'main' }, root: {}, isAttackingPartyMember: () => false }), undefined,
      { walks: { reunionRealm: () => 'USII', groupWalk: { travel: { defenseTargets: [{ ...rare, server: 'USII' }] } } }, hunting: { hunt } });
    return { c, hunt };
  };
  scenarioTable('a captured travel defense target and the Hunt control', world, [
    ['with no later control the capture holds', ({ c }) => { assert.equal(c.departureTargetEngaged(rare), true); }],
    ['a later control that drops it releases it', ({ c, hunt }) => {
      assert.equal(c.departureTargetEngaged(rare), true);
      hunt.control = () => ({ committed: [], primary: null });
      c.huntControlSeenAt = Date.now() + 1;
      assert.equal(c.departureTargetEngaged(rare), false);
      hunt.control = () => ({ committed: [{ ...rare, server: 'USII' }], primary: null });
      assert.equal(c.departureTargetEngaged(rare), true, 'a control that lists it keeps it');
    }],
    ['an attacker is never released by the control', ({ c, hunt }) => {
      c.isAttackingPartyMember = () => true;hunt.control = () => ({ committed: [], primary: null });c.huntControlSeenAt = Date.now() + 1;
      assert.equal(c.departureTargetEngaged(rare), true);
    }],
  ]);
}
