const test = require('node:test');
const assert = require('node:assert/strict');
const { mayTaunt } = require('../../runtime/characters/classes/warrior-combat.ts');

test('Porcupine pull respects ownership, mana, cooldown, and Taunt range', () => {
  global.character = { name: 'Leader', mp: 40 };
  global.G = { skills: { taunt: { mp: 40 } } };
  global.sharedRoutine = { isLeader: () => true, isAttackingPartyMember: t => t.target === 'Ally', allowsTarget: t => !t.claimed };
  global.is_on_cooldown = () => false;
  global.is_in_range = (_, skill) => skill === 'taunt';
  global.get_entity = () => null;
  const target = { type: 'monster', mtype: 'porcupine' };
  try {
    assert.equal(mayTaunt(target), true);
    global.sharedRoutine.isLeader = () => false;
    assert.equal(mayTaunt(target), false, 'a warrior follower never takes over the pull');
    global.sharedRoutine.isLeader = () => true;
    assert.equal(mayTaunt({ ...target, target: 'Ally' }), true);
    for (const other of [{ ...target, target: 'Leader' }, { ...target, target: 'Stranger' },
      { ...target, claimed: true }, { ...target, mtype: 'goo' }, { ...target, mtype: 'tinyp' }])
      assert.equal(mayTaunt(other), false);
    character.mp = 39; assert.equal(mayTaunt(target), false); character.mp = 40;
    global.is_on_cooldown = () => true; assert.equal(mayTaunt(target), false);
    global.is_on_cooldown = () => false; global.is_in_range = () => false;
    assert.equal(mayTaunt(target), false);
  } finally {
    for (const key of ['character', 'G', 'sharedRoutine', 'is_on_cooldown', 'is_in_range', 'get_entity']) delete global[key];
  }
});
