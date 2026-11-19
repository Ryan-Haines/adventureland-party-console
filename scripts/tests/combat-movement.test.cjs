const assert = require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {runner,geometry}=require('./fixtures/combat-runner-scenario.cjs');
const {update: drawUpdate}=require('./helpers/run-scope.cjs');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

// The movers run in one list (e2e/movement-owner-failures.md "Step 9" item 6): an add-on answer
// at `formation` runs after the event return, Franky and rare movers and before the farm approach
// recovery, formation and kiting; with nothing enabled the chain runs as before.
scenarioTable("the role runner's tick attacks, supports and moves one character (MOV-033, MOV-044)", ()=>runner, [
 ['an add-on answer takes the tick only below the core movers that outrank it', async runner=>{
  const r=runner('warrior');await flush();
  let answered=0,returns=0,franky=0,rares=0,formations=0;const on={};
  // The event return and Franky approach are the events owner's movers (combat.ts `movers`), which the
  // tick asks through `eventFacts()`; each takes the tick while its fight is on.
  Object.assign(r.c.characterEvents.movers,{'event-return-combat':()=>!!on.returning&&(returns++,true),
    'franky-approach':()=>!!on.franky&&(franky++,true)});
  Object.assign(r.routine,{pollRareHunting:()=>{rares++;return !!on.rare;},
    formationMove:()=>{formations++;return true;},getNearestPartyAttacker:()=>null,getNearestPartyTarget:()=>null,
    isPartyHealthy:()=>true,isCurrentPartyTarget:()=>true,emergencyStompChoice:()=>false});
  const tick=async()=>{await r.run(100);await flush();};
  try{
    await r.run(250);await tick();
    const hooks=r.c.__partyHooks;
    assert.ok(hooks,'the role runner installs the registry');
    assert.equal(hooks.register({name:'e2e-hold',folder:'addons',author:'e2e',summary:'e2e',
      hooks:{'movement.request':[{name:'m',tier:'formation',answer:()=>{answered++;return {kind:'hold',reason:'e2e hold',phase:'holding'};}}]}}).ok,true);
    // Off: nothing answers, and the formation step keeps the tick as before.
    await tick();
    assert.equal(answered,0);assert.ok(formations>0);
    hooks.configure({'e2e-hold':{enabled:true}});
    for(const [field,count] of [['returning',()=>returns],['franky',()=>franky],['rare',()=>rares]]){
      on[field]=true;const before=count();await tick();
      assert.equal(count(),before+1,field+' keeps the tick');
      on[field]=false;
    }
    const formed=formations;await tick();
    assert.equal(formations,formed,'the add-on answer runs before the formation step');
    assert.equal(r.c.partyCombatPosition.mode,'addon:e2e-hold');assert.equal(r.c.partyCombatPosition.phase,'holding');
    assert.equal(r.moves(),0,'the approach and kite never ran');
    // The targeting module and the runner share the context's one registry, so the warrior's skill pass asks
    // the targeting owner's threat read with an answer.
    assert.equal(hooks.ask('targeting.attacking',r.target),false);
    assert.doesNotMatch(String(r.c.partyCombatState?.error??''),/has no answer/);
  }finally{r.c.partyRoleRunner.stop();}}],
 ['moving attacks and movement continue while support and move promises never settle', async runner=>{
  const r = runner(); await flush(); await r.run(250); await r.run(100); await r.run(50);
  assert.equal(r.attacks(), 1); assert.equal(r.moves(), 1);
  await r.run(100); await r.run(50);
  assert.equal(r.moves(), 2); assert.equal(r.attacks(), 1, 'one outstanding attack');
  r.now(4000); r.ready(false); await r.run(50); assert.equal(r.attacks(), 1);
  // The host sets no `last_draw`, so its clock is the update. The clock moves past the cooldown, then a draw runs the
  // pass that waited for the next update.
  r.ready(true); await r.advance(4016); await drawUpdate(); assert.equal(r.attacks(), 2, 'lost response releases only after cooldown');
  r.c.partyRoleRunner.stop();}],
 ['solo hunt can replace an untouched target but retains one with an attack in flight', async runner=>{
  for (const pending of [false,true]) {
    const r=runner();const near={...r.target,id:'near',x:5};let selected=r.target,resets=0;
    r.c.get_entity=id=>id==='near'?near:r.target;
    r.routine.setCombatTarget=t=>{selected=t;};
    r.routine.resetCombatMovement=()=>resets++;
    r.ready(pending);await r.run(250);
    if(pending){await r.run(50);assert.equal(r.attacks(),1);}
    r.routine.getCloserHuntTarget=current=>current.id===r.target.id?near:null;
    await r.run(250);
    assert.equal(selected.id,pending?r.target.id:'near');assert.equal(resets,pending?0:1);
    r.c.partyRoleRunner.stop();
  }}],
 // E04-d: a selected target the
 // rejection rule refuses is re-picked on the read that refuses it, not on the 1 s target timer.
 ['E04-d: a selected target the rejection rule refuses is re-picked at once', async runner=>{
  const r=runner();await flush();await r.run(250);
  const next={...r.target,id:'n',x:10},picked=[];
  r.routine.setCombatTarget=t=>{picked.push(t?t.id:null);};
  r.routine.isAllowedTarget=t=>t.id!=='m';r.routine.getPreferredTarget=()=>next;r.c.get_entity=id=>id==='n'?next:r.target;
  r.c.__partyHooks.turns.target(null);await flush();
  assert.ok(picked.includes('n'),`the refused target is re-picked at once: ${picked}`);
  r.c.partyRoleRunner.stop();}],
 // A read inside the selection's own change (an add-on's notice listener reads targeting.target) that
 // still refuses the target the selection just made re-picks it once, not again on each pick.
 ['a re-pick that lands on the target the read refuses is not re-picked again', async runner=>{
  const r=runner();await flush();await r.run(250);
  let reads=0;const picked=[];
  // The finder takes the target, and the rejection rule refuses it, as two views of one pass can.
  r.routine.isAllowedTarget=()=>!/targetRejection/.test(String(Error().stack));
  const read=()=>{if(++reads<=50)r.c.__partyHooks.turns.target(null);};
  r.routine.setCombatTarget=t=>{picked.push(t?t.id:null);read();};
  r.routine.publishCombatSelection=()=>read();
  read();for(let i=0;i<10;i++)await flush();
  assert.ok(reads<=4,`the read re-picked ${reads} times: ${picked}`);
  r.c.partyRoleRunner.stop();}],
 ['eligible passing and active attacks share priority without passing movement', async runner=>{
  for (const passivePriority of [40,100]) {
    const r=runner('ranger',false,routine=>{routine.queueReport=()=>({groupedCombat:{}});});await flush();
    r.c.partyQueueClient.preparePassing=()=>true; // Admission is covered by passing-admission tests.
    const passing={...r.target,id:'passing',mtype:'bee'};const hit=[];
    r.routine.passingTarget=()=>passing;
    r.routine.consoleDrainAllows=target=>target===passing;
    r.routine.monsterPriority=target=>target.id==='passing'?passivePriority:50;
    r.routine.beginPassingAttack=()=>{};
    r.c.attack=target=>{hit.push(target.id);return new Promise(()=>{});};
    r.attackTick();await flush();
    assert.equal(hit[0],passivePriority>50?'passing':r.target.id);
    r.c.partyRoleRunner.stop();
  }}],
]);
scenarioTable("combat range and kiting geometry: approach, retreat, kite and Dash stay inside safe ground (MOV-095, MOV-098)", ()=>geometry, [
 ['approach and retreat respect weapon range and the character side, including moving warriors', async geometry=>{
  const { c, target, moves } = geometry(25); target.target = 'Ally'; c.character.x = 5;
  c.character.moving = true; c.leaderLocation = { map: 'main', x: -200, y: 0 };
  assert.equal(await c.kiteIfNeeded(target), false);
  await c.approachCombatTarget(target); assert.equal(moves.at(-1).x, 23);
  c.character.x = 100; await c.approachCombatTarget(target);
  assert.ok(moves.at(-1).x < 100 && moves.at(-1).x >= 23);
  c.character.range = 200; assert.equal(c.combatApproachPoint(target).x, 190);}],
 ['blocked paths never fall back to unvalidated movement, and alternate kite direction works', async geometry=>{
  const { c, target, moves } = geometry(); c.can_move_to = (_x, y) => y < 0;
  await c.kiteIfNeeded(target); assert.equal(c.kiteState.direction, -1);
  c.can_move_to = () => false; const count = moves.length;
  await c.kiteIfNeeded(target); assert.equal(moves.length, count); assert.equal(c.partyCombatPosition.mode, 'blocked');
  target.target = 'Ally'; c.character.x = 10; await c.approachCombatTarget(target);
  assert.equal(moves.length, count);}],
 ['Dash cannot overshoot the weapon range boundary', async geometry=>{
  const { c, target } = geometry(25); let casts = 0;
  // The Dash goes through the class cast path, whose engine and turns executor test its cooldown
  // and MP; the endpoint check is the warrior's own (turns/classes/
  // warrior-combat.ts `dashToward`) over movement's combat geometry.
  const { dashToward } = require('../../runtime/characters/turns/classes/warrior-combat.ts');
  const turn = { casts: { ready: () => true, cast: async () => { casts++; return true; } },
    facts: { franky: () => false, groupedFarming: () => false, formationMembers: () => [], combatDistance: c.combatDistance, desiredCombatRange: c.desiredCombatRange, safeCombatPoint: c.safeCombatPoint } };
  Object.assign(c.character, { ctype: 'warrior', mp: 100, max_mp: 100, x: 60 });
  const kept = { character: global.character, is_in_range: global.is_in_range };
  Object.assign(global, { character: c.character, is_in_range: () => false });
  try {
    assert.equal(await dashToward(target, turn), false);
    c.character.x = 80; assert.equal(await dashToward(target, turn), true); assert.equal(casts, 1);
  } finally { Object.assign(global, kept); }}],
]);
