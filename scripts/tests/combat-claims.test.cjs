const { scenarioTable } = require('./fixtures/scenarios.cjs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { claimsSetup: setup } = require('./fixtures/targeting-scenario.cjs');
scenarioTable("the claim and party defense checks keep their order (TG4, TG26)",()=>undefined,[
  ["a first-hit collision invalidates a locked target using the latest server claim",()=>{
  const { context: c, entities } = setup();
  const selected = { ...entities['1'] };
  assert.equal(c.isAllowedTarget(selected), true);
  entities['1'].target = 'Stranger';
  assert.equal(c.isAllowedTarget(selected), false, 'stale selected object must not bypass the claim');
  assert.equal(c.engagedMonster(), null);
  assert.equal(c.combatTargetId, null);
  assert.equal(c.select.getNearestFocusedMonster(), null, 'do not reacquire the contested monster');
  }],
  ["party defense reads the current claim and includes the character itself",()=>{
  const { context: c, entities } = setup();
  entities['1'].mtype = 'phoenix';
  entities['1'].target = 'Ally';
  const selected = { ...entities['1'] };
  assert.equal(c.isAttackingPartyMember(selected), true);
  entities['1'].target = 'Stranger';
  assert.equal(c.isAttackingPartyMember(selected), false, 'cached party positions and stale target cannot authorize taunt');
  entities['1'].target = null;
  assert.equal(c.isAttackingPartyMember(selected), false);
  entities['1'].target = 'Us';
  assert.equal(c.isAttackingPartyMember(selected), true, 'self attackers require defense too');
  }],
  ["the warrior Taunt call obeys the live party-claim guard",async ()=>{
  const { context: c, entities } = setup();
  const casts = [];
  c.character.mp = 100;
  c.G.skills = { taunt: { mp: 10 } };
  c.is_on_cooldown = () => false;
  c.is_in_range = () => true;
  c.use_skill = async (skill, target) => { casts.push([skill, target.id]); };
  // Taunt goes through the class cast path; the guard under test is the
  // pull's claim rule before it.
  c.sharedRoutine = {
    isLeader: () => true,
    getFarmingMode: () => 'default',
    isAttackingPartyMember: c.isAttackingPartyMember,
  };
  // The role loop's handle (turns/api.ts `ClassTurn`): the class cast path. The target stands in
  // range, so the warrior's Dash does not go.
  const turn = { casts: { ready: () => true, cast: async (skill, target) => { casts.push([skill, target.id]); return true; } },
    facts: { franky: () => false, groupedFarming: () => false, formationMembers: () => [], isLeader: () => true, roleFarmingMode: () => 'default' } };
  // The row calls the warrior's turn alone, so no runner installs.
  const roles = require('./helpers/role-runner-bundle.cjs').roleRunnerBundle({ install: false });
  Object.assign(c, { setTimeout, clearTimeout });
  // The targeting module over this context, whose reads the warrior asks.
  c.sharedRoutine.targeting = require('./helpers/targeting-module.cjs').routineModule(c, c.sharedRoutine);
  vm.runInContext(roles, c);
  for (const mtype of ['goo', 'phoenix']) {
    entities['1'].mtype = mtype;
    entities['1'].target = 'Ally';
    const selected = { ...entities['1'] };
    casts.length = 0;
    await c.partyRoles.warrior.beforeAttack(selected, turn);
    assert.deepEqual(casts, [['taunt', '1']]);
    for (const owner of ['Stranger', null, 'Us']) {
      entities['1'].target = owner;
      casts.length = 0;
      await c.partyRoles.warrior.beforeAttack(selected, turn);
      assert.equal(casts.length, 0, `${mtype}: must not taunt current owner ${owner}`);
    }
  }
  }],
  ["party claims and cooperative monsters remain eligible; ordinary outside claims do not",()=>{
  const { context: c, entities } = setup();
  for (const owner of [null, 'Us', 'Ally']) {
    entities['1'].target = owner;
    assert.equal(c.isAllowedTarget(entities['1']), true);
  }
  entities['1'].target = 'Stranger';
  entities['1'].mtype = 'phoenix';
  assert.equal(c.isAllowedTarget(entities['1']), false);
  c.eventTargetTypes=['phoenix'];assert.equal(c.isAllowedTarget(entities['1']),true);
  entities['1'].mtype = 'goo';
  c.eventTargetTypes = ['goo'];
  assert.equal(c.isAllowedTarget(entities['1']), true, 'preserve explicit event combat');
  }],
  ["a contested high-priority monster does not hide a valid lower-priority target",()=>{
  const { context: c, entities } = setup();
  entities['1'].target = 'Stranger';
  entities['2'] = { ...entities['1'], id: '2', target: null, x: 30 };
  c.monsterPriority = target => target.id === '1' ? 100 : 1;
  assert.equal(c.select.getNearestFocusedMonster().id, '2');
  entities['1'].target = 'Ally';
  assert.equal(c.select.getNearestFocusedMonster().id, '1', 'a legitimate claim change makes it eligible again');
  }],

  ["only fresh active patrol permission allows assisting another player with Phoenix",()=>{
  const {context:c,entities,doors}=setup();const phoenix=entities['1'];phoenix.mtype='phoenix';phoenix.target='Stranger';
  // The hunting owner's rare control and whether the rare client's patrol is current.
  doors.rare.control={allowPhoenixAssist:true};doors.rares.current=()=>true;
  assert.equal(c.isAllowedTarget(phoenix),true);
  doors.rares.current=()=>false;assert.equal(c.isAllowedTarget(phoenix),false);
  doors.rares.current=()=>true;doors.rare.control.allowPhoenixAssist=false;assert.equal(c.isAllowedTarget(phoenix),false);
  doors.rare.control.allowPhoenixAssist=true;phoenix.mtype='goo';assert.equal(c.isAllowedTarget(phoenix),false);
  }],
  // TG26: during the Graveyard event a
  // Graveyard monster type the event list leaves out is no target, unless it attacks the party.
  // No live fixture runs the Graveyard event, so the row plants the event and its list.
  ["TG26: a Graveyard monster left off the event list is no target",()=>{
  const { context: c, entities } = setup();
  c.eventAttend.selected = name => name === 'graveyard'; c.eventSettings = { graveyard: { monsters: ['zombie'] } };
  c.monsterFocus = ['ghoul', 'zombie'];
  entities.g = { ...entities['1'], id: 'g', mtype: 'ghoul', target: null }; entities.z = { ...entities.g, id: 'z', mtype: 'zombie' };
  const why = t => { const d = {}; c.isAllowedTarget({ ...t }, null, d); return d.reason; };
  assert.equal(why(entities.g), 'excluded Graveyard monster');
  assert.notEqual(why(entities.z), 'excluded Graveyard monster', 'a listed Graveyard monster passes the check');
  entities.g.target = 'Ally';
  assert.notEqual(why(entities.g), 'excluded Graveyard monster', 'a ghoul on the party is defended');
  entities.g.target = null; c.eventAttend.selected = () => false;
  assert.notEqual(why(entities.g), 'excluded Graveyard monster', 'with the event off nothing is excluded');
  }],
]);
