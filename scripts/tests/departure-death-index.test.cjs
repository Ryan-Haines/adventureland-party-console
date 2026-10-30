const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { namedFunction } = require('./helpers/named-function.cjs');

// Failure inventory: docs/efficiency.md, Character threads, CT5.
const source = fs.readFileSync('characters/shared.js', 'utf8');
function fixture(deaths) {
  const reads = { entries: 0 };
  const counted = list => new Proxy(list, { get(target, key) { if (typeof key === 'string' && /^\d+$/.test(key)) reads.entries++; return target[key]; } });
  const context = vm.createContext({ String, WeakMap, Set, Map,
    character: { map: 'main', in: 'main' }, root: {}, groupedCombat: { deaths: counted(deaths) },
    reunionRealm: () => context.realm, realm: 'USI', isAttackingPartyMember: () => true, passingKey: t => String(t.id) });
  vm.runInContext(namedFunction(source, 'departureTargetEngaged'), context);
  return { context, reads, counted };
}
const monster = id => ({ id, visible: true, hp: 100 });
const death = (id, extra = {}) => ({ id, map: 'main', in: 'main', server: 'USI', at: 1, ...extra });

test('a recorded death in this realm, map and instance ends departure engagement; others do not', () => {
  const { context } = fixture([death('a'), death('b', { map: 'cave' }), death('c', { in: 'other' }), death('d', { server: 'USII' }), death(7)]);
  assert.equal(context.departureTargetEngaged(monster('a')), false);
  assert.equal(context.departureTargetEngaged(monster('7')), false);
  for (const id of ['b', 'c', 'd', 'e']) assert.equal(context.departureTargetEngaged(monster(id)), true, id);
  // The character moved to the cave: the cave death applies, the main one does not.
  context.character.map = 'cave'; context.character.in = 'cave';
  context.groupedCombat.deaths[1].in = 'cave';
  assert.equal(context.departureTargetEngaged(monster('a')), true);
  context.groupedCombat.deaths.push(death('x', { map: 'cave', in: 'cave' }));
  assert.equal(context.departureTargetEngaged(monster('x')), false);
  context.realm = 'USII';
  assert.equal(context.departureTargetEngaged(monster('x')), true);
});

test('appended and replaced death lists are seen, and an unchanged list is not scanned again', () => {
  const list = Array.from({ length: 200 }, (_, index) => death('m' + index));
  const { context, reads, counted } = fixture(list);
  assert.equal(context.departureTargetEngaged(monster('m5')), false);
  const first = reads.entries;
  for (let index = 0; index < 50; index++) context.departureTargetEngaged(monster('live' + index));
  assert.equal(reads.entries, first, 'unchanged deaths must not be scanned for every target');
  context.groupedCombat.deaths.push(death('late'));
  assert.equal(context.departureTargetEngaged(monster('late')), false);
  context.groupedCombat.deaths = counted([death('fresh')]);
  assert.equal(context.departureTargetEngaged(monster('m5')), true);
  assert.equal(context.departureTargetEngaged(monster('fresh')), false);
  context.groupedCombat = null;
  assert.equal(context.departureTargetEngaged(monster('fresh')), true);
});
