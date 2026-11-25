// Isolated test of the movement owner's idle grid.
// Failure list first.
// Expected values are worked by
// hand from the game server: a monster in cell (floor(x / 32), floor(y / 32)) aggroes
// only a player whose own cell is within one cell of it (ghash and get_nearby_ghash,
// node/server_functions.js; set_ghash at node/server.js:14404).
const test=require('node:test'), assert=require('node:assert/strict');
const {stepSafety,chooseStep,fighting}=require('../../runtime/movement/geometry/step-safety.ts');
const {me,idle,check,pack,candidates,base}=require('./fixtures/step-safety-scenario.cjs');
const {scenarioTable}=require('./fixtures/scenarios.cjs');


scenarioTable("step safety refuses idle aggro blocks, closing attackers and terrain, and exempts the step's own target (MOV-205)", ()=>check, [
 ['failure 1: a step ending in any of the 9 cells around an idle monster is refused', check=>{
  const bee=idle('bee',40,40);
  for(const cx of [0,1,2])for(const cy of [0,1,2]){
    // The centre of each cell, walked from far outside on the diagonal.
    const to={x:cx*32+16,y:cy*32+16};
    const verdict=check({x:300,y:300},to,[bee]);
    assert.equal(verdict.safe,false,`cell ${cx},${cy}`);
    assert.equal(verdict.refusal,'idle-aggro');
    assert.deepEqual(verdict.idle,['bee']);
  }
  // The block's far corner cell, reached from the side the block does not cover.
  assert.equal(check({x:95,y:200},{x:95,y:95},[bee]).safe,false);}],
 ['failure 2: a step two cells away is allowed, where a 91 radius would refuse it', check=>{
  // At the right edge of cell 1, 33 units on is cell 3.
  assert.equal(check({x:150,y:40},{x:63.9+33,y:40},[idle('edge',63.9,40)]).safe,true);
  // At the left edge of cell 1, 70 units straight on is x 102.5, cell 3.
  assert.equal(check({x:150,y:40},{x:32.5+70,y:40},[idle('axis',32.5,40)]).safe,true);
  // A 91 radius would have refused both: the second ends 70 from the monster.
 }],
 ['failure 3: a segment that clips only a corner of the block is refused', check=>{
  // Both ends lie outside (0, 0) to (96, 96); the middle passes (92, 2).
  const verdict=check({x:80,y:-10},{x:110,y:20},[idle('bee',40,40)]);
  assert.equal(verdict.safe,false);
  assert.equal(verdict.refusal,'idle-aggro');}],
 ['failure 4: a step out of a block that holds the start is allowed', check=>{
  assert.equal(check({x:50,y:50},{x:150,y:50},[idle('bee',40,40)]).safe,true);
  // Another monster's block on the way out still refuses it.
  assert.equal(check({x:50,y:50},{x:150,y:50},[idle('bee',40,40),idle('next',130,50)]).safe,false);}],
 ['failure 5: a monster with a target, or without aggro, never blocks', check=>{
  const through=[{x:200,y:40},{x:-50,y:40}];
  assert.equal(check(...through,[idle('busy',40,40,{target:'E2EPriest'})]).safe,true);
  assert.equal(check(...through,[idle('goo',40,40,{aggro:0})]).safe,true);
  assert.equal(check(...through,[idle('none',40,40,{aggro:undefined})]).safe,true);
  // Dead and unseen monsters are not in the grid either.
  assert.equal(check(...through,[idle('dead',40,40,{dead:true})]).safe,true);
  assert.equal(check(...through,[idle('unseen',40,40,{visible:false})]).safe,true);}],
 ['failure 6: the selected target, or the boss approached, never blocks its own step', check=>{
  assert.equal(check({x:200,y:40},{x:60,y:40},[idle('bee',40,40)],{target:'bee'}).safe,true);
  assert.equal(check({x:200,y:40},{x:60,y:40},[idle('franky',40,40)],{target:'franky'}).safe,true);
  assert.equal(check({x:200,y:40},{x:60,y:40},[idle('franky',40,40),idle('add',50,60)],{target:'franky'}).safe,false);}],
 ["failure 7: the attacker rule is today\'s min(distance now, range) - 1", check=>{
  const near={id:'crab',x:0,y:0,target:me,range:50};
  // Inside its range: the step may close by less than 1 unit.
  assert.equal(check({x:40,y:0},{x:39.5,y:0},[near]).safe,true);
  const closer=check({x:40,y:0},{x:38,y:0},[near]);
  assert.equal(closer.safe,false);
  assert.equal(closer.refusal,'attacker');
  assert.deepEqual(closer.attackers,['crab']);
  // Outside its range: the step may close to range - 1.
  assert.equal(check({x:100,y:0},{x:60,y:0},[near]).safe,true);
  assert.equal(check({x:100,y:0},{x:48,y:0},[near]).safe,false);
  // The step's own target is exempt, and an attacker is never an idle monster.
  assert.equal(check({x:40,y:0},{x:10,y:0},[{...near,aggro:1}],{target:'crab'}).safe,true);}],
 ['failure 8: a missing range reads as 20', check=>{
  const attacker={id:'bee',x:0,y:0,target:me};
  assert.equal(check({x:100,y:0},{x:20,y:0},[attacker]).safe,true);
  assert.equal(check({x:100,y:0},{x:18,y:0},[attacker]).safe,false);}],
 ['failure 9: a step that fails terrain is refused before anything else', ()=>{
  const verdict=stepSafety({name:me,from:{x:0,y:0},to:{x:10,y:0},monsters:[],walkable:()=>false});
  assert.equal(verdict.safe,false);
  assert.equal(verdict.refusal,'terrain');}],
]);











scenarioTable("the step chooser takes a clear step, stands while fighting, and else the fewest idle blocks (MOV-205)", ()=>base, [
 ['failure 10: with a clear candidate the chooser never takes a risky one', base=>{
  const chosen=chooseStep([{x:60,y:72},{x:200,y:-100}],base());
  assert.deepEqual(chosen.point,{x:200,y:-100});
  assert.equal(chosen.risky,false);}],
 ['failure 11: with no clear candidate while fighting, the character stands', base=>{
  const attacker={id:'c',x:260,y:72,target:me,range:20};
  assert.equal(chooseStep(candidates,base({monsters:[...pack,attacker]})),null);
  // Its own target in range is a fight too.
  assert.equal(chooseStep([{x:60,y:72}],base({target:'t',monsters:[...pack,{id:'t',x:250,y:72,aggro:1}]})),null);}],
 ['failure 12: with no clear candidate while fighting nothing, the fewest idle blocks go', base=>{
  const chosen=chooseStep(candidates,base());
  assert.deepEqual(chosen.point,{x:90,y:130});
  assert.equal(chosen.risky,true);
  assert.deepEqual(chosen.verdict.idle,['b']);
  // Terrain and the attacker rule still hold for the least risky step.
  const walls=chooseStep(candidates,base({walkable:(from,to)=>to.y!==130}));
  assert.deepEqual(walls.point,{x:60,y:72});
  const far={id:'d',x:100,y:200,target:me,range:20};
  // Monster d targets the character from 162 away, so the character fights and stands.
  assert.equal(chooseStep(candidates,base({monsters:[...pack,far]})),null);}],
 ["failure 13: the fight test reads attackers and the target's range", ()=>{
  const at={name:me,from:{x:0,y:0},range:100};
  assert.equal(fighting({...at,monsters:[idle('a',300,0)]}),false);
  assert.equal(fighting({...at,target:'a',monsters:[idle('a',300,0)]}),false);
  assert.equal(fighting({...at,target:'a',monsters:[idle('a',90,0)]}),true);
  assert.equal(fighting({...at,monsters:[{id:'x',x:500,y:0,target:me}]}),true);
  assert.equal(fighting({...at,monsters:[{id:'x',x:500,y:0,target:me,dead:true}]}),false);
  assert.equal(fighting({...at,monsters:[{id:'x',x:500,y:0,target:me,visible:false}]}),false);}],
 // The bee field row's failure of 2026-11-04 (call budget step 1's gate): a priest whose own
 // target stood in its range took a 212-unit step, named for another target, through four idle
 // bees' blocks as the least risky step.
 ["failure 14: the character's own target in its range is a fight, whatever target the step names", base=>{
  const attacking={id:'own',x:250,y:72,aggro:1,target:'E2EPriest'};
  assert.equal(fighting({...base(),target:'other',attacking:'own',monsters:[...pack,attacking]}),true);
  assert.equal(chooseStep(candidates,base({target:'other',attacking:'own',monsters:[...pack,attacking]})),null);
  // Out of its range it is no fight, and the fewest idle blocks go.
  assert.equal(chooseStep(candidates,base({target:'other',attacking:'own',monsters:[...pack,{...attacking,x:400}]})).risky,true);}],
]);

