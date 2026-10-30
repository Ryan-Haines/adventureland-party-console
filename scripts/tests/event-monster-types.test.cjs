const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { namedFunction } = require('./helpers/named-function.cjs');

// Failure inventory: docs/efficiency.md, Character threads, CT3.
const source = fs.readFileSync('characters/shared.js', 'utf8');
// eventMonsterTypes with every shared.js function it calls, however the
// production code splits the work.
function functionWithHelpers(text, name) {
  const declared = new Set([...text.matchAll(/function ([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]));
  const loaded = new Map(), pending = [name];
  while (pending.length) {
    const next = pending.pop();
    if (loaded.has(next)) continue;
    const body = namedFunction(text, next);
    loaded.set(next, body);
    for (const call of body.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g))
      if (declared.has(call[1]) && !loaded.has(call[1]) && call[1] !== next) pending.push(call[1]);
  }
  return [...loaded.values()];
}
function counted(data) {
  // Counts reads of G.events, the first input eventMonsterTypes derives from.
  const reads = { events: 0 };
  const G = new Proxy(data, { get(target, key) { if (key === 'events') reads.events++; return target[key]; } });
  const context = vm.createContext({ G });
  for (const text of functionWithHelpers(source, 'eventMonsterTypes')) vm.runInContext(text, context);
  return { context, reads };
}
const game = () => ({
  events: { goobrawl: { join: true }, crabxx: { sprite: 'crabxx', join: true }, mrpumpkin: {} },
  monsters: { goo: {}, bgoo: {}, rgoo: {}, crabxx: {}, mrpumpkin: { spawns: [['hp:2', 'phoenix'], ['other', 'goo']] }, phoenix: {} },
});

test('event monster types keep their derivation and derive once per game data object', () => {
  const { context, reads } = counted(game());
  const plain = types => Array.from(types);
  assert.deepEqual(plain(context.eventMonsterTypes('goobrawl')), ['rgoo', 'bgoo', 'goo']);
  assert.deepEqual(plain(context.eventMonsterTypes('crabxx')), ['crabxx']);
  assert.deepEqual(plain(context.eventMonsterTypes('mrpumpkin')), ['mrpumpkin', 'phoenix']);
  assert.deepEqual(plain(context.eventMonsterTypes('unknown')), []);
  const first = reads.events;
  for (let index = 0; index < 50; index++) context.eventMonsterTypes('goobrawl');
  assert.equal(reads.events, first, 'repeated calls with the same game data must reuse the derived list');
});

test('a caller cannot change later results, and replaced game data is derived again', () => {
  const { context } = counted(game());
  const types = context.eventMonsterTypes('goobrawl');
  types.push('crabxx');
  types.length = 1;
  assert.deepEqual(Array.from(context.eventMonsterTypes('goobrawl')), ['rgoo', 'bgoo', 'goo']);
  // A game update loads a new G object; its events can differ.
  const next = game();
  next.events.crabxx.sprite = 'phoenix';
  context.G = next;
  assert.deepEqual(Array.from(context.eventMonsterTypes('crabxx')), ['phoenix', 'crabxx']);
});
