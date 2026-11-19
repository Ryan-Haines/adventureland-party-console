const test = require('node:test');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const assert = require('node:assert/strict');
const {fixture,prepare,ready}=require('./fixtures/convoy-coordinator-scenario.cjs');
// `report-gap`: the hold a lost coordinator request starts ends
// once every member's report is fresh, held and acknowledged again. A Hunt walk ends on the same rule.
const lostRequest=p=>{prepare(p);const c=p.activeConvoy,s=p.statuses.B;
 s.convoyNavigation={...s.convoyNavigation,id:c.id,epoch:c.epoch,commandId:p.commands.B.id,navigationRevision:0,runtimeId:'B',
  phase:'communication-hold',communication:{operation:'/movement-plan',kind:'timeout',since:1600}};
 for(const n of ['A','B'])p.statuses[n].seenAt=2000;p.step(2000);assert.equal(c.phase,'communication-hold');return c;};
const heldAt=(p,at)=>{const c=p.activeConvoy;for(const n of ['A','B']){const s=p.statuses[n];s.seenAt=at;
 s.convoyNavigation={id:c.id,epoch:c.epoch,commandId:p.commands[n].id,navigationRevision:0,runtimeId:n,phase:'held'};}p.step(at);};
scenarioTable('a report gap ends on fresh held reports, and a member whose reports stop leaves the walk (R4-1, RR16)', fixture, [
 ['a walk with no Hunt cycle resumes on the first round of fresh held reports (red: waits 5 s)', p=>{
  const c=lostRequest(p);heldAt(p,3000);assert.equal(c.phase,'shared-prepare');assert.equal(c.communicationHold,undefined);
 }],
 // `runtime-lost`: a member whose reports stop before
 // departure leaves the walk and the walk's command goes with it, so the walk never departs on its stale
 // report and waits on the members still reporting. It supersedes "holds on stale reports" (design
 // "Corrections from step 8c" item 26), which held the whole walk in `communication-hold`.
 ['a member whose reports stop before departure leaves the walk, which keeps the other member\'s command', p=>{
  prepare(p); ready(p,'A'); p.step(2000);
  const a=p.commands.A; p.statuses.A.seenAt=4500; p.statuses.B.seenAt=0; p.step(4500);
  assert.deepEqual(p.activeConvoy.participants,['A']); assert.equal(p.commands.B,undefined);
  assert.notEqual(p.activeConvoy.phase,'communication-hold'); assert.equal(p.commands.A,a);
 }],
]);

scenarioTable('the barrier releases each convoy phase only from matching stopped reports (MOV-032, MOV-111)', fixture, [
 ['phase dispatch binds the current navigation revision', p=>{
 p.navigationIntents={A:{revision:9},B:{revision:11}};
  prepare(p);assert.equal(p.commands.B.navigationRevision,11);
  assert.equal(p.activeConvoy.expected.A.commandId,p.commands.A.id);
 }],
 // RF6 and RR7: one ready report per member departs, and it counts only when it
 // acknowledges the walk's current command.
 ['assembly needs observed speed and stillness, and departs on the first ready report that acknowledges the current command (RF6, RR7)', p=>{
  p.statuses.B.speed=70; p.step(1000); assert.equal(p.activeConvoy.phase,'assemble');
  p.statuses.A.moving=true; p.statuses.B.speed=57; p.step(1100); assert.equal(p.activeConvoy.phase,'assemble');
  // A ready report from before the walk's command does not count.
  p.statuses.A.moving=false; p.statuses.B.convoyNavigation.commandId=0; p.step(1200);
  assert.equal(p.activeConvoy.phase,'assemble'); assert.equal(p.activeConvoy.blockers.B.reason,'acknowledgement-missing');
  p.statuses.B.convoyNavigation.commandId=p.commands.B.id; p.step(1300);
  assert.equal(p.activeConvoy.phase,'shared-prepare','the first acknowledging ready report departs');
  assert.equal(p.commands.A.phase,'shared-prepare'); assert.equal(p.activeConvoy.departAt,null);
 }],
 // One walk machine: the assembled walk begins the shared route, never a route of its own.
 ['an assembled walk begins the shared route at once; a leader landing from a transport keeps it assembling', p=>{
  p.statuses.A.transporting=true; prepare.round(p);
  assert.equal(p.activeConvoy.phase,'assemble'); assert.ok(Object.values(p.commands).every(c=>c.phase!=='prepare'));
  p.statuses.A.transporting=false; p.step(1700);
  assert.equal(p.activeConvoy.phase,'shared-prepare'); assert.deepEqual(Object.values(p.commands).map(c=>c.phase),['shared-prepare','shared-prepare']);
 }],
]);

// CF1 `prepare`: route preparation waits on the members' planner answers, each try bound
// by the planner's own budget. A Hunt walk ends on the same answers.
scenarioTable('route preparation ends on the planner answers (CF1 prepare, R2F1 E1)', fixture, [
 ['a walk no Hunt route owns keeps preparing past 60 s while its members plan', p=>{
  prepare(p);
  for(const at of [30000,61600,90000]){for(const n of ['A','B'])p.statuses[n].seenAt=at;p.step(at);}
  assert.equal(p.activeConvoy.phase,'shared-prepare');assert.equal(p.activeConvoy.failure,undefined);
 }],
]);
// CF1: a barrier phase ends on its members' answers, not on a clock (the Town's 20 s or a fixed 65 s),
// and its failure climbs the walk's ladder, which walks with Town off (`disableFailedTown`).
scenarioTable('a barrier phase lasts while its members work and ends on a failed report (CF1)', fixture, [
 ['a Town cast in progress is not cut at 20 s, and a member\'s failed cast climbs at once as town-unavailable', p=>{
  const c=p.activeConvoy;Object.assign(c,{phase:'town',townCompleted:false,observedPhase:'town',phaseStartedAt:1000,lastProgressAt:1000,progress:{},runtimes:{A:'A',B:'B'}});
  for(const n of ['A','B'])p.statuses[n].convoyNavigation.phase='casting-town';
  for(const at of [10000,22000,30000]){for(const n of ['A','B'])p.statuses[n].seenAt=at;p.step(at);}
  assert.equal(c.phase,'town');
  Object.assign(p.statuses.A.convoyNavigation,{phase:'failed',failure:'Town shortcut unavailable; party remains held'});p.step(30000);
  assert.equal(c.phase,'shared-hold');assert.equal(c.failure,'A: Town shortcut unavailable; party remains held');
  assert.equal(c.disableTown,true);assert.equal(c.ladderRung,'replan','one climb, on the ladder of the walk');
 }],
 // The Town command stays B's command, so each heartbeat reply carries it until B's
 // report acknowledges it (runtime/status/rules.ts keeps `party-monster-travel`).
 ['a member that never acknowledges keeps the Town phase and its command for each next reply, with no end after a round', p=>{
  const c=p.activeConvoy;Object.assign(c,{phase:'town',townCompleted:false,observedPhase:'town',phaseStartedAt:1000,lastProgressAt:1000,progress:{},runtimes:{A:'A',B:'B'}});
  p.statuses.A.convoyNavigation.phase='towned';p.statuses.B.convoyNavigation.commandId=99;const sent=p.commands.B;
  for(const at of [2000,3000,4000,5000,6000]){for(const n of ['A','B'])p.statuses[n].seenAt=at;p.step(at);}
  assert.equal(c.phase,'town');assert.equal(c.failure,undefined);assert.equal(p.commands.B,sent);
  assert.equal(c.blockers.B.reason,'acknowledgement-missing');
  Object.assign(p.statuses.B.convoyNavigation,{commandId:sent.id,phase:'towned'});p.step(6000);
  assert.equal(c.phase,'assemble','the acknowledged cast regroups the walk');
 }],
 // The barrier-phase defend: b9b5c91e's Town and assembly phases sent no
 // coordinator request (the member walks to the rally and casts Town locally), and a member's late
 // report took the walk's communication hold in every phase (b9b5c91e shared-navigation.ts:433-438).
 // So no lost request failed a barrier phase on the base; `runtime-lost` now lets the silent member go.
 ['a member whose report is lost during the Town cast never fails the walk (green on b9b5c91e and here)', p=>{
  const c=p.activeConvoy;Object.assign(c,{phase:'town',townCompleted:false,observedPhase:'town',phaseStartedAt:1000,lastProgressAt:1000,progress:{},runtimes:{A:'A',B:'B'}});
  for(const n of ['A','B'])p.statuses[n].convoyNavigation.phase='casting-town';
  p.statuses.A.seenAt=5000;p.statuses.B.seenAt=1000;p.step(5000);
  assert.notEqual(c.phase,'failed');assert.equal(c.failureCode,undefined);assert.deepEqual(c.participants,['A']);
 }],
]);

// `member.holder` names the owner holding a member that is not walking.
// The walk waits for a member whose holders say it is coming and goes on without one that any
// holder says is not coming. The lifecycle owner answers the paused, loading and lost members (
// runtime/lifecycle/coordinator/lease.ts `memberHolds`). Survival answers its own (
// runtime/coordinator/survival/install.ts `survivalHolds`): a dead member never holds the party (the
// user, 2026-11-10), and nor does a member reviving or escaping home. The walk tells and asks the
// registry `createPartyConvoys` records for its state, as the coordinator passes its party registry.
const {createRegistry}=require('../../runtime/hooks/registry.ts');
const {installCoordinatorMovement}=require('../../runtime/movement/coordinator/runtime.ts');
const {createPartyConvoys}=require('../../runtime/movement/coordinator/walk.ts');
const {survivalHolds}=require('../../runtime/coordinator/survival/install.ts');
const lifecycleHolds=require('../../runtime/lifecycle/coordinator/lease.ts').memberHolds;
function held(p,answer,escaping=()=>false){
 // The coordinator's clock reads at the newest report.
 const hooks=createRegistry(),clock=()=>Math.max(...Object.values(p.statuses).map(s=>s.seenAt));
 const partyConvoys=createPartyConvoys(p,{listeners:hooks,now:clock,nextCommand:()=>p.nextCommandId++,activeNames:()=>Object.keys(p.statuses),
  intent:()=>({revision:0}),resolve:location=>location,persist(){}});
 installCoordinatorMovement(hooks,()=>({state:p,partyConvoys}),{time:async()=>0,statuses:()=>p.statuses});
 hooks.register({name:'core:test-lifecycle',folder:'core',author:'test',holder:'13',summary:'test',hooks:{'member.holder':({member})=>lifecycleHolds(member,
  {now:clock,report:name=>p.statuses[name],worker:()=>undefined})}});
 hooks.register({name:'core:test-survival',folder:'core',author:'test',holder:'05',summary:'test',hooks:{'member.holder':ask=>survivalHolds(p,ask,'party:A',escaping)}});
 const told=[];hooks.register({name:'core:test-listener',folder:'core',author:'test',summary:'test',
  hooks:{'walk.member':notice=>told.push(notice),...(answer?{'member.holder':answer}:{})}});
 return {hooks,told};
}
scenarioTable('member.holder names the holder, and the rally waits on it (RR3, RR4)', fixture, [
 ['each holder answers from its own fact, and a walking member has none', p=>{
  const {hooks}=held(p),ask=member=>hooks.walks.holders({group:null,member,at:p.statuses[member].seenAt}).map(h=>h.owner+':'+h.reason+':'+h.coming+':'+h.endsOn);
  assert.deepEqual(ask('B'),[]);
  p.statuses.B.rip=true;assert.deepEqual(ask('B'),['05:dead:false:survival.memberRecovery']);
  p.statuses.B.rip=false;p.statuses.B.consoleMaintenance={id:'u1',held:true};assert.deepEqual(ask('B'),['13:paused:true:lifecycle.holdChanged']);
  p.statuses.B.consoleMaintenance=null;p.statuses.B.movementLive={kind:'manual',owner:'click',tier:'manual'};
  assert.deepEqual(ask('B'),['02:manual control:true:journey.ended']);
  p.statuses.B.movementLive=null;p.statuses.B.movementClick={walking:true};assert.deepEqual(ask('B'),['02:manual control:true:journey.ended']);
  // A report that names the survival owner's live request as its hold is coming until the report changes.
  p.statuses.B.movementClick=null;p.statuses.B.commandHold={owner:'05',reason:'death-recovery death:B'};
  assert.deepEqual(ask('B'),['05:death-recovery death:B:true:report']);
 }],
 // The revived member's walk back is its own: its death recovery asks its group task and walks there
 // (respawn-recovery "live respawn state starts the farm return once the group task answers"), and
 // the walk it left keeps its phase and members (1.5 row 6).
 ['a dead member leaves the walk and the party goes on; its revival changes nothing in the walk', p=>{
  const {told}=held(p);const c=p.activeConvoy;p.statuses.B.rip=true;
  p.statuses.A.seenAt=p.statuses.B.seenAt=2000;p.step(2000);
  assert.deepEqual(c.participants,['A']);assert.equal(p.commands.B,undefined,'the walk\'s command goes with the member');
  assert.deepEqual(told.map(n=>n.member+':'+n.change),['B:left']);
  for(const at of [3000,4000]){p.statuses.A.seenAt=at;p.step(at);}
  assert.equal(c.phase,'shared-prepare','the walk goes on without B');
  p.statuses.B.rip=false;for(const at of [5000,6000]){for(const n of ['A','B'])p.statuses[n].seenAt=at;p.step(at);}
  assert.deepEqual(c.participants,['A']);assert.equal(c.phase,'shared-prepare');assert.equal(p.commands.B,undefined);
  assert.deepEqual(told.map(n=>n.member+':'+n.change),['B:left']);
 }],
 // Halloween Mr. Pumpkin row (live run on a4884e05f): the warrior leading an event walk died in
 // route preparation, and the priest left leading it kept the command naming the warrior, so it
 // waited for a route only the leader publishes ("Waiting for E2EPriest to publish the return
 // route") for the rest of the row.
 ['a leader that leaves in route preparation hands the route to the member left leading it', p=>{
  held(p);prepare(p);const c=p.activeConvoy,version=c.routeVersion;
  assert.equal(p.commands.B.leader,'A');
  p.statuses.A.rip=true;
  for(const at of [2000,3000,4000]){for(const n of ['A','B'])p.statuses[n].seenAt=at;
   const command=p.commands.B;
   if(command)p.statuses.B.convoyNavigation={id:c.id,epoch:c.epoch,commandId:command.id,navigationRevision:0,runtimeId:'B',
    phase:command.phase==='shared-hold'?'held':'waiting-for-route'};
   p.step(at);}
  assert.deepEqual(c.participants,['B']);assert.equal(c.leader,'B');
  assert.equal(c.phase,'shared-prepare');assert.ok(c.routeVersion>version,'the new leader prepares a route of its own');
  assert.equal(p.commands.B.leader,'B','the member left leading the walk publishes its route');
 }],
 // The walk records each member's life at its admission, and a later life (the survival owner's
 // `survival.life`) lets the member go with code `died`, before any holder is asked. Written in the
 // leftovers pass; the end run runs it first.
 ['a member whose life passes the one the walk admitted leaves with code died (1.5 row 6)', p=>{
  const {hooks,told}=held(p);const c=p.activeConvoy;let life=0;
  hooks.register({name:'core:test-life',folder:'core',author:'test',summary:"05's life.",hooks:{'survival.life':n=>n==='B'?life:0}});
  p.statuses.A.seenAt=p.statuses.B.seenAt=2000;p.step(2000);
  assert.deepEqual(c.participants,['A','B'],'the same life keeps the member');
  life=2500;p.statuses.A.seenAt=p.statuses.B.seenAt=3000;p.step(3000);
  assert.deepEqual(c.participants,['A']);
  assert.deepEqual(told.map(n=>n.member+':'+n.change+':'+n.code+':'+n.by),['B:left:died:rule:T1']);
 }],
 // Survival's holds. A member the party escape owns, or whose own death recovery runs after
 // its respawn, is not coming, so the walk goes on without it; the escape's regroup walk and the
 // death recovery's farm return are survival's own walks and hold their members only by death.
 ["a member escaping home is not coming, and a reviving member neither; survival's own walk keeps them", p=>{
  let escaping=false;const c=p.activeConvoy;
  const {hooks,told}=held(p,null,name=>escaping&&name==='B'),ask=member=>hooks.walks.holders({group:'party:A',member,at:p.statuses[member].seenAt}).map(h=>h.owner+':'+h.reason+':'+h.coming+':'+h.endsOn);
  escaping=true;assert.deepEqual(ask('B'),['05:escaping:false:survival.escapeEnded']);
  // On survival's own escape walk the escaping member is
  // coming, in survival's own answer; movement adds no row for survival.
  c.purpose='escape-recovery';assert.deepEqual(ask('B'),['05:escaping:true:survival.escapeEnded'],"the escape's regroup walk keeps its member");
  c.purpose=null;escaping=false;p.statuses.B.recovery={stage:'recovery-waiting'};assert.deepEqual(ask('B'),['05:reviving:false:survival.memberRecovery']);
  c.purpose='death-recovery';assert.deepEqual(ask('B'),[],"the recovery's farm return keeps its member");
  c.purpose=null;p.statuses.B.recovery={stage:'recovery-complete'};assert.deepEqual(ask('B'),[],'a finished recovery holds nothing');
  escaping=true;p.statuses.A.seenAt=p.statuses.B.seenAt=2000;p.step(2000);
  assert.deepEqual(c.participants,['A'],'the walk goes on without the escaping member');
  assert.deepEqual(told.map(n=>n.member+':'+n.change),['B:left']);
 }],
 ['two holds wait for both, and the walk goes on without a member once any holder says it is not coming', p=>{
  let coming=true;
  const {told}=held(p,({member})=>member==='B'?[{owner:'01',reason:'live trip',coming:true,endsOn:'task.ended'},
   {owner:'05',reason:'escaping',coming,endsOn:'survival.escapeEnded'}]:[]);
  const c=p.activeConvoy;Object.assign(p.statuses.B,{x:400,moving:false});
  for(const at of [2000,3000,4000,5000]){for(const n of ['A','B'])p.statuses[n].seenAt=at;p.step(at);}
  assert.deepEqual(c.participants,['A','B']);assert.equal(c.phase,'assemble');
  coming=false;p.statuses.A.seenAt=p.statuses.B.seenAt=6000;p.step(6000);
  assert.deepEqual(c.participants,['A']);assert.equal(p.commands.B,undefined,'the walk\'s command goes with the member');
  assert.deepEqual(told.map(n=>n.member+':'+n.change),['B:left']);
  for(const at of [7000,8000]){p.statuses.A.seenAt=at;p.step(at);}
  assert.equal(c.phase,'shared-prepare','the walk goes on without B');
 }],
 // The user's decision of 2026-11-17 (decisions.md): a member the console already knows is gone, its
 // game connection offline or its reports stopped past the walk reading, stops holding the walk even
 // while a holder says it is coming. The walk lets it go, tells the bound record, and takes it back
 // with the walk's phase command when it reports online again. Isolated: a live row cannot drop one
 // member's game socket while a holder keeps it coming.
 ['a silent member a holder keeps coming leaves the walk, reports the bound, and comes back on its next report', p=>{
  const {boundFirings}=require('../../runtime/status/coordinator/bounds.ts'),fired=()=>boundFirings().counts.walkMemberSilence||0,before=fired();
  const {told}=held(p,({member})=>member==='B'?[{owner:'01',reason:'live trip',coming:true,endsOn:'task.ended'}]:[]);
  const c=p.activeConvoy;
  p.statuses.B.eventFeedConnected=false;p.statuses.A.seenAt=p.statuses.B.seenAt=2000;p.step(2000);
  assert.deepEqual(c.participants,['A'],'an offline member held the walk');
  assert.equal(p.commands.B,undefined);assert.equal(fired(),before+1,'the silence did not report');
  p.statuses.B.eventFeedConnected=true;p.statuses.A.seenAt=p.statuses.B.seenAt=3000;p.step(3000);
  assert.deepEqual(c.participants,['A','B'],'the member did not come back on its report');
  assert.equal(p.commands.B?.convoyId,c.id,'the member came back with no walk command');
  // Reports that stop past the walk reading let it go the same way.
  p.statuses.A.seenAt=60000;p.step(60000);
  assert.deepEqual(c.participants,['A'],'a member whose reports stopped held the walk');
  assert.equal(fired(),before+2);
  p.statuses.B.seenAt=60000;p.step(60000);
  assert.deepEqual(c.participants,['A','B']);
  assert.deepEqual(told.map(n=>n.member+':'+n.change),['B:left','B:rejoined','B:left','B:rejoined']);
 }],
]);

// GAME_CHEST_REACH: the walk's defence loot barrier reads the leader's
// loot report within the chest reach less the distance the leader may have walked since it reported,
// as the Hunt's loot barrier does (red: a report 2 s old at 300 units counted at the full 400).
test('a defending walk does not accept a stale leader loot report the chest reach less its drift leaves out', () => {
  const defense = require('../../runtime/movement/coordinator/defense.ts');
  const p = fixture(), c = p.activeConvoy;
  Object.assign(c, { phase: 'defending', defenseAt: 900, completed: [], loot: { id: 'L1', after: 500, realm: ':USII', map: 'main', in: 'main', x: 0, y: 0, complete: false } });
  for (const s of Object.values(p.statuses)) { s.seenAt = 3000; s.convoyNavigation.phase = 'held'; }
  Object.assign(p.statuses.A, { x: 300, convoyLoot: { id: 'L1', observedAt: 1500, realm: ':USII', map: 'main', in: 'main', complete: true } });
  defense.step(p, 5000, (s, walk, phase, name) => ({ id: 99, phase, name }));
  assert.deepEqual([c.phase, c.loot?.complete], ['defending', false], 'the 57 speed leader may be 114 units on: 286 is the reach');
});
