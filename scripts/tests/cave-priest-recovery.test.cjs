const assert = require('node:assert/strict');
const {installCaveRecovery} = require('../../runtime/characters/survival/cave-revival.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture,coordinator,priestRecovery}=require('./fixtures/cave-priest-scenario.cjs');
scenarioTable("the Cave priest revives a dead member once, within the Essence and MP it holds (MOV-103)", ()=>fixture, [
 ['peaceful preparation heals the grave, waits for authorization, casts once and observes completion', async fixture=>{
  const f=fixture();assert.equal(f.client.reserved(),true);await f.client.tick();assert.deepEqual(f.calls,['heal']);
  assert.equal(f.client.report().phase,'ready');await f.client.tick();assert.equal(f.calls.length,1);
  f.assignment.authorized=true;f.client.receive(f.assignment);await f.client.tick();assert.deepEqual(f.calls,['heal','revive']);
  await f.client.tick();assert.equal(f.calls.length,2);
  f.target.c.revival={f:'P'};assert.equal(f.client.report().phase,'reviving');
  delete f.target.c.revival;f.target.rip=false;assert.equal(f.client.report().phase,'complete');}],
 ['combat recovery yields to living healing and preserves the existing MP reserve', async fixture=>{
  const f=fixture();f.set.fighting(true);f.set.healing(true);assert.equal(f.client.reserved(),false);await f.client.tick();assert.equal(f.calls.length,0);
  f.set.healing(false);await f.client.tick();assert.deepEqual(f.calls,['heal']);
  f.actor.mp=500;f.assignment.authorized=true;await f.client.tick();assert.match(f.client.report().reason,/MP/);
  f.actor.mp=850;await f.client.tick();assert.deepEqual(f.calls,['heal','revive']);}],
 ['out of combat waits for regeneration without imposing a combat reserve', async fixture=>{
  const f=fixture();f.target.hp=100;f.actor.mp=499;f.assignment.authorized=true;
  await f.client.tick();assert.equal(f.calls.length,0);f.actor.mp=500;await f.client.tick();assert.deepEqual(f.calls,['revive']);}],
 ['journal survives reload, unknown outcomes never repeat consumption, observed channel reconciles them', async fixture=>{
  const f=fixture();f.target.hp=100;f.assignment.authorized=true;
  f.ports.revive=async()=>{f.calls.push('revive');throw Error('network timeout');};
  await f.client.tick();assert.equal(f.client.report().phase,'uncertain');
  const reload=installCaveRecovery(f.ports);reload.receive(f.assignment);await reload.tick();assert.deepEqual(f.calls,['revive']);
  f.target.c.revival={f:'P'};assert.equal(reload.report().phase,'reviving');
  delete f.target.c.revival;assert.equal(reload.report().phase,'failed');await reload.tick();assert.equal(f.calls.length,1);}],
 ['failed persistence cannot dispatch Revive', async fixture=>{
  const f=fixture();f.target.hp=100;f.assignment.authorized=true;f.ports.write=()=>{throw Error('full');};
  await f.client.tick();assert.equal(f.calls.length,0);}],
 ['explicit rejection and interrupted revival fall back without another Essence attempt', async fixture=>{
  const f=fixture();f.target.hp=100;f.assignment.authorized=true;
  f.ports.revive=async()=>{f.calls.push('revive');throw {reason:'hp'};};
  await f.client.tick();assert.equal(f.client.report().phase,'failed');await f.client.tick();assert.equal(f.calls.length,1);}],
 ['priest dying or losing Essence after authorization releases Nera without consuming', async fixture=>{
  for (const dead of [true,false]) {
    const f=fixture();f.target.hp=100;f.assignment.authorized=true;
    if(dead)f.actor.rip=true;else f.set.essence(false);
    await f.client.tick();assert.equal(f.client.report().phase,'failed');assert.equal(f.calls.length,0);
  }}],
 ['timeout-shaped rejections remain uncertain and late observed revival wins', async fixture=>{
  const f=fixture();f.target.hp=100;f.assignment.authorized=true;
  f.ports.revive=async()=>{f.calls.push('revive');throw {reason:'timeout'};};
  await f.client.tick();assert.equal(f.client.report().phase,'uncertain');
  f.client.receive(f.assignment);await f.client.tick();assert.equal(f.calls.length,1);
  f.target.rip=false;assert.equal(f.client.report().phase,'complete');}],
 ['only peaceful recovery approaches the grave and votes, stale control, priest death and missing Essence block actions', async fixture=>{
  const f=fixture();f.set.range(false);assert.equal(f.client.move(),true);
  f.set.fighting(true);assert.equal(f.client.move(),false);f.set.fighting(false);f.set.range(true);
  f.cave.paused=true;await f.client.tick();f.cave.paused=false;
  f.actor.rip=true;await f.client.tick();f.actor.rip=false;
  f.set.essence(false);await f.client.tick();f.set.essence(true);
  f.set.advance(f.assignmentAge+1);await f.client.tick();assert.deepEqual(f.calls,['move']);}],
 // SV52 and SV42: the Cave revival's install
 // (cave-revival.ts `createCaveRevival`) tells `survival.reviving` once at each change of its
 // report's phase, read where its tick reports, so the revival's own decisions stay unedited.
 ["the revival's phase change is noticed", async fixture=>{
  const f=fixture();f.target.hp=100;const {install,told}=f.revival();
  install.receive({...f.assignment,authorized:true});
  await install.tick();await install.tick();
  f.target.c.revival={ms:3000};await install.tick();
  f.target.rip=false;delete f.target.c.revival;await install.tick();
  assert.deepEqual(told,[['survival.reviving','ready'],['survival.reviving','dispatched'],['survival.reviving','reviving'],['survival.reviving','complete']]);}],
]);
scenarioTable("the coordinator authorizes one priest revival per death and keeps Nera available", ()=>coordinator, [
 ['coordinator assigns one priest, persists one authorization per death, and blocks concurrent Nera', coordinator=>{
  const f=coordinator();f.service.reconcile(f.d);const a=f.d.priestRecovery;assert.equal(a.priest,'P');
  f.party.statuses.P.dungeon.recovery={...f.party.statuses.P.dungeon.recovery,id:a.id,phase:'ready'};
  f.service.reconcile(f.d);assert.equal(f.d.priestRecovery.authorized,true);assert.throws(()=>f.service.manual(f.d),/unresolved/);
  const restarted=priestRecovery(f.party);restarted.reconcile(f.d);assert.equal(f.d.priestRecovery.id,a.id);
  f.party.statuses.P.dungeon.recovery.phase='failed';restarted.reconcile(f.d);assert.equal(f.d.priestRecovery.id,a.id);
  restarted.manual(f.d);assert.equal(f.d.manualRecovery,true);assert.equal(f.d.priestRecovery,undefined);}],
 ['manual Nera cancels preparation before authorization, and the next death gets a new identity', coordinator=>{
  const f=coordinator();f.service.reconcile(f.d);const id=f.d.priestRecovery.id;
  f.service.manual(f.d);f.service.reconcile(f.d);assert.equal(f.d.priestRecovery,undefined);
  f.party.statuses.W.dungeon.alive=true;f.service.reconcile(f.d);
  f.party.statuses.W.dungeon.alive=false;f.service.reconcile(f.d);assert.notEqual(f.d.priestRecovery.id,id);}],
 ['fallen priest has priority and missing consumables leave Nera available', coordinator=>{
  const f=coordinator();f.party.statuses.P.dungeon.alive=false;f.service.reconcile(f.d);
  assert.equal(f.d.priestRecovery.target,'P');assert.equal(f.d.priestRecovery.priest,'P2');
  f.party.statuses.P2.dungeon.recovery.essence=false;f.service.reconcile(f.d);assert.equal(f.d.priestRecovery,undefined);
  assert.doesNotThrow(()=>f.service.manual(f.d));}],
]);
