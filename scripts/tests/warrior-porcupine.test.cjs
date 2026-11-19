const test = require('node:test');
const assert = require('node:assert/strict');
const { mayTaunt } = require('../../runtime/characters/turns/classes/warrior-combat.ts');
const { partyHooks } = require('../../runtime/hooks/index.ts');

// Taunt's mana, cooldown and range are the skill engine's readiness, which
// the warrior asks through the turns executor's cast path; this test holds the pull's ownership rules.
test("Porcupine pull respects ownership and the engine's Taunt readiness", () => {
  global.character = { name: 'Leader', mp: 40 };
  global.G = { skills: { taunt: { mp: 40 } } };
  let ready = true;
  // The engine's Taunt readiness answers for the aggro owner only (eligibility.ts `ownsAggro`), so a
  // member that does not own aggro reads not ready; the threat and allow facts are targeting's
  // published reads.
  let leader = true;
  global.parent = {};
  partyHooks().publish({ name: 'core:targeting', folder: 'core', author: 'test', summary: 'test',
    hooks: { 'targeting.attacking': t => t.target === 'Ally', 'targeting.allowed': t => !t.claimed } });
  // The role loop's handle (turns/api.ts `ClassTurn`): the class cast path's readiness and its facts.
  const turn = { casts: { ready: (skill, _t, category) => skill === 'taunt' && category === 'survival' && ready && leader }, facts: {} };
  global.is_on_cooldown = () => false;
  global.is_in_range = (_, skill) => skill === 'taunt';
  global.get_entity = () => null;
  const target = { type: 'monster', mtype: 'porcupine' };
  try {
    assert.equal(mayTaunt(target, turn), true);
    leader = false;
    assert.equal(mayTaunt(target, turn), false, 'a warrior follower never takes over the pull');
    leader = true;
    assert.equal(mayTaunt({ ...target, target: 'Ally' }, turn), true);
    for (const other of [{ ...target, target: 'Leader' }, { ...target, target: 'Stranger' },
      { ...target, claimed: true }, { ...target, mtype: 'goo' }, { ...target, mtype: 'tinyp' }])
      assert.equal(mayTaunt(other, turn), false);
    ready = false; assert.equal(mayTaunt(target, turn), false, 'Taunt waits while the engine refuses it');
  } finally {
    for (const key of ['character', 'G', 'parent', 'is_on_cooldown', 'is_in_range', 'get_entity', '__partyHooks']) delete global[key];
  }
});

// The warrior's pre-attack step (turns/classes/warrior.ts `beforeAttack`), one row per branch: Franky
// leaves movement to approach-and-hold, a porcupine is pulled with Taunt, Scatter only Dashes, and the
// default Taunts, then Dashes toward a target that is out of range.
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { role } = require('../../runtime/characters/turns/classes/warrior.ts');
const warriorWorld = () => {
  const keep = Object.fromEntries(['character', 'G', 'parent', 'is_in_range', 'get_entity'].map(key => [key, global[key]]));
  global.character = { name: 'Leader', level: 80, x: 0, y: 0, mp: 1000 };
  global.G = { skills: { taunt: { level: 1 } } };
  global.parent = {}; global.get_entity = () => null;
  global.is_in_range = () => false;
  partyHooks().publish({ name: 'core:targeting', folder: 'core', author: 'test', summary: 'test',
    hooks: { 'targeting.attacking': t => t.target === 'Ally', 'targeting.allowed': () => true } });
  const casts = [], mode = { value: 'default', franky: false };
  const turn = { casts: { ready: () => true, cast: async skill => { casts.push(skill); return true; } },
    facts: { franky: () => mode.franky, roleFarmingMode: () => mode.value, groupedFarming: () => false, formationMembers: () => [],
      combatDistance: () => 150, desiredCombatRange: () => 10, safeCombatPoint: () => true } };
  return { casts, mode, turn, restore: () => { for (const [key, value] of Object.entries(keep)) { if (value === undefined) delete global[key]; else global[key] = value; } } };
};
const beforeAttack = async (w, target) => { try { return await role.beforeAttack(target, w.turn); } finally { w.restore(); } };
const farTarget = over => ({ type: 'monster', mtype: 'goo', x: 200, y: 0, target: 'Ally', ...over });
scenarioTable("the warrior's pre-attack step Taunts and Dashes by its branches", warriorWorld, [
 ['Franky leaves movement to approach-and-hold: no Taunt and no Dash', async w => {
  w.mode.franky = true;
  assert.equal(await beforeAttack(w, farTarget()), false);
  assert.deepEqual(w.casts, []);
 }],
 ['a porcupine is pulled with Taunt alone', async w => {
  assert.equal(await beforeAttack(w, farTarget({ mtype: 'porcupine', target: null })), true);
  assert.deepEqual(w.casts, ['taunt']);
 }],
 ['Scatter Dashes toward the target and never Taunts', async w => {
  w.mode.value = 'scatter';
  assert.equal(await beforeAttack(w, farTarget()), true);
  assert.deepEqual(w.casts, ['dash']);
 }],
 ['the default Taunts a monster attacking an ally, then Dashes toward it', async w => {
  assert.equal(await beforeAttack(w, farTarget()), true);
  assert.deepEqual(w.casts, ['taunt', 'dash']);
 }],
]);
