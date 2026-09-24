const test = require('node:test');
const assert = require('node:assert/strict');
const {installCaveRecovery} = require('../../runtime/characters/cave-recovery.ts');
const {createPriestRecovery} = require('../../runtime/coordinator/dungeons/priest-recovery.ts');
function fixture() {
  let now=10000, saved={}, fighting=false, healing=false, essence=true, range=true;
  const actor={name:'P',ctype:'priest',map:'cave',in:'run',hp:100,max_hp:100,mp:1000,max_mp:1000,c:{}};
  const target={...actor,name:'W',ctype:'warrior',rip:true,hp:20,c:{}};
  const cave={run:'run',paused:false};const calls=[];
  const assignment={id:'run:W:1',run:'run',target:'W',priest:'P',authorized:false};
  const ports={now:()=>now,current:()=>true,actor:()=>actor,cave:()=>cave,target:()=>target,
    essence:()=>essence,fighting:()=>fighting,livingNeedsHealing:()=>healing,healingBusy:()=>false,
    cost:s=>s==='heal'?50:500,reserve:()=>350,inRange:()=>range,ready:()=>true,
    heal:async()=>{calls.push('heal');target.hp=100;},revive:async()=>{calls.push('revive');},approach:()=>calls.push('move'),
    read:()=>structuredClone(saved),write:v=>{saved=structuredClone(v);}};
  const client=installCaveRecovery(ports);client.receive(assignment);
  return {actor,target,cave,calls,assignment,ports,client,set:{fighting:v=>fighting=v,healing:v=>healing=v,essence:v=>essence=v,range:v=>range=v,advance:v=>now+=v}};
}
test('peaceful preparation heals the grave, waits for authorization, casts once and observes completion',async()=>{
  const f=fixture();assert.equal(f.client.reserved(),true);await f.client.tick();assert.deepEqual(f.calls,['heal']);
  assert.equal(f.client.report().phase,'ready');await f.client.tick();assert.equal(f.calls.length,1);
  f.assignment.authorized=true;f.client.receive(f.assignment);await f.client.tick();assert.deepEqual(f.calls,['heal','revive']);
  await f.client.tick();assert.equal(f.calls.length,2);
  f.target.c.revival={f:'P'};assert.equal(f.client.report().phase,'reviving');
  delete f.target.c.revival;f.target.rip=false;assert.equal(f.client.report().phase,'complete');
});
test('combat recovery yields to living healing and preserves the existing MP reserve',async()=>{
  const f=fixture();f.set.fighting(true);f.set.healing(true);assert.equal(f.client.reserved(),false);await f.client.tick();assert.equal(f.calls.length,0);
  f.set.healing(false);await f.client.tick();assert.deepEqual(f.calls,['heal']);
  f.actor.mp=500;f.assignment.authorized=true;await f.client.tick();assert.match(f.client.report().reason,/MP/);
  f.actor.mp=850;await f.client.tick();assert.deepEqual(f.calls,['heal','revive']);
});
test('out of combat waits for regeneration without imposing a combat reserve',async()=>{
  const f=fixture();f.target.hp=100;f.actor.mp=499;f.assignment.authorized=true;
  await f.client.tick();assert.equal(f.calls.length,0);f.actor.mp=500;await f.client.tick();assert.deepEqual(f.calls,['revive']);
});
test('only peaceful recovery approaches the grave and votes, stale control, priest death and missing Essence block actions',async()=>{
  const f=fixture();f.set.range(false);assert.equal(f.client.move(),true);
  f.set.fighting(true);assert.equal(f.client.move(),false);f.set.fighting(false);f.set.range(true);
  f.cave.paused=true;await f.client.tick();f.cave.paused=false;
  f.actor.rip=true;await f.client.tick();f.actor.rip=false;
  f.set.essence(false);await f.client.tick();f.set.essence(true);
  f.set.advance(3001);await f.client.tick();assert.deepEqual(f.calls,['move']);
});
test('journal survives reload, unknown outcomes never repeat consumption, observed channel reconciles them',async()=>{
  const f=fixture();f.target.hp=100;f.assignment.authorized=true;
  f.ports.revive=async()=>{f.calls.push('revive');throw Error('network timeout');};
  await f.client.tick();assert.equal(f.client.report().phase,'uncertain');
  const reload=installCaveRecovery(f.ports);reload.receive(f.assignment);await reload.tick();assert.deepEqual(f.calls,['revive']);
  f.target.c.revival={f:'P'};assert.equal(reload.report().phase,'reviving');
  delete f.target.c.revival;assert.equal(reload.report().phase,'failed');await reload.tick();assert.equal(f.calls.length,1);
});
test('failed persistence cannot dispatch Revive',async()=>{
  const f=fixture();f.target.hp=100;f.assignment.authorized=true;f.ports.write=()=>{throw Error('full');};
  await f.client.tick();assert.equal(f.calls.length,0);
});
test('explicit rejection and interrupted revival fall back without another Essence attempt',async()=>{
  const f=fixture();f.target.hp=100;f.assignment.authorized=true;
  f.ports.revive=async()=>{f.calls.push('revive');throw {reason:'hp'};};
  await f.client.tick();assert.equal(f.client.report().phase,'failed');await f.client.tick();assert.equal(f.calls.length,1);
});
function coordinator() {
  const party={statuses:{}};const d={phase:'active',run:'run',participants:['W','P','P2']};
  for(const n of d.participants)party.statuses[n]={map:'cave',dungeon:{alive:n!=='W',cave:{run:'run',paused:false},
    recovery:{actor:{ctype:n==='W'?'warrior':'priest',c:{}},essence:true,phase:'idle'}}};
  const service=createPriestRecovery(party,()=>{});return {party,d,service};
}
test('coordinator assigns one priest, persists one authorization per death, and blocks concurrent Nera',()=>{
  const f=coordinator();f.service.reconcile(f.d);const a=f.d.priestRecovery;assert.equal(a.priest,'P');
  f.party.statuses.P.dungeon.recovery={...f.party.statuses.P.dungeon.recovery,id:a.id,phase:'ready'};
  f.service.reconcile(f.d);assert.equal(a.authorized,true);assert.throws(()=>f.service.manual(f.d),/unresolved/);
  const restarted=createPriestRecovery(f.party,()=>{});restarted.reconcile(f.d);assert.equal(f.d.priestRecovery.id,a.id);
  f.party.statuses.P.dungeon.recovery.phase='failed';restarted.reconcile(f.d);assert.equal(f.d.priestRecovery.id,a.id);
  restarted.manual(f.d);assert.equal(f.d.manualRecovery,true);assert.equal(f.d.priestRecovery,undefined);
});
test('manual Nera cancels preparation before authorization, and the next death gets a new identity',()=>{
  const f=coordinator();f.service.reconcile(f.d);const id=f.d.priestRecovery.id;
  f.service.manual(f.d);f.service.reconcile(f.d);assert.equal(f.d.priestRecovery,undefined);
  f.party.statuses.W.dungeon.alive=true;f.service.reconcile(f.d);
  f.party.statuses.W.dungeon.alive=false;f.service.reconcile(f.d);assert.notEqual(f.d.priestRecovery.id,id);
});
test('fallen priest has priority and missing consumables leave Nera available',()=>{
  const f=coordinator();f.party.statuses.P.dungeon.alive=false;f.service.reconcile(f.d);
  assert.equal(f.d.priestRecovery.target,'P');assert.equal(f.d.priestRecovery.priest,'P2');
  f.party.statuses.P2.dungeon.recovery.essence=false;f.service.reconcile(f.d);assert.equal(f.d.priestRecovery,undefined);
  assert.doesNotThrow(()=>f.service.manual(f.d));
});

test('priest dying or losing Essence after authorization releases Nera without consuming',async()=>{
  for (const dead of [true,false]) {
    const f=fixture();f.target.hp=100;f.assignment.authorized=true;
    if(dead)f.actor.rip=true;else f.set.essence(false);
    await f.client.tick();assert.equal(f.client.report().phase,'failed');assert.equal(f.calls.length,0);
  }
});

test('timeout-shaped rejections remain uncertain and late observed revival wins',async()=>{
  const f=fixture();f.target.hp=100;f.assignment.authorized=true;
  f.ports.revive=async()=>{f.calls.push('revive');throw {reason:'timeout'};};
  await f.client.tick();assert.equal(f.client.report().phase,'uncertain');
  f.client.receive(f.assignment);await f.client.tick();assert.equal(f.calls.length,1);
  f.target.rip=false;assert.equal(f.client.report().phase,'complete');
});
