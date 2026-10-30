const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { namedFunction } = require('./helpers/named-function.cjs');

// Failure inventory: docs/efficiency.md, Character threads follow-ups, CT8.
// A unit test: realm reads through the CODE facade are not visible outside the
// character thread. The passing journeys cover the encounter decisions.
const source = fs.readFileSync('characters/shared.js', 'utf8');
function fixture() {
  const reads = { realm: 0 };
  const parent = {};
  let region = 'US', identifier = 'I';
  Object.defineProperty(parent, 'server_region', { get: () => { reads.realm++; return region; } });
  Object.defineProperty(parent, 'server_identifier', { get: () => identifier });
  const context = vm.createContext({ String, Number, JSON, Date, Map, WeakMap, Object, parent,
    character: { map: 'main', in: 'main' }, coordinatorClockOffset: 0, passiveHunting: { rules: {} },
    fightDeaths: [], groupedCombat: { deaths: [], passingEncounters: [] }, peerPassingEncounters: [], passingEncounters: {},
    committedHuntEncounter: () => false, huntTravelDefense: () => false, passiveTravelInterruptible: () => false, passiveStopRequired: () => false });
  for (const name of ['reunionRealm', 'passingKey', 'isPassingEncounter']) vm.runInContext(namedFunction(source, name), context);
  return { context, reads, realm: (r, i) => { region = r; identifier = i; } };
}
// The key's definition: a JSON array of realm, map, instance and id.
const expectedKey = (target, character, realm) => JSON.stringify([target.server || realm, target.map || character.map,
  String(target.in == null ? character.in || character.map : target.in), String(target.id)]);

test('passing keys keep their exact JSON text for every field shape', () => {
  const { context } = fixture();
  const odd = ['', 'a"b', 'back\\slash', 'line\nbreak', 'tab\t', '\u0001', 'snow☃', 'lone\ud800', 'pair😀', '</script>', 'u '];
  const targets = [{ id: 1 }, { id: 'x', map: 'cave', in: 'cave2' }, { id: 0, in: 0 }, { id: 'y', in: null }, { id: null }, { id: 'z', server: 'EUII' },
    { id: 5, server: 7 }, { id: 6, map: 9 }, { id: 7, server: true }, ...odd.map(text => ({ id: text, map: text, in: text, server: text }))];
  for (const character of [{ map: 'main', in: 'main' }, { map: 'main' }, { map: 'a"b', in: 'c\\d' }]) {
    context.character = character;
    for (const target of targets) assert.equal(context.passingKey(target), expectedKey(target, character, 'USI'), JSON.stringify(target));
  }
});

test('encounter answers follow deaths, reservations, local encounters, realm, map and instance', () => {
  const { context, realm } = fixture();
  const now = Date.now();
  const entry = (id, extra = {}) => ({ id, server: 'USI', map: 'main', in: 'main', at: now, ...extra });
  const goo = id => ({ id, type: 'monster', mtype: 'goo', hp: 10 });
  context.peerPassingEncounters = [entry('peer'), entry('old', { at: now - 61000 }), entry('other', { server: 'USII' })];
  context.groupedCombat.passingEncounters = [entry('grouped')];
  context.passingEncounters[expectedKey(goo('local'), context.character, 'USI')] = { at: now };
  context.fightDeaths = [entry('peer2'), entry('dead', { at: now })];
  context.groupedCombat.deaths = [];
  context.peerPassingEncounters.push(entry('dead'), entry('peer2'));
  const answers = () => Object.fromEntries(['peer', 'old', 'other', 'grouped', 'local', 'dead', 'peer2', 'none'].map(id => [id, context.isPassingEncounter(goo(id))]));
  assert.deepEqual(answers(), { peer: true, old: false, other: false, grouped: true, local: true, dead: false, peer2: false, none: false });
  realm('US', 'II');
  assert.deepEqual(answers(), { peer: false, old: false, other: true, grouped: false, local: false, dead: false, peer2: false, none: false });
  realm('US', 'I'); context.character = { map: 'cave', in: 'cave' };
  assert.equal(context.isPassingEncounter(goo('peer')), false);
  context.peerPassingEncounters.push(entry('cavepeer', { map: 'cave', in: 'cave' }));
  assert.equal(context.isPassingEncounter(goo('cavepeer')), true);
  assert.equal(context.isPassingEncounter({ ...goo('cavepeer'), hp: 0 }), false);
  assert.equal(context.isPassingEncounter(null), false);
});

test('one encounter check reads the realm through the facade once', () => {
  const { context, reads } = fixture();
  const now = Date.now();
  const entry = id => ({ id, server: 'USI', map: 'main', in: 'main', at: now });
  context.fightDeaths = [entry('a')];
  context.groupedCombat.deaths = [entry('b')];
  context.peerPassingEncounters = [entry('c')];
  context.groupedCombat.passingEncounters = [entry('d')];
  context.isPassingEncounter({ id: 'warm', type: 'monster', hp: 1 });
  reads.realm = 0;
  for (let i = 0; i < 20; i++) context.isPassingEncounter({ id: 'm' + i, type: 'monster', hp: 1 });
  assert.equal(reads.realm, 20);
});
