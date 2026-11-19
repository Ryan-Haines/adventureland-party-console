const assert = require('node:assert/strict');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { role, energizeAmount } = require('../../runtime/characters/turns/classes/mage.ts');

// The mage's Energize (turns/classes/mage.ts): the amount follows two shares of MP, and the
// target is the lowest-MP ally in range. Energize keeps the mage's class reserve, so the cast and the
// status report read one decision.
scenarioTable("Energize's amount moves 1 MP while every ally is comfortable, else a fifth of what the target misses", () => undefined, [
 ['every candidate at 60% of its MP or more moves 1 MP', () => {
  const pool = { mp: 60, max_mp: 100 };
  assert.equal(energizeAmount([pool, { mp: 100, max_mp: 100 }], pool, 500), 1);
 }],
 ['a candidate below 60% moves a fifth of what the target misses, rounded up, at least 1', () => {
  const low = { mp: 10, max_mp: 100 };
  assert.equal(energizeAmount([low, { mp: 100, max_mp: 100 }], low, 500), 18);
  const nearlyFull = { mp: 59, max_mp: 60 };
  assert.equal(energizeAmount([{ mp: 10, max_mp: 100 }, nearlyFull], nearlyFull, 500), 1);
 }],
 ['the amount never exceeds the MP above the class reserve', () => {
  const low = { mp: 0, max_mp: 1000 };
  assert.equal(energizeAmount([low], low, 30), 30);
 }],
]);

const mageWorld = () => {
  const keep = Object.fromEntries(['character', 'get_player', 'is_in_range'].map(key => [key, global[key]]));
  global.character = { name: 'M', mp: 1000, max_mp: 1000, map: 'main' };
  const players = {}, casts = [];
  global.get_player = name => players[name] ?? null;
  global.is_in_range = (target, skill) => skill === 'energize' && !target.far;
  const member = (name, mp, over = {}) => {
    const status = { name, mp, max_mp: 100, map: 'main', rip: false, ...over };
    players[name] = { name, far: !!over.far };
    return status;
  };
  const world = { members: [], roster: ['A', 'B', 'M'], reserve: 200, ready: true };
  const turn = { ready: () => ({ ready: world.ready, reserve: world.reserve }),
    casts: { cast: async (skill, target, category, amount) => { casts.push([skill, target.name, category, amount]); return true; } },
    facts: { roster: () => world.roster, members: () => world.members, sameTeam: () => true } };
  return { casts, member, world, turn, restore: () => { for (const [key, value] of Object.entries(keep)) { if (value === undefined) delete global[key]; else global[key] = value; } } };
};
const run = async (w, act) => { try { return await act(); } finally { w.restore(); } };
scenarioTable("the mage Energizes the lowest-MP ally in range and reports the same decision", mageWorld, [
 ['the lowest-MP ally in range is cast on, as a maintenance cast with the amount', w => run(w, async () => {
  w.world.members = [w.member('A', 50), w.member('B', 10)];
  assert.equal(await role.beforeAttack(null, w.turn), true);
  assert.deepEqual(w.casts, [['energize', 'B', 'maintenance', 18]]);
  assert.deepEqual(role.support(w.turn), { energize: { target: 'B', mp: 18 } }, 'the status report reads the same decision');
 })],
 ['an ally out of range is skipped for the next-lowest one', w => run(w, async () => {
  w.world.members = [w.member('A', 50), w.member('B', 10, { far: true })];
  assert.equal(await role.beforeAttack(null, w.turn), true);
  assert.equal(w.casts[0][1], 'A');
 })],
 ['a dead ally, a full ally, an ally on another map and one outside the roster are no candidate', w => run(w, async () => {
  w.world.members = [w.member('A', 10, { rip: true }), w.member('B', 100), w.member('C', 10), w.member('D', 10, { map: 'cave' })];
  assert.equal(await role.beforeAttack(null, w.turn), false);
  assert.deepEqual(w.casts, []);
  assert.deepEqual(role.support(w.turn), {});
 })],
 ['MP at or below the class reserve casts nothing, and a cooling Energize waits', w => run(w, async () => {
  w.world.members = [w.member('A', 10)];
  w.world.reserve = 1000;
  assert.equal(await role.beforeAttack(null, w.turn), false);
  w.world.reserve = 200; w.world.ready = false;
  assert.equal(await role.beforeAttack(null, w.turn), false);
  assert.deepEqual(w.casts, []);
 })],
]);
