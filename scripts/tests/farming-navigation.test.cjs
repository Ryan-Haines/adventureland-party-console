const test = require('node:test');
const assert = require('node:assert/strict');
const cave = { map: 'cave', x: -194, y: -461 };
const forest = { map: 'main', x: 900, y: 900 };
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture,failRound}=require('./fixtures/farming-navigation-scenario.cjs');

// Every point return keeps its members until 100 units from the checkpoint, the Halloween
// returns' physical arrival (halloween-return-arrival.ts). The coordinator once released an
// event return at 180 units and left a member stopped short (step 8c item 27).
test('a point return keeps its convoy until its members stand within 100 units of the checkpoint', ()=>{
 for(const event of ['mrgreen','mrpumpkin','slenderman']) {
  const t=fixture(),owner={...t.cycle(),event};
  t.nav.dispatch(owner,'event-return',t.nav.members());
  const convoy=t.party.activeConvoy;
  for(const name of t.nav.members())Object.assign(t.party.statuses[name],{map:cave.map,x:cave.x+107.55,y:cave.y});
  assert.equal(t.nav.reconcile(owner,'event-return'),false,event);
  assert.equal(t.party.activeConvoy,convoy,event);
  for(const name of t.nav.members())t.party.statuses[name].x=cave.x+90;
  assert.equal(t.nav.reconcile(owner,'event-return'),true,event);
 }
 const t=fixture(),owner=t.cycle();t.nav.dispatch(owner,'anniversary-return',t.nav.members());
 for(const name of t.nav.members())Object.assign(t.party.statuses[name],{map:cave.map,x:cave.x+150,y:cave.y});
 assert.equal(t.nav.reconcile(owner,'anniversary-return'),false,'an anniversary return 150 units short still owns its members');
});

scenarioTable('an anniversary round aborts on a merchant failure and releases the party without losing other work (MOV-143)', fixture, [
 ['merchant missing-target report releases all fighters before expiry and preserves merchant work', t=>{
 t.party.commands.M={ type:'merchant-self-improve' };
  assert.equal(failRound(t).aborted,true);
  assert.equal(t.starts(),1); assert.deepEqual(t.party.activeConvoy.participants,['L','F','P']);
  assert.equal(t.party.commands.M.type,'merchant-self-improve');
  assert.equal(t.party.anniversary.eventCycle.endsAt,1300000);
  assert.equal(t.party.anniversary.abortedRounds.round.reason,'target-missing');
  assert.equal(failRound(t).duplicate,true); assert.equal(t.starts(),1);
 }],
 ['timeout without success and unreachable targets also release the round', ()=>{
  for(const failureReason of ['kiss-timeout','target-unreachable']) {
    const t=fixture(); assert.equal(failRound(t,{character:'F',failureReason}).aborted,true);
    assert.equal(t.starts(),1);
  }
 }],
 ['stale round, target, member and revision cannot abort current navigation', ()=>{
  for(const changes of [{round:'old'}, {target:'other'}, {character:'Solo'}, {navigationRevision:4}, {failureReason:'network-error'}]) {
    const t=fixture(); assert.equal(failRound(t,changes).aborted,false); assert.equal(t.starts(),0);
  }
  const t=fixture(); t.nav.invalidate(['F'],'manual cancel');
  assert.equal(failRound(t,{character:'F',navigationRevision:1}).aborted,false);
 }],
 ['abort preserves cancelled and offline farming waypoints', t=>{
 t.nav.invalidate(['F'],'manual cancel'); t.offline('P');
  failRound(t); assert.deepEqual(t.party.activeConvoy.participants,['L']);
  assert.deepEqual(t.party.deferredEventReturns.P.checkpoint,cave);
  assert.equal(t.party.deferredEventReturns.F,undefined);
 }],
 ['abort persists through serialization and prevents staging or preemption of the return', t=>{
 failRound(t);
  t.party.anniversary=JSON.parse(JSON.stringify(t.party.anniversary));
  assert.equal(failRound(t).duplicate,true);
  const convoy=t.party.activeConvoy;
  assert.equal(t.post('anniversary/navigation-preempt',{character:'L',navigationRevision:0,round:'round'}).body.skipped,true);
  assert.equal(t.post('anniversary/staging',{character:'L',navigationRevision:0,round:'round',
    startsAt:1000000,endsAt:1300000,map:'main',x:0,y:0}).body.skipped,true);
  assert.equal(t.party.activeConvoy,convoy);
 }],
 ['abort releases a featured-member hold but preserves another combat event owner', t=>{
 t.party.anniversary.eventCycle.target='L';
  assert.equal(failRound(t,{target:'L'}).aborted,true); assert.equal(t.starts(),1);
  const u=fixture(); u.party.anniversary.eventCycle.combatHandoffAt=1000000;
  assert.equal(failRound(u).aborted,true); assert.equal(u.starts(),0);
  assert.ok(u.party.anniversary.eventCycle.abortedAt);
 }],
 ['a late merchant failure skips further kisses without replacing an already dispatched return', t=>{
 t.context.dispatchAnniversaryReturn(true);
  const convoy=t.party.activeConvoy;
  assert.equal(failRound(t).aborted,true);
  assert.equal(t.party.activeConvoy,convoy);assert.equal(t.starts(),1);
 }],
 ['completed anniversary visits retry after temporary movement clears, before the five-minute deadline', t=>{
 t.party.anniversary.returnReady={L:{},F:{},P:{}};
 t.party.activeConvoy={id:'busy',purpose:'manual'};
 t.context.anniversaryReturns.tick();assert.equal(t.starts(),0);
 t.party.activeConvoy=null;t.advance(1000);t.context.anniversaryReturns.tick();
 assert.equal(t.starts(),1);assert.equal(t.party.anniversary.eventCycle.returnReason,'party completed anniversary visits');
 }],
 ['a failed approach the character has not ended does not release the party', t=>{
 assert.equal(failRound(t,{attempt:1,ended:false}).aborted,false);
 assert.equal(t.party.anniversary.eventCycle.abortedAt,undefined);
 }],
 ['previous-round kiss buffs cannot end staging for the upcoming round', t=>{
 const  cycle = t.party.anniversary.eventCycle;
  cycle.startsAt += 180000;
  for (const name of t.nav.members()) t.context.reconcileAnniversaryReturnFromStatus(name, {
    conditions: [{ id: 'anniversary_kiss' }], anniversaryState: { round: 'old-round' },
  });
  assert.equal(Object.keys(t.party.anniversary.returnReady).length, 0);
  assert.equal(t.context.dispatchAnniversaryReturn(true), false);
  assert.equal(t.starts(), 0);
 }],
 ['a featured party member holds the party while another member shows its visit ticket', t=>{
 const  cycle = t.party.anniversary.eventCycle;
  cycle.target = 'L';
  t.party.anniversary.returnReady = { L: {}, F: {}, P: {} };
  t.party.statuses.F.anniversaryVisit = { id: 'ticket' };
  assert.equal(t.context.dispatchAnniversaryReturn(true), false);
  delete t.party.statuses.F.anniversaryVisit;
  assert.equal(t.context.dispatchAnniversaryReturn(false), true);
  assert.ok(t.logs.includes('Anniversary featured hold complete: every party visit claimed; returning to saved farming waypoints'));
 }],
]);

scenarioTable('a cleared focus cancels every party waypoint and keeps independent and merchant work (MOV-142)', fixture, [
 ['leader focus clear invalidates every party waypoint and preserves independent and merchant work', t=>{
  t.party.characterLocations.F = { ...forest };
  t.party.commands.M = { type: 'merchant-self-improve' };
  t.party.eventSessions.L = { checkpoint: cave, waypoints: t.nav.capture(), participants: t.nav.members() };
  t.party.deferredEventReturns.F = { checkpoint: forest };
  assert.equal(t.post('focus', { character: 'L', monsterFocus: [] }).code, 200);
  for (const name of ['L', 'F', 'P']) {
    assert.equal(t.nav.waypoint(name), null);
    assert.equal(t.nav.location(t.party.anniversary.eventCycle, name), null);
  }
  assert.equal(t.party.eventSessions.L.checkpoint, null);
  assert.equal(t.party.deferredEventReturns.F.checkpoint, null);
  assert.deepEqual(t.nav.waypoint('Solo'), forest);
  assert.equal(t.party.commands.M.type, 'merchant-self-improve');
 }],
]);

// Separate: the live restored-Town row, where the player's travel arrived while the priest's Town
// was still pending. The release kept the priest's held Town command, which outranked the walk's
// write, so the walk lost its owner ("Convoy owner-lost: E2EPriest travel replaced by town-party").
test("a player's walk releases its members from the manual Town with their Town commands", () => {
  const t = fixture();
  // The party Town as its route writes it (movement/coordinator/routes.ts `town`).
  t.party.townCycle = { id: 'town-1', pending: ['L', 'F', 'P'], startedAt: 1, revisions: {} };
  for (const name of ['L', 'F', 'P']) t.party.commands[name] = { id: t.party.nextCommandId++, type: 'town-party', cycleId: 'town-1' };
  t.nav.authorize(['L', 'F'], { map: 'main', x: 0, y: 350 }, true);
  assert.deepEqual(['L', 'F'].map(name => t.party.commands[name]), [undefined, undefined]);
  assert.deepEqual(t.party.townCycle.pending, ['P']);
  assert.equal(t.party.commands.P.type, 'town-party');
  t.nav.authorize(['P'], { map: 'main', x: 0, y: 350 }, true);
  assert.equal(t.party.commands.P, undefined);
  assert.equal(t.party.townCycle, null);
});
