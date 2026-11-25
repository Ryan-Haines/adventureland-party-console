const { test } = require('node:test');
const assert = require('node:assert/strict');
const {fixture}=require('./fixtures/rare-hunting-client-scenario.cjs');
const {taskLadder}=require('./helpers/task-ladder.cjs');

// A failed rare walk climbs a task walk's ladder while the rare
// control lives, and the climb ends with the control. The task round starts its rung's journey
// on the next turn of the event loop.
test('a failed rare walk keeps trying while the control lives and ends with it', async ()=>{
  const r=fixture();r.entity.x=600;r.c.G={...r.c.G,maps:{main:{spawns:[[0,0]],doors:[]}}};
  const {ladders,ended,released}=taskLadder(r.c);
  let walks=0;r.c.smart_move=()=>{walks++;return Promise.reject(Error('no route'));};
  for(let i=0;i<4;i++){r.client.poll();await new Promise(resolve=>setImmediate(resolve));}
  // The round: the walk, the other route, the walk again, then the next report (no exit nearby).
  assert.equal(walks,3,'each failed rung starts the next one; no failed flag stops the walk');
  assert.equal(ladders['rare:e1'].report().rung,'wait');
  r.endControl();r.client.poll();
  assert.deepEqual(ended,['rare:e1']);assert.ok(released.includes('rare:e1'),'the climb releases its own journey');
 });

const {scenarioTable}=require('./fixtures/scenarios.cjs');
scenarioTable('the character follows its rare control only while it is current and attacks only what it may (MOV-149)', fixture, [
 ['owned committed Fairy permits basic attacks without a separate rare controller', r=>{
 const c=r.c,t={...r.entity,in:'main',server:'USII'};
 r.endControl();r.doors.walks.groupWalk.travel={phase:'defending',navigationRevision:1};c.groupedFresh=()=>true;c.groupedCombat={target:t};
 c.passingKey=e=>JSON.stringify([e.server,e.map,e.in,e.id]);
 const control={defending:true,committed:[t]};r.doors.hunt.control=()=>control;
 assert.equal(c.rareTarget(),r.entity);assert.equal(c.rareAttackAllowed(r.entity,'attack'),true);
 assert.equal(c.rareAttackAllowed(r.entity,'burst'),false);
 control.committed=[];assert.equal(c.rareTarget(),null);
 control.committed=[t];c.groupedFresh=()=>false;assert.equal(c.rareTarget(),null);
 }],
 ['a wrong instance, changed navigation or a reply with no control cannot attack Fairy', r=>{
 r.control.deployer=null;assert.equal(r.c.rareTarget(),r.entity);
 r.c.character.in='other';assert.equal(r.c.rareTarget(),null);
  r.c.character.in='main';r.c.navigationIntent.revision=2;assert.equal(r.c.rareTarget(),null);
  // The control holds until the next reply supersedes it, with no age of its own.
  r.c.navigationIntent.revision=1;r.advance(3501);assert.equal(r.c.rareTarget(),r.entity);
  r.endControl();assert.equal(r.c.rareTarget(),null);
 }],
]);
