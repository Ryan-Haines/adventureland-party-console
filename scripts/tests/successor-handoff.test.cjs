const assert=require('node:assert/strict');
// No member of these fixtures is at an event: the tasks owner's `presence` answers none.
require('./helpers/requesters.cjs').publishPresence();
const {fightSelection}=require('../../runtime/coordinator/targeting/queue.ts');
const {authorizeSuccessor}=require('../../runtime/coordinator/targeting/queue.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture,clientFixture}=require('./fixtures/successor-handoff-scenario.cjs');
const monster=(id,x=80)=>({id,mtype:'stoneworm',map:'cave',in:'cave',x,y:0,priority:50});
scenarioTable("the coordinator grants a successor target only while the fight and the Hunt allow it", ()=>fixture, [
 ['locked red/yellow survive distance changes while third is optimized and acknowledgements survive', fixture=>{
 const f=fixture();const pair=f.group.pairRevision;f.members[0].status.groupedCombat.candidates=[monster('D',1),monster('C',2),monster('B',500),monster('A',400)];
 const g=f.tick();assert.deepEqual(g.queue.map(t=>t.id),['A','B','D']);assert.equal(g.pairRevision,pair);assert.equal(g.successorGrant.revoking,undefined);assert.equal(g.committed,true);
 f.death('A');assert.deepEqual(f.tick().queue.map(t=>t.id),['B','D','C']);}],
 ['count two permits one successor and stale count cannot permit another after death', fixture=>{
 const f=fixture(2);assert.ok(f.group.successorGrant);f.death('A');f.tick();f.tick();assert.equal(f.group.target.id,'B');assert.equal(f.group.successorGrant,undefined);
 f.policy.hunt.count=1;f.tick();assert.equal(f.group.successorGrant,undefined);}],
 ['count decrement and death in one report do not double-count kill', fixture=>{
 const f=fixture(3);f.death('A');f.policy.hunt.count=2;f.tick();f.tick();assert.equal(f.group.successorGrant.successor.id,'C');}],
 ['partial acknowledgements never create a grant', fixture=>{
 const f=fixture();f.advance(3100);f.policy.allowed=false;f.tick();f.policy.allowed=true;
 f.members[0].status.groupedCombat.handoff.pairAck=null;f.tick(false);assert.equal(f.group.successorGrant,undefined);}],
 ['revocation waits for every recipient or expiry before an incompatible grant', fixture=>{
 const f=fixture(),id=f.group.successorGrant.id;f.policy.allowed=false;f.tick();
 f.members[0].status.groupedCombat.handoff.revokedAck=id;f.policy.allowed=true;assert.equal(f.tick().successorGrant.revoking,true);
 for(const m of f.members)m.status.groupedCombat.handoff.revokedAck=id;
 assert.notEqual(f.tick().successorGrant?.id,id);}],
 ['coordinator activity ownership blocks grants during anniversary return and Hunt turn-in', (fixture,row)=>{
 const {coordinatorGroupedSnapshot}=require('../../runtime/coordinator/targeting/snapshot.ts');
 // The events owner's core answer reads the anniversary cycle from `events.party`.
 const {events}=require('./fixtures/coordinator-core.cjs');
 let cycle=false;
 events.party=()=>cycle?{anniversary:{eventCycle:{stagedAt:1}}}:undefined;
 row.after(()=>{events.party=()=>undefined;});
 for(const activity of ['ordinary','anniversary','convoy','turn-in']) {
  const f=fixture(3);for(const m of f.members)m.status.monsterHunt={id:'stoneworm',count:3,remainingMs:60000};
  const state={leader:'W',followers:{P:true,M:true},headlessSlots:['W','P','M'],steamMembers:[],merchantCharacter:null,
   statuses:Object.fromEntries(f.members.map(m=>[m.name,m.status])),partyFarmingMode:'default',targetMode:'hunt',
   monsterHunt:{stage:activity==='turn-in'?'returning':'farming',target:'stoneworm',participants:['W','P','M'],owner:'W',selectionLeader:'W'},
   combatLogs:{},groupedCombat:f.group};
  cycle=activity==='anniversary';
  if(activity==='convoy')state.eventReturn={};
  const ports={now:()=>f.now,recoveryGroup:()=>null,intent:()=>({revision:1}),
   owned:()=>({type:'warrior'}),prepare:m=>m,evaluate:()=>({...f.group}),pullsHeld:()=>false,rareRejections:()=>[]};
  let group=coordinatorGroupedSnapshot(state,ports);
  for(const m of f.members)m.status.groupedCombat.handoff.pairAck=group.pairRevision;
  group=coordinatorGroupedSnapshot(state,ports);
  assert.equal(!!group.successorGrant,activity==='ordinary',activity);
 }}],
 // Part 2: the grant notices, each once, with the pair and the reason.
 ['targeting.granted, targeting.revoked: the grant is issued, then revoked when the budget runs out', fixture=>{
  const f=fixture(5);
  const granted=f.told.filter(([hook])=>hook==='targeting.granted');
  assert.equal(granted.length,1,'one notice for the grant its renewals keep');
  assert.deepEqual([granted[0][1].group,granted[0][1].predecessor,granted[0][1].successor],[f.group.key,f.group.queue[0].id,f.group.queue[1].id]);
  f.policy.hunt.count=1;f.tick();f.tick();
  const revoked=f.told.filter(([hook])=>hook==='targeting.revoked');
  assert.deepEqual(revoked.map(([,p])=>p.reason),['kill budget spent'],'one notice when the revoke starts');
 }],
 ['new coordinator scope requires fresh pair acknowledgements instead of restoring grants', fixture=>{
 const f=fixture(),g=structuredClone(f.group),before=g.pairRevision;
 authorizeSuccessor({},g,f.members,f.policy,f.now);assert.notEqual(g.pairRevision,before);assert.equal(g.successorGrant,undefined);}],
 ['removed grant recipient cannot be acknowledged by a replacement runtime', fixture=>{
 const f=fixture(),id=f.group.successorGrant.id;f.policy.allowed=false;f.tick();
 for(const m of f.members)m.status.groupedCombat.handoff.revokedAck=id;
 f.members[0].status.combatSelection.runtimeId='new';
 assert.equal(f.tick().successorGrant.revoking,true);
 f.advance(3100);assert.equal(f.tick().successorGrant,undefined);}],
 ...[0,1,2,3].map((count)=>['Hunt remaining count reserves current kill: '+count, fixture=>{
 const f=fixture(count);assert.equal(!!f.group.successorGrant,count>=2);
}]),
 ...['activity','quest-expired','quest-type','missing-capability'].map((reason)=>['grant blocked or revoked for '+reason, fixture=>{
 const f=fixture(3),id=f.group.successorGrant.id;
 if(reason==='activity')f.policy.allowed=false;
 if(reason==='quest-expired')f.policy.hunt.fresh=false;
 if(reason==='quest-type')f.policy.hunt.quest='bee';
 if(reason==='missing-capability')delete f.members[0].status.groupedCombat.handoff;
 const g=f.tick();assert.equal(g.successorGrant.id,id);assert.equal(g.successorGrant.revoking,true);
}]),
]);

scenarioTable("each client promotes a granted successor on the confirmed predecessor death, and only while the grant holds", ()=>clientFixture, [
 ['three clients promote without a coordinator response and report the identical selection', clientFixture=>{
 const f=fixture(2),clients=f.members.map(()=>clientFixture(f));
 for(const {c} of clients){const g=c.death('A');assert.equal(g.target.id,'B');assert.equal(g.committed,true);assert.equal(g.selection,fightSelection(f.group.key,f.group.queue[1]));assert.equal(c.death('A'),null);}
 assert.equal(new Set(clients.map(x=>x.c.report().consumed)).size,1);
 f.death('A');const g=f.tick();for(const {c} of clients){assert.equal(c.accept(g).target.id,'B');assert.equal(c.effective().selection,g.selection);}}],
 // The grant's countdown takes off the clock difference this runtime measured, so a client whose
 // estimate of the coordinator's clock runs 400 ms behind never promotes after the grant ends there
 // (red: it promoted 2.7 s into a 3 s grant).
 ['a client with a measured clock difference ends the grant that much earlier', clientFixture=>{
 const {setClockError}=require('../../runtime/protocol/reports.ts');
 const f=fixture(2);setClockError({clock:{networkMs:800}});
 try{const x=clientFixture(f),{c}=x;x.advance(2700);assert.equal(c.death('A'),null);}
 finally{setClockError(null);}}],
 ['only matching confirmed predecessor death consumes permission', clientFixture=>{
 const {c}=clientFixture(fixture());assert.equal(c.death('missing'),null);assert.equal(c.report().consumed,null);assert.ok(c.death('A'));}],
 ['delayed predecessor snapshot cannot roll back local promotion', clientFixture=>{
 const f=fixture(),{c}=clientFixture(f);const old=structuredClone(f.group);c.death('A');assert.equal(c.accept(old).target.id,'B');}],
 ['stale receipt cannot extend monotonic expiry and wall clock rollback cannot resurrect permission', clientFixture=>{
 const f=fixture(),r=clientFixture(f);r.expire();r.wall(0);r.c.accept(structuredClone(f.group));assert.equal(r.c.death('A'),null);}],
 ['revocation and scope replacement immediately remove a local promotion', clientFixture=>{
 const f=fixture(),r=clientFixture(f);r.c.death('A');const g=structuredClone(f.group);g.seenAt++;g.successorGrant.revoking=true;
 assert.equal(r.c.accept(g).target.id,'A');assert.equal(r.c.report().revokedAck,g.successorGrant.id);assert.equal(r.c.death('A'),null);}],
 ['client reset discards every permission and acknowledgement', clientFixture=>{
 const r=clientFixture(fixture());r.c.reset();assert.equal(r.c.death('A'),null);assert.equal(r.c.report().pairAck,null);}],
 ['changed navigation/runtime scope cannot reuse a grant', clientFixture=>{
 const f=fixture(),r=clientFixture(f);const g=structuredClone(f.group);g.key='new';g.seenAt++;delete g.successorGrant;
 r.c.accept(g);assert.equal(r.c.death('A'),null);}],
 ['independent successor promotion exposes its target but waits for authoritative all-ready attack permission', clientFixture=>{
 const f=fixture(2);f.group.independentApproach=true;const {c}=clientFixture(f);
 const promoted=c.death('A');assert.equal(promoted.target.id,'B');assert.equal(promoted.selection,fightSelection(f.group.key,f.group.queue[1]));
 assert.equal(promoted.committed,false);assert.equal(c.effective().committed,false);assert.equal(c.death('A'),null);
 const waiting={...promoted,seenAt:f.now+100,committed:false};
 assert.equal(c.accept(waiting).committed,false);
 const ready={...waiting,seenAt:f.now+200,committed:true};
 assert.equal(c.accept(ready).committed,true);assert.equal(c.effective().target.id,'B');}],
 ...['expire','block','hide'].map((gate)=>['client refuses promotion on '+gate, clientFixture=>{
 const r=clientFixture(fixture());r[gate]();assert.equal(r.c.death('A'),null);
}]),
]);
