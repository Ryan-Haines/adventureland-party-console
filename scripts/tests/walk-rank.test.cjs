// Isolated test for the coordinator's walk replacement rule.
// Failure list first.
// The pairs below, such as a Hunt roster
// reconcile against an event return walk, do not meet in a run that can be set up on demand.
const assert=require('node:assert/strict');
const {createPartyConvoys}=require('../../runtime/movement/coordinator/walk.ts');

const farm={map:'main',x:500,y:500};

const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {party,manualParty}=require('./fixtures/walk-rank-scenario.cjs');
scenarioTable('the coordinator replaces a walk only with a higher-ranked walk of a named tier (MOV-208)', party, [
 // Step 8b items 2 and 3: party travel ranks as manual, so a farm walk gives way to it and a
 // farm relocation or a Hunt stage cannot replace it; a higher task or the same task can.
 ['failure 3: a lower walk never replaces a higher one, and party travel ranks as manual', ({state,convoys,live})=>{
  assert.equal(convoys.start(farm,"the leader's configured farming focus",['W','P'],null),true);
  assert.equal(state.activeConvoy.requester.tier,'farming');
  assert.equal(convoys.start(farm,'party location',['W','P'],'party-travel'),true);
  const travel=state.activeConvoy.id;
  assert.equal(state.activeConvoy.requester.tier,'manual');
  assert.deepEqual(state.commands.W.requester,{kind:'group-walk',tier:'manual'});
  assert.equal(convoys.start(farm,'Moving to another farming zone',['W','P'],'farm-relocation'),false);
  assert.equal(convoys.start(farm,'Monster Hunt turn-in',['W','P'],'monster-hunt',undefined,'hunt-turn-in'),false);
  assert.equal(convoys.start(farm,'Monster Hunt: goo',['W','P'],'monster-hunt',undefined,'hunt-mission'),false);
  assert.equal(state.activeConvoy.id,travel);
  // The escape task holds the group when its walk starts: the walk takes its tier.
  Object.assign(live,{kind:'escape',tier:'escape',owner:'escape'});
  assert.equal(convoys.start({map:'main',x:0,y:0},'escape recovery',['W','P'],'escape-recovery'),true);
  assert.equal(state.activeConvoy.requester.tier,'escape');
  assert.equal(convoys.start({map:'main',x:0,y:0},'escape recovery',['W','P'],'escape-recovery'),true);
 }],
 // Step 8c item 13 (design section 5.1): each member's command names the walk's group, the
 // coordinator service that owns it, so its walk identity reads walk:<group>:<convoy>:<epoch>:<revision>.
 // A solo service names its task group's id, `solo:<name>`.
 ['step 8c: walk commands name their group, the main party or a solo service', ({state,convoys})=>{
 convoys.start(farm,'party location',['W','P'],'party-travel');
  assert.equal(state.commands.W.group,'party');assert.equal(state.activeConvoy.group,'party');
  let now=1_000_000;const solo={leader:'W',merchantCharacter:'M',followers:{},statuses:{W:{seenAt:now,map:'main',x:0,y:0,server:'EUI',speed:50,hp:100}},
    commands:{},activeConvoy:null,navigationEpoch:0,location:null,convoyHistory:[]};
  const soloConvoys=createPartyConvoys(solo,{now:()=>now,nextCommand:()=>1,activeNames:()=>['W'],intent:()=>({revision:0}),resolve:input=>input,persist(){},rankedWalks:true,group:()=>'solo:W',live:()=>({kind:'farming',tier:'farming',owner:'farm'})});
  soloConvoys.start(farm,'party location',['W'],'party-travel');assert.equal(solo.commands.W.group,'solo:W');
 }],
 // The manual row:
 // a player's trip asks the owner before its walk starts (`begin`), and the walk's start reads
 // the live task, which ticks the providers. The manual provider's tick reads a live trip with no
 // walk as one to resume, so it started the walk inside the caller's start, and the caller's own
 // start then met a walk of the same task and was refused: the dashboard read "the party
 // convoy could not be started" for a walk that ran.
 // The wiring is application.ts's: `startPartyMonsterConvoy`
 // asks `begin`, then starts the walk, whose `live` port ticks the providers once.
 ['a player trip that goes live as it begins starts its one walk from the caller (GRP-034)', ()=>{
  const f=manualParty(),{names,owner,group,trip}=f;
  // A walk of another task holds the party (the death recovery's farm return).
  f.convoys.start(farm,'saved farm',names,'death-recovery','farming-conflict','death-recovery');
  const goo={destination:{map:'main',x:-32,y:787},purpose:'manual-monster-override',label:'the goo spawn'};
  assert.equal(trip(goo),true,'the caller starts the trip\'s walk');
  assert.equal(f.state.combatLogs.W.filter(e=>e.message==='Convoy started'&&e.details.purpose==='manual-monster-override').length,1,'one walk for the trip');
  assert.equal(owner.live(group)?.kind,'manual','the trip is the live task');
 }],
 // A death recovery
 // suspends a trip, the trip's walk ends while it is suspended, and the recovery ends. The resume
 // tick starts the trip's walk again, and that walk ends before the next report (the route's
 // origin changed before departure). The task names the walk it has, so the end of
 // the resumed walk reaches it and it ends, and no tick reads the walk that ended before.
 ['a trip resumed after its walk ended while suspended names its new walk (GRP-034, invariant 4)', ()=>{
  const f=manualParty(),{names,owner,group,trip,report,live}=f;
  const goo={destination:{map:'main',x:-32,y:787},purpose:'manual-monster-override',label:'the goo spawn'};
  assert.equal(trip(goo),true);report();
  const first=f.state.activeConvoy.id;assert.equal(live().walk,first);
  const death=owner.request(group,{kind:'death-recovery',owner:'death:1',members:names,deadline:1_000_000+60_000});
  assert.equal(death.status,'granted');
  // The walk ends under the recovery (the cancel of a lower walk).
  f.convoys.cancel('replaced:death-recovery');report();report();
  owner.release(death,'recovered');report();
  const resumed=f.state.activeConvoy?.id;
  assert.ok(resumed&&resumed!==first,'the resume starts the trip walk again');
  assert.equal(live().walk,resumed,'the resumed trip names the walk it started');
  f.convoys.cancel('cancelled by owner');report();report();
  const broken=owner.diagnostics().breaks.filter(b=>b.invariant===4);
  assert.deepEqual(broken,[],'no task names an ended walk for a second tick');
  assert.notEqual(owner.live(group)?.kind,'manual','the trip ends with its walk');
 }],
]);
