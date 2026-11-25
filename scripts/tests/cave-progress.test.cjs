const test = require('node:test');
const assert = require('node:assert/strict');
const {createDungeonJournal} = require('../../runtime/hunting/character/cave.ts');
const {caveFloorMap} = require('../../runtime/hunting/rules.ts');
const {fixture} = require('./fixtures/daily-dungeons-scenario.cjs');
// Automatic exploration through the hunting owner's Cave service (cave.ts `createCave`): a floor with a locked
// stairs down, a required room and the exit. Each walk gathers at the leader, then moves together.
function setup() {
  const f = fixture();f.active();
  const d = f.party.dailyDungeons, map = caveFloorMap('run-1', 0);
  const stairs = {id:'stairs',label:'Stairs',map,x:100,y:0,down:true,to:caveFloorMap('run-1', 1),locked:true};
  const room = {id:'required',label:'Guard camp',map,x:30,y:0,required:true};
  for (const n of d.participants) {
    Object.assign(f.party.statuses[n], {map, x:0, y:0});
    Object.assign(f.party.statuses[n].dungeon.cave, {points:[{id:'main',label:'Exit',map,exit:true,to:'main',x:0,y:0},structuredClone(stairs),structuredClone(room)]});
  }
  const ids = new Set();
  const tick = () => {f.service.reconcile();if (d.commands.W) ids.add(d.commands.W.id);};
  // Every member stands at its command's target with the command's receipt complete.
  const done = () => {for (const n of d.participants) {const s = f.party.statuses[n], c = d.commands[n];s.x = c.target.x;s.y = c.target.y;s.dungeon.action = {id:c.id,status:'complete'};}};
  const update = fn => d.participants.forEach(n => fn(f.party.statuses[n].dungeon.cave));
  const explore = enabled => f.action({action:'progress',enabled});
  const stairsIssued = () => [...ids].filter(id => id.startsWith('cave-stairs:') || id.startsWith('cave-progress:'));
  return {...f, d, map, done, update, tick, explore, stairsIssued, command: () => d.commands.W};
}

test('clears required rooms, approaches unlocked stairs and crosses exactly once',()=>{
 const f=setup();f.explore(true);f.tick();
 assert.equal(f.command().action,'gather');assert.equal(f.d.travel.target.id,'required');
 f.done();f.tick();assert.equal(f.command().action,'move');assert.equal(f.command().target.id,'required');
 f.done();f.tick();f.tick();assert.equal(f.command().action,'move');assert.equal(f.d.travel,undefined);
 f.update(c=>{c.points[1].locked=false;c.points[2].done=true;});f.tick();
 assert.equal(f.command().action,'gather');assert.equal(f.d.travel.target.id,'stairs');
 f.done();f.tick();assert.equal(f.command().action,'move');
 f.done();f.tick();assert.equal(f.command().action,'stairs');
 f.tick();f.tick();assert.equal(f.stairsIssued().length,1);
 const next=caveFloorMap('run-1',1);
 f.update(c=>{c.floor=1;c.points=[{id:'next',label:'Stairs',map:next,x:20,y:0,down:true,to:caveFloorMap('run-1',2)}];});
 for(const n of f.d.participants)f.party.statuses[n].map=next;
 f.tick();f.tick();assert.equal(f.d.travel.target.id,'next');assert.equal(f.command().action,'gather');
});
test('stairs wait for every arrival, readiness and fresh reports',()=>{
 const f=setup();f.update(c=>c.points[1].locked=false);f.explore(true);f.tick();f.done();f.tick();f.done();
 f.party.statuses.P.dungeon.ready=false;f.tick();assert.equal(f.command().action,'move');
 f.party.statuses.P.dungeon.ready=true;f.party.statuses.P.x=0;f.tick();assert.equal(f.command().action,'move');
 f.done();f.party.statuses.P.seenAt=0;f.tick();assert.equal(f.command().action,'move');
});
test('a cave choice and a fallen member hold exploration; turning it off cancels travel',()=>{
 const f=setup();f.update(c=>c.paused=true);f.explore(true);f.tick();assert.deepEqual(f.d.commands,{});
 f.update(c=>c.paused=false);f.explore(true);f.party.statuses.P.dungeon.alive=false;f.tick();assert.deepEqual(f.d.commands,{});
 f.party.statuses.P.dungeon.alive=true;f.tick();assert.equal(f.command().action,'gather');
 f.explore(false);assert.deepEqual(f.d.commands,{});
});
test('final floor completion never picks Mainland or stairs up',()=>{
 const f=setup();f.update(c=>c.points=[{id:'main',exit:true,to:'main',map:f.map,x:0,y:0},{id:'up',down:false,to:'zone_r_0',map:f.map,x:5,y:0}]);
 f.explore(true);f.tick();assert.deepEqual(f.d.commands,{});assert.match(f.d.progress.message,/Exit remains manual/);
});
test('lost stairs reply reconciles from observed next floor without dispatching again',()=>{
 let saved;const j=createDungeonJournal(()=>null,s=>saved=s);
 j.save({id:'s',action:'stairs',run:'r',target:{to:'zone_r_1'}},'uncertain');
 const restored=createDungeonJournal(()=>saved,()=>{});
 restored.reconcile({run:'r',floor:0},'W');assert.equal(restored.blocked(),true);
 restored.reconcile({run:'r',floor:1},'W');assert.equal(restored.blocked(),false);
});
// Cave talk row (live run on 1166d93dc): the repair ladder keeps no count, so each
// repair replaces the failed command with a new travel command and a failed receipt stands only
// until the next repair. Retry is one more attempt of the travel the ladder is repairing, as the
// earlier console's Retry restarted travel, so a travel in progress starts again with no failed
// receipt in sight.
test('Retry starts a travel in progress again while its repair has replaced the failed command',()=>{
 const f=setup();f.explore(true);f.tick();
 const before=f.d.travel.serial;
 assert.equal(f.command().action,'gather');
 f.action({action:'retry',run:f.d.run});
 assert.equal(f.d.travel.serial,before+1);
 assert.equal(f.command().action,'gather','the travel gathers again');
});
// The fast combat channel (status/coordinator/channel.ts) refreshes seenAt without a reconcile, so
// the report a waiting ladder needs can be in hand when the player's Retry runs the action's
// reconcile. Retry is then the travel's one new attempt.
test('Retry with a waiting repair ladder due starts exactly one travel',()=>{
 const f=setup();f.explore(true);f.tick();f.done();f.tick();
 assert.equal(f.command().action,'move');
 const fail=()=>{for(const n of f.d.participants)f.party.statuses[n].dungeon.action={id:f.d.commands[n].id,status:'failed'};};
 // The receipt ladder climbs 'same' (a new travel), then 'other' (walking alone), then waits.
 fail();f.tick();assert.equal(f.d.travel.serial,2);
 fail();f.tick();assert.equal(f.d.travel.serial,2);
 fail();f.tick();assert.notEqual(f.d.travel.waitAt,undefined);
 const before=f.d.travel.serial;
 f.advance(100);for(const n of f.d.participants)f.party.statuses[n].seenAt=f.now();
 f.action({action:'retry',run:f.d.run});
 assert.equal(f.d.travel.serial,before+1);
 assert.equal(f.command().id,`cave-assemble:${f.d.run}:${before+1}:W`);
});
