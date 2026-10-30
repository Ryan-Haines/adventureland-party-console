const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./helpers/skill-world.cjs');
const { installSkillRuntime } = require('../../runtime/characters/skills/runtime.ts');

// Failure inventory: docs/efficiency.md, Character threads follow-ups, CT7.
// A unit test: the number of combat context builds is not observable outside
// the character thread, and the live journeys cover the skill decisions.
function harness(ctype) {
  const r = fixture(ctype), handlers = {}, keys = ['parent', 'character', 'G'];
  const saved = Object.fromEntries(keys.map(key => [key, global[key]]));
  let builds = 0, disabled = false;
  const context = () => ({ ...r.w.context, allies: [...r.w.context.allies], monsters: r.w.context.monsters.map(m => ({ ...m })), observedAt: Date.now() });
  const shared = {
    combatContext: () => { builds++; return context(); },
    skillTargetAllowed: () => true, rareAttackAllowed: () => true, queueEvidence: () => null,
  };
  const items = Object.fromEntries(['bow', 'dagger', 'mace', 'shield', 'knifebelt'].map(name => [name, r.w.item(name)]));
  global.G = { skills: r.w.skills, items, conditions: {}, classes: {} };
  global.character = r.actor;
  global.parent = { entities: {}, G: global.G, next_skill: {}, is_disabled: () => disabled,
    socket: { connected: true, on: (event, fn) => { handlers[event] = fn; }, off: () => {} },
    use_skill: async (id, target) => { r.calls.push({ id, target }); return { targets: [].concat(target) }; } };
  const root = { sharedRoutine: shared };
  const runtime = installSkillRuntime(root);
  return { r, shared, runtime, handlers, builds: () => builds, disable: value => { disabled = value; },
    restore() { runtime.stop(); for (const key of keys) if (saved[key] === undefined) delete global[key]; else global[key] = saved[key]; } };
}

test('a busy check builds no combat context', () => {
  const h = harness('priest');
  try {
    for (let i = 0; i < 10; i++) h.runtime.busy();
    assert.equal(h.builds(), 0);
  } finally { h.restore(); }
});

test('attack builds the context only for classes with attack skills', () => {
  for (const [ctype, expected] of [['priest', 0], ['mage', 0], ['warrior', 0], ['ranger', 1], ['rogue', 1]]) {
    const h = harness(ctype);
    try {
      const target = h.r.add('a');
      const result = h.runtime.attack(target);
      if (expected) assert.ok(h.builds() >= 1, ctype);
      else { assert.equal(h.builds(), 0, ctype); assert.equal(result, null, ctype); }
    } finally { h.restore(); }
  }
});

test('an action event without a projectile builds no context; an ally projectile still reads it', () => {
  const h = harness('priest');
  try {
    h.r.add('a');
    h.handlers.action({ attacker: 'Hero', target: 'a', type: 'attack' });
    h.handlers.action({ pid: 'p0', attacker: 'Hero', target: 'a', damage: 0, eta: 100 });
    assert.equal(h.builds(), 0);
    h.handlers.action({ pid: 'p1', attacker: 'Hero', target: 'a', damage: 100, eta: 100000, type: 'attack' });
    assert.equal(h.builds(), 1);
  } finally { h.restore(); }
});

test('one context per decision, read in the turn that asked for it; a disabled actor stays blocked', async () => {
  const h = harness('ranger');
  try {
    h.r.w.context.mode = 'event';
    const target = h.r.add('a'); h.r.add('b'); h.r.add('c');
    const before = h.builds();
    await h.runtime.attack(target);
    assert.equal(h.r.calls.length, 1);
    const perAttack = h.builds() - before;
    assert.ok(perAttack >= 1 && perAttack <= 3, 'builds for one attack: ' + perAttack);
    h.disable(true);
    h.r.calls.length = 0;
    await h.runtime.attack(target);
    assert.equal(h.r.calls.length, 0);
  } finally { h.restore(); }
});

test('support and offense check their choices against one context, plus one per cast', async () => {
  for (const [ctype, call] of [['priest', h => h.runtime.support()], ['paladin', h => h.runtime.support()], ['ranger', h => h.runtime.offense(h.r.w.context.monsters[0])]]) {
    const h = harness(ctype);
    try {
      h.r.add('a');
      await call(h);
      // execute() checks a chosen cast once more against a fresh world.
      assert.equal(h.builds(), 1 + h.r.calls.length, ctype);
    } finally { h.restore(); }
  }
});
