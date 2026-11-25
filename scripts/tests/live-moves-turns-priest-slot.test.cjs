// The priest's attack-family slot at its edge: which request takes it (turns/executor.ts `pass`),
// what the heal choice asks under "Heal first below" (survival/needs.ts `heal`), the A8 forecast
// (turns/rules.ts `priestAttacks`) and an add-on's spend at `task`. These rows hold the planted checks
// of live row T43 (test-windows DESIGN.md 4.3): each one there plants vitals, MP, a setting or an
// add-on mid-fight; live W01 keeps the plain goo window's observers (TC2, TC11, TG16, TG18, TG21, SV9).
const test=require('node:test'),assert=require('node:assert/strict');
const {turnsWorld}=require('./fixtures/turns-world.cjs');
const {needsWorld}=require('./fixtures/survival-needs-scenario.cjs');

// Game data: heal shares the attack family's cooldown (G.skills.heal.share 'attack'); partyheal
// costs 400 MP and is the priest's (G.skills.partyheal); Charge is the warrior's, with no MP cost and
// a 40000 ms cooldown (G.skills.charge).
const SKILLS={attack:{},heal:{share:'attack',class:['priest']},partyheal:{type:'skill',class:['priest'],mp:400},charge:{type:'skill',class:['warrior'],mp:0,cooldown:40000}};
const priest={name:'P',ctype:'priest',mp:1000,max_mp:1000,mp_cost:10,frequency:1,rip:false,items:[],level:80};
const attack={skill:'attack',targets:[{id:'goo1'}],rank:'damage',category:'damage',reason:'target'};
// One pass of the executor with the planted asks, and what it sent.
function onePass({actor=priest,asks,selected='goo1'}){
  const w=turnsWorld({actor,skills:SKILLS,selected:()=>selected,asks:()=>asks});
  try{global.parent.next_skill={};w.turns.pass('tick');return {sent:w.sent.map(s=>[s[0],s[1]]),state:w.state,notices:w.notices,w};}
  finally{w.restore();}
}

// TC1, SV7 and SV8: a heal the choice asks below "Heal first below" is a `survival` request, which
// outranks the attack in the shared family, so the first send once the priest's client sees the
// member below the line is the heal.
test('TC1: a heal below "Heal first below" outranks the attack in the attack family',()=>{
  const t=needsWorld('priest',{hp:5000,max_hp:5000,mp:5000,max_mp:5000,heal:2000});
  t.add('Warrior',3500,{max_hp:5000});
  const asked=t.heals();
  assert.deepEqual(asked.map(a=>[a.skill,a.rank]),[['heal','survival']],'SV8: the client sees the warrior at 70%, below 80%');
  const {sent}=onePass({asks:[attack,...asked]});
  assert.deepEqual(sent.map(([method])=>method),['heal'],'SV7: the first send is the heal, not the attack');
});

// TC3: above the line the heal is a top-off at `maintenance`, which an attack on a target outranks;
// on an edge with no target the top-off goes.
test('TC3: a top-off heal yields the slot to an attack on a target, and goes on an edge with none',()=>{
  const t=needsWorld('priest',{hp:5000,max_hp:5000,mp:5000,max_mp:5000,heal:2000});
  t.add('Warrior',17000,{max_hp:20000});
  const asked=t.heals();
  assert.deepEqual(asked.map(a=>[a.skill,a.rank]),[['heal','maintenance']],'at 85% missing more than a heal: the top-off');
  assert.deepEqual(onePass({asks:[...asked,attack]}).sent.map(([method])=>method),['attack'],'top-off heals on edges with a target');
  assert.deepEqual(onePass({asks:asked,selected:null}).sent.map(([method])=>method),['heal'],'the top-off goes on an edge with no target');
});

// TC38: the heal choice reads "Heal first below" as written: at 60 a member at 70% missing less than
// a heal asks nothing, so the attack keeps the slot; back at 80 it asks the survival heal.
test('TC38: at 60 the priest attacks a member at 70%, and back at 80 it heals',()=>{
  const t=needsWorld('priest',{hp:5000,max_hp:5000,mp:5000,max_mp:5000,heal:2000});
  t.add('Warrior',3500,{max_hp:5000});
  t.view.healFirstBelow=60;
  assert.deepEqual(t.heals(),[],'at 60 the priest asks no heal at 70%');
  assert.deepEqual(onePass({asks:[attack,...t.heals()]}).sent.map(([method])=>method),['attack'],'at 60 the priest attacks at 70%');
  t.view.healFirstBelow=80;
  assert.deepEqual(t.heals().map(a=>[a.skill,a.rank]),[['heal','survival']],'back at 80 it heals');
  assert.deepEqual(onePass({asks:[attack,...t.heals()]}).sent.map(([method])=>method),['heal'],'back at 80 no attack below it');
});

// TC18: the A8 forecast is partyheal's cost, and the priest asks its basic attack only while its MP
// less the forecast covers the attack's `mp_cost`.
test('TC18: the priest asks no basic attack below the partyheal forecast plus its attack cost',()=>{
  const {forecast,priestAttacks}=require('../../runtime/characters/turns/rules.ts');
  const world=mp=>({actor:{...priest,mp,slots:{},s:{}},skills:SKILLS,item:()=>undefined});
  assert.equal(forecast(world(1000)),SKILLS.partyheal.mp,'the A8 forecast');
  assert.equal(priestAttacks(world(SKILLS.partyheal.mp+priest.mp_cost/2)),false,'attacks below the forecast plus a cost');
  assert.equal(priestAttacks(world(SKILLS.partyheal.mp+priest.mp_cost)),true,'attacks resume');
});

// TC21: an add-on's Charge at `task` goes through the executor, and its diagnostic names the
// registration that asked it, so a Charge whose diagnostic names the add-on came from it alone.
test("TC21: an add-on's Charge at task goes, and its diagnostic names the add-on",()=>{
  const warrior={name:'W',ctype:'warrior',mp:100,max_mp:100,mp_cost:0,frequency:1,rip:false,items:[],level:80};
  const w=turnsWorld({actor:warrior,skills:SKILLS,selected:()=>'goo1',asks:()=>[{skill:'charge',rank:'task',category:'maintenance',reason:'target out of weapon range'}]});
  try{
    global.parent.next_skill={};w.turns.pass('tick');
    assert.deepEqual(w.sent.map(s=>[s[0],s[1]]),[['skill','charge']],"the fixture add-on's Charge goes");
    w.reply({response:'data',place:'charge',success:true});
    const d=w.state.skill;
    assert.deepEqual([d.skill,d.status,d.rank,d.by],['charge','accepted','task','e2e/planted'],"the fixture add-on's Charge, accepted, by the add-on at task");
  }finally{w.restore();}
});
