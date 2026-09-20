const test = require('node:test');
const assert = require('node:assert/strict');
const { step, hold, signal, validReport } = require('../convoy-navigation.cjs');
function fixture() {
  const c = { id: 'test', epoch: 7, phase: 'assemble', participants: ['A', 'B'],
    rally: { map: 'main', x: 0, y: 0 }, location: { map: 'cave', x: 120, y: 0 }, slowestSpeed: 57, completed: [] };
  const p = { activeConvoy: c, commands: {}, statuses: {}, nextCommandId: 10 };
  for (const [i,name] of c.participants.entries()) {
    p.commands[name] = { id: i+1, type: 'party-monster-travel', convoyId: c.id, epoch: 7 };
    p.statuses[name] = { seenAt: 1000, map: 'main', x: 0, y: 0, speed: 57, moving: false, rip: false,
      convoyNavigation: { id: 'test', epoch: 7, commandId: i+1, phase: 'assembled', runtimeId: name } };
  }
  require('./helpers/travel-observations.cjs').observeTravel(p.statuses);
  return p;
}
function prepare(p) { step(p,1000); step(p,1600); assert.equal(p.activeConvoy.phase,'prepare'); }
function ready(p, name, now=2000) {
  const s=p.statuses[name]; s.seenAt=now;
  s.convoyNavigation={ ...s.convoyNavigation, commandId:p.commands[name].id, routeReady:true, phase:'route-ready' };
}
test('lost assembly command times out despite fresh stationary assembled reports', () => {
  const p=fixture(); delete p.commands.B;
  step(p,1000);
  for(const s of Object.values(p.statuses))s.seenAt=30999;
  step(p,30999); assert.equal(p.activeConvoy.phase,'assemble');
  for(const s of Object.values(p.statuses))s.seenAt=31000;
  step(p,31000);
  assert.equal(p.activeConvoy.failureCode,'assembly-timeout');
  assert.equal(p.activeConvoy.blockers.B.reason,'command-lost');
});
test('assembly repair cannot overwrite a newer manual command', () => {
  const p=fixture(); p.commands.B={id:50,type:'character-travel'};
  step(p,1000); for(const s of Object.values(p.statuses))s.seenAt=31000; step(p,31000);
  assert.equal(p.commands.B.id,50);
});
test('phase dispatch binds the current navigation revision',()=>{
  const p=fixture();p.navigationIntents={A:{revision:9},B:{revision:11}};
  prepare(p);assert.equal(p.commands.B.navigationRevision,11);
  assert.equal(p.activeConvoy.expected.A.commandId,p.commands.A.id);
});
test('return plan advances through synchronized town and walk legs without accepting old acknowledgements',()=>{
  const p=fixture();Object.assign(p.activeConvoy,{leader:'A',returnRouting:true,location:{map:'main',x:120,y:0}});
  step(p,1000);step(p,1600);assert.equal(p.activeConvoy.phase,'plan-return');
  p.statuses.A.convoyNavigation={...p.statuses.A.convoyNavigation,commandId:p.commands.A.id,
    phase:'return-route-ready',returnPlan:[{type:'town',location:{map:'main',x:0,y:0}},{type:'walk',location:{map:'main',x:120,y:0}}]};
  step(p,1700);assert.equal(p.activeConvoy.phase,'assemble');
  step(p,1800);assert.equal(p.activeConvoy.phase,'assemble');
  for(const name of ['A','B'])p.statuses[name].convoyNavigation={...p.statuses[name].convoyNavigation,commandId:p.commands[name].id,phase:'assembled'};
  step(p,1900);step(p,2500);assert.equal(p.activeConvoy.phase,'town');
  for(const name of ['A','B'])p.statuses[name].convoyNavigation={...p.statuses[name].convoyNavigation,commandId:p.commands[name].id,phase:'towned'};
  step(p,2600);assert.equal(p.activeConvoy.legIndex,1);
  step(p,2700);assert.equal(p.activeConvoy.phase,'assemble');
  for(const name of ['A','B'])p.statuses[name].convoyNavigation={...p.statuses[name].convoyNavigation,commandId:p.commands[name].id,phase:'assembled'};
  step(p,2800);step(p,3400);assert.equal(p.activeConvoy.phase,'prepare');
  ready(p,'A',3500);ready(p,'B',3500);step(p,3500);
  for(const s of Object.values(p.statuses))s.seenAt=7500;
  step(p,7500);assert.equal(p.activeConvoy.phase,'travel');
  for(const s of Object.values(p.statuses)){s.x=120;s.convoyNavigation.phase='leg-arrived';}
  step(p,7600);assert.equal(p.activeConvoy,null);
});
test('assembly requires observed speed, stillness and 500ms stability before preparation', () => {
  const p=fixture(); p.statuses.B.speed=70; step(p,1000); assert.equal(p.activeConvoy.assembledSince,undefined);
  p.statuses.B.speed=57; step(p,1100); step(p,1599); assert.equal(p.activeConvoy.phase,'assemble');
  step(p,1600); assert.equal(p.activeConvoy.phase,'prepare');
  assert.equal(p.commands.A.phase,'prepare'); assert.equal(p.activeConvoy.departAt,undefined);
});
test('town-first convoy completes a synchronized Town phase before route preparation', () => {
  const p=fixture(); Object.assign(p.activeConvoy,{townFirst:true,nonPreemptible:true});
  step(p,1000); step(p,1600);
  assert.equal(p.activeConvoy.phase,'town');
  assert.equal(p.commands.A.phase,'town');
  assert.equal(p.commands.A.townFirst,true);
  assert.equal(p.commands.A.nonPreemptible,true);
  for(const name of ['A','B']) {
    const s=p.statuses[name]; s.seenAt=1800; s.x=-174; s.y=121;
    s.convoyNavigation={id:'test',epoch:7,commandId:p.commands[name].id,phase:'towned',runtimeId:name};
  }
  step(p,1800);
  assert.equal(p.activeConvoy.phase,'assemble');
  assert.deepEqual(p.activeConvoy.rally,{map:'main',x:-174,y:121});
  step(p,1900);
  assert.equal(p.activeConvoy.phase,'assemble','old Town heartbeats cannot trigger route preparation or a stale-owner failure');
  for(const name of ['A','B']) {
    p.statuses[name].convoyNavigation.commandId=p.commands[name].id;
    p.statuses[name].convoyNavigation.phase='assembled';
  }
  p.statuses.B.x=0;step(p,2000);assert.equal(p.activeConvoy.assembledSince,0);
  p.statuses.B.x=-174;step(p,2100);step(p,2700);
  assert.equal(p.activeConvoy.phase,'prepare');
  assert.deepEqual(p.activeConvoy.origins.A,{map:'main',x:-174,y:121});
  assert.equal(p.commands.A.phase,'prepare');
});
test('slow member blocks departure; departure signal preserves both preparation commands', () => {
  const p=fixture(); prepare(p); const a=p.commands.A, b=p.commands.B;
  ready(p,'A'); step(p,2000); assert.equal(p.activeConvoy.phase,'prepare');
  ready(p,'B',2200); step(p,2200); assert.equal(p.activeConvoy.departAt,6200);
  assert.equal(p.commands.A,a); assert.equal(p.commands.B,b);
  assert.deepEqual(signal(p,'A',2200), { id:'test',epoch:7,commandId:a.id,phase:'scheduled',
    runtimeId:'A',departAt:6200,validUntil:5200,reason:null });
});
for (const [label, mutate] of [
  ['stale member', p=>{p.statuses.B.seenAt=0;}],
  ['dead member', p=>{p.statuses.B.rip=true;}],
  ['moved member', p=>{p.statuses.B.x=20;}],
  ['speed change', p=>{p.statuses.B.speed=80;}],
  ['missing route', p=>{p.statuses.B.convoyNavigation.routeReady=false;}],
  ['runtime reload', p=>{p.statuses.B.convoyNavigation.runtimeId='new';}],
  ['lost closure', p=>{p.statuses.B.convoyNavigation=null;}],
  ['wrong command', p=>{p.statuses.B.convoyNavigation.commandId=999;}],
]) test(label+' cancels scheduled departure and retains hold commands', () => {
  const p=fixture(); prepare(p); ready(p,'A'); ready(p,'B'); step(p,2000);
  p.statuses.A.seenAt=p.statuses.B.seenAt=4500; mutate(p); step(p,4500);
  assert.equal(p.activeConvoy.phase,label==='stale member'?'observing':'failed'); assert.equal(p.activeConvoy.departAt,null);
  assert.equal(p.commands.A.phase,'hold'); assert.equal(p.commands.B.phase,'hold');
  const a=p.commands.A; step(p,6000); assert.equal(p.commands.A,a);
});
test('preparation timeout fails even when members remain connected', () => {
  const p=fixture(); prepare(p);
  for(const s of Object.values(p.statuses)) s.seenAt=61600;
  step(p,61600); assert.match(p.activeConvoy.failure,/timed out/);
});
test('coordinator restart recreates hold commands without regenerating routes', () => {
  const p=fixture(); prepare(p); hold(p,'Coordinator restarted'); p.commands={};
  step(p,3000); assert.equal(p.commands.A.phase,'hold'); assert.equal(p.activeConvoy.departAt,null);
});
test('completion and failure reports must match participant, epoch, command and runtime', () => {
  const p=fixture(); prepare(p);
  const body={ character:'A',convoyId:'test',epoch:7,commandId:p.commands.A.id,runtimeId:'A' };
  assert.equal(validReport(p,body),true);
  for(const field of ['character','convoyId','epoch','commandId','runtimeId'])
    assert.equal(validReport(p,{...body,[field]:'stale'}),false);
  hold(p,'failed'); assert.equal(validReport(p,body),false);
});
test('post-departure movement and completed members do not invalidate the convoy', () => {
  const p=fixture(); prepare(p); ready(p,'A'); ready(p,'B'); step(p,2000);
  p.activeConvoy.completed.push('A'); delete p.commands.A;
  p.statuses.B.seenAt=6000; p.statuses.B.moving=true; p.statuses.B.map='cave';
  p.statuses.B.convoyNavigation.phase='travelling';
  step(p,6000); assert.equal(p.activeConvoy.phase,'travel');
});


test('Franky exit preparation retains navigation exemption and disables combat handoff', () => {
  const p=fixture(); Object.assign(p.activeConvoy,{purpose:'franky-exit',navigationExempt:true,combatHandoffAllowed:false});
  prepare(p);
  assert.equal(p.commands.A.navigationExempt,true);
  assert.equal(p.commands.A.combatHandoffAllowed,false);
});
