const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./helpers/skill-world.cjs');
const { installSkillRuntime } = require('../../runtime/characters/turns/skills/runtime.ts');
// The replaced game window keeps the lifecycle owner's run scope, as shared.js
// leaves it there.
const { processScope } = require('./helpers/run-scope.cjs');

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
  global.parent = { __partyRunScope: processScope(), entities: {}, G: global.G, next_skill: {}, is_disabled: () => disabled,
    socket: { connected: true, on: (event, fn) => { handlers[event] = fn; }, off: () => {} },
    use_skill: async (id, target) => { r.calls.push({ id, target }); return { targets: [].concat(target) }; } };
  const root = { sharedRoutine: shared };
  // The turns executor's ports: an empty ledger, and a push that the test does not send.
  const runtime = installSkillRuntime(root, { ledger: { mp: () => 0, flying: () => false }, push: async () => true, context: shared.combatContext });
  return { r, shared, runtime, handlers, builds: () => builds, disable: value => { disabled = value; },
    restore() { runtime.stop(); for (const key of keys) if (saved[key] === undefined) delete global[key]; else global[key] = saved[key]; } };
}

test('support and offense check their choices against one context', () => {
  for (const [ctype, call] of [['priest', h => h.runtime.choices.support(h.runtime.world())], ['paladin', h => h.runtime.choices.support(h.runtime.world())],
    ['ranger', h => h.runtime.choices.offense(h.runtime.world(), h.r.w.context.monsters[0])]]) {
    const h = harness(ctype);
    try {
      h.r.add('a');
      call(h);
      // The turns executor sends a chosen cast from the same pass, so no cast builds a second one.
      assert.equal(h.builds(), 1, ctype);
    } finally { h.restore(); }
  }
});

// #136 (and upstream issues"): the game client defines an entity's position and size as accessors on
// its prototype, which v1.5.0's `Object.assign({}, def, m)` copy left out, so every
// multi-target choice saw its monsters at no position. The context's entry keeps them, with the game
// data's size where the entity answers none.
test('#136: an entity whose x, y and width are accessors keeps them in the context', () => {
  const { monsterEntry } = require('../../runtime/characters/turns/skills/context.ts');
  class Sprite { get x() { return 40; } get y() { return 12; } get width() { return 18; } }
  const m = Object.assign(new Sprite(), { id: 'g', mtype: 'goo', hp: 10 });
  const entry = monsterEntry(m, { width: 24, height: 30, xp: 5 });
  assert.deepEqual([entry.x, entry.y, entry.width, entry.height, entry.xp, entry.id], [40, 12, 18, 30, 5, 'g']);
  assert.equal(Object.assign({}, { width: 24 }, m).x, undefined, "b9b5c91e's copy drops the accessor");
});

// The monster table follows the game's updates: a world packet names the monsters it changes, the
// next draw applies it (game.js `process_entities`), and a context built after that draw rebuilds
// only those entries. A monster no packet named keeps its entry, with its position read again, since
// the game moves an entity between packets. Isolated: a live run cannot see entry identity.
test('the monster table rebuilds only the entries a packet changed', () => {
  const { combatContext, createMonsterTable } = require('../../runtime/characters/turns/skills/context.ts');
  const keys = ['parent', 'character', 'G', 'get_player'], saved = Object.fromEntries(keys.map(key => [key, global[key]]));
  try {
    const monster = (id, x) => ({ id, type: 'monster', mtype: 'goo', hp: 10, x, y: 0, visible: true, map: 'main', in: 'main' });
    global.character = { name: 'W', map: 'main', in: 'main', hp: 100, ctype: 'warrior' };
    global.G = { monsters: { goo: { hp: 10, xp: 5 } }, maps: { main: {} } };
    global.get_player = () => null;
    global.parent = { draws: 1, entities: { a: monster('a', 10), b: monster('b', 20) } };
    const facts = { combatEvent: () => null, roster: () => [], sameTeam: () => true, joinedEvent: () => null, farmingMode: () => 'grouped', leader: () => 'W', liveAbtesting: () => false };
    const table = createMonsterTable(), build = () => combatContext(facts, () => false, table).monsters;
    const [a1, b1] = build();
    // A packet for `a` lands at update 1; the draw that applies it makes update 2.
    table.changed(['a'], 1);
    global.parent.draws = 2;
    global.parent.entities.a.hp = 4;
    global.parent.entities.b.x = 25;
    const [a2, b2] = build();
    assert.notEqual(a2, a1, 'the changed monster kept its old entry');
    assert.equal(a2.hp, 4);
    assert.equal(b2, b1, 'a monster no packet named was rebuilt');
    assert.equal(b2.x, 25, 'the kept entry missed its new position');
    // A monster gone from view leaves the table.
    delete global.parent.entities.a;
    assert.deepEqual(build().map(m => m.id), ['b']);
  } finally { for (const key of keys) if (saved[key] === undefined) delete global[key]; else global[key] = saved[key]; }
});

// The ranking asks the same target and skill many times inside one world (each spot's area hits ask
// every monster again), and every ask runs targeting's gate rows.
test('one world asks targeting once per target and skill; the next world asks again', () => {
  const h = harness('warrior');
  const asked = [];
  try {
    h.r.add('a');
    const runtime = installSkillRuntime({ sharedRoutine: h.shared }, { ledger: { mp: () => 0, flying: () => false }, push: async () => true,
      context: h.shared.combatContext, allows: (t, id) => { asked.push(t.id + '|' + id); return t.id === 'refused' ? 'refused' : undefined; } });
    try {
      const w = runtime.world(), m = { id: 'm1' }, r = { id: 'refused' };
      for (let i = 0; i < 3; i++) { assert.equal(w.allowed(m, 'cleave'), true); assert.equal(w.allowed(r, 'cleave'), false); }
      assert.equal(w.allowed(m, 'stomp'), true);
      assert.deepEqual(asked, ['m1|cleave', 'refused|cleave', 'm1|stomp']);
      runtime.world().allowed(m, 'cleave');
      assert.equal(asked.length, 4, 'a new world reads the gate at its own time');
    } finally { runtime.stop(); }
  } finally { h.restore(); }
});
