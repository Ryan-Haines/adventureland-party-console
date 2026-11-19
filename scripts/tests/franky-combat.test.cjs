// The Franky mover's facts (character/combat.ts) and the skill runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
// A row that replaces the game window keeps the lifecycle owner's run scope on it, as shared.js leaves it there.
const {processScope}=require('./helpers/run-scope.cjs');
// MOV-100 on character/combat.ts's Franky mover: the facts with plain ports
// (fixtures/franky-combat-scenario.cjs `factsFixture`). Holding and letting go go through movement's
// owner (`resetSteps`), which stops only combat's own step.
const { factsFixture } = require('./fixtures/franky-combat-scenario.cjs');
const boss = { id: 'boss', mtype: 'franky', x: 300, y: 0 }, mummy = { id: 'mummy', mtype: 'nerfedmummy', target: 'Hero', x: -300, y: 0 };
scenarioTable("Franky's approach closes through adds and holds in range (MOV-100)", over => factsFixture(over), [
 ['terrain blocks the approach, and no target waits without a step', ({ facts, steps, positions }) => {
  facts.frankyTick(boss);
  assert.deepEqual(steps, []); assert.equal(positions.at(-1).mode, 'blocked');
  facts.frankyTick(null);
  assert.deepEqual(steps, []); assert.equal(positions.at(-1).mode, 'franky-waiting');
 }, { blocked: true }],
 // Each event has a boss approach setting: going
 // straight (the default) closes through adds; fighting adds takes the full step check, so an add
 // in the way stops the approach.
 ['going straight closes through adds and holds in range', ({ facts, steps, positions, t }) => {
  facts.frankyTick(boss);
  assert.deepEqual(steps, [{ target: 'boss', mode: 'franky-approaching', closes: 'terrain' }]);
  t.inRange = true; facts.frankyTick(boss);
  assert.equal(steps.length, 1); assert.equal(positions.at(-1).mode, 'franky-holding');
 }, { unsafe: true }],
 ['fighting adds stops at an add in the way', ({ facts, steps, positions }) => {
  facts.frankyTick(boss);
  assert.deepEqual(steps, []); assert.equal(positions.at(-1).mode, 'blocked');
 }, { unsafe: true, limits: { bossApproach: 'fight-adds' } }],
 // The attendance owns the fight only while its assignment stands and no request above
 // event attendance holds the character (attend.ts `owns`), which replaces b9b5c91e's list of holds.
 ['a task or request above the attendance takes the tick', ({ facts, steps }) => {
  assert.equal(facts.frankyActive(), false);
  assert.equal(facts.frankyTick(boss), false); assert.deepEqual(steps, []);
 }, { owns: false }],
]);test('skill runtime restricts offensive and area casts but preserves friendly support',async()=>{
  const {fixture:skillFixture}=require('./helpers/skill-world.cjs');
  const {installSkillRuntime}=require('../../runtime/characters/turns/skills/runtime.ts');
  const {decision}=require('../../runtime/characters/turns/skills/types.ts');
  const r=skillFixture('ranger'),boss=r.add('boss',{mtype:'franky'}),add=r.add('add');
  r.w.context.mode='event';r.w.context.event='franky';
  const keys=['character','parent','G','distance','sharedRoutine'],saved=Object.fromEntries(keys.map(k=>[k,global[k]]));
  let engine;
  try {
    global.character=r.actor;
    global.G={skills:r.w.skills,items:{bow:{wtype:'bow'},shield:{type:'shield'},knifebelt:{}},conditions:{}};
    const casts=[];global.parent={__partyRunScope:processScope(),entities:{boss,add},use_skill:async(id,arg)=>{casts.push([id,arg]);return {};}};
    const shared={frankyCombatActive:()=>true,combatContext:()=>r.w.context,
      skillTargetAllowed:()=>true}; // Runtime must defend even against a permissive candidate source.
    // The turns executor asks `targeting.allows` (`core:targeting`) for each
    // target of a cast; its skill gate judges with the runtime's world and pull check.
    global.sharedRoutine=shared;
    engine=installSkillRuntime({sharedRoutine:shared,partyCombatState:{}},{ledger:{mp:()=>0,flying:()=>false},push:async()=>true,context:shared.combatContext});
    // No add attacks this character, so the targeting owner's Franky row (events.ts `frankyAttacker`) takes only the boss.
    const {createAnswers}=require('../../runtime/characters/targeting/gates.ts');
    const answers=createAnswers({hooks:{targeting:{refuses:()=>undefined},calls:{band:()=>'send'}},reflect:()=>({magic:[],physical:[]}),
      world:()=>engine.gateWorld(),pullSafe:(w,t)=>engine.pullSafe(w,t),module:require('./helpers/targeting-module.cjs').answerModule(shared,{franky:()=>shared.frankyCombatActive(),frankyAttacker:()=>false})});
    const refused=(skill,targets)=>targets.length?targets.some(t=>answers.allows(t,skill)):!!answers.allows(undefined,skill);
    assert.equal(refused('supershot',[add]),true);
    assert.equal(refused('3shot',[boss,add]),true);
    assert.equal(refused('supershot',[boss]),false);
    r.actor.ctype='warrior';r.actor.slots.mainhand={name:'basher'};G.items.basher={wtype:'basher'};
    assert.equal(refused('stomp',[]),true);
    r.actor.ctype='paladin';r.actor.hp=1000;
    assert.equal(refused('selfheal',[]),false);
    assert.deepEqual(casts,[],'the runtime itself casts nothing');
  } finally {engine?.stop();for(const k of keys)if(saved[k]===undefined)delete global[k];else global[k]=saved[k];}
});

// EV39: the Franky mover closes on the target the selection holds, the boss or
// a Franky spawn attacking this character, and only terrain constrains the approach.
scenarioTable('EV39: the Franky mover follows the selected target', over => factsFixture(over), [
 ['a selected attacker is approached, not the boss', ({ facts, steps }) => {
  facts.frankyTick(mummy);
  assert.deepEqual(steps.map(s => s.target), ['mummy']);
 }],
 ['adds around the approach never make it retreat', ({ facts, steps }) => {
  facts.frankyTick(boss);
  assert.deepEqual(steps, [{ target: 'boss', mode: 'franky-approaching', closes: 'terrain' }]);
 }, { unsafe: true }],
]);

// The report's boss sighting (combat.ts `sighting`) and the three event rows (`movers`): the
// sighting follows the boss, never a selected add, and names its reach; the return's fight takes
// the tick and cancels the return's Town; `franky` takes none; `franky-approach` reselects and closes.
const bigBoss = { ...boss, type: 'monster', hp: 900 };
scenarioTable('EV39: the Franky sighting and the event movers', over => factsFixture(over), [
 ['a selected add reports the boss in view, with its reach', ({ facts }) => {
  const seen = facts.sighting({ ...mummy, type: 'monster', hp: 100 });
  assert.deepEqual([seen.id, seen.mtype, seen.event, seen.x, seen.attackReachable, seen.observedAt], ['boss', 'franky', 'franky', 300, true, 1000]);
 }, { entities: { boss: bigBoss } }],
 ['no boss in view reports no sighting, and a blocked approach is out of reach', ({ facts, t }) => {
  assert.equal(facts.sighting(null), null);
  t.entities = { boss: bigBoss }; t.blocked = true;
  assert.equal(facts.sighting(bigBoss).attackReachable, false);
 }],
 ["the return's fight takes the tick and cancels the return's Town", ({ facts, t }) => {
  const tick = { reselect() {}, combat: false, first: () => true, target: () => null };
  assert.equal(facts.movers['event-return-combat'](tick), false);
  t.returnFight = true;
  assert.equal(facts.movers['event-return-combat'](tick), true);
  assert.equal(t.cancelled, 1);
  assert.equal(facts.movers.franky(tick), false, 'franky takes no tick of its own');
 }],
 ['the approach reselects and closes on the selected target, and yields to a task above it', ({ facts, steps, t }) => {
  let reselected = 0;
  const tick = { reselect: () => reselected++, combat: true, first: () => false, target: () => boss };
  assert.equal(facts.movers['franky-approach'](tick), true);
  assert.equal(reselected, 1);
  assert.deepEqual(steps.map(s => s.target), ['boss']);
  t.owns = false;
  assert.equal(facts.movers['franky-approach'](tick), false);
 }],
]);
