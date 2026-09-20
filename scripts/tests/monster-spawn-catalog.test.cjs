const { test } = require('node:test');
const assert = require('node:assert/strict');
const { catalog, audit } = require('../audit-monster-spawns.cjs');
const { farmingAreas, validFarmingLocation } = require('../../.build/shared/farming-areas.cjs');
const box = [-621, -241, -234, -65];
const spawn = (type, extra = {}) => ({ type, count: 1, boundary: box, ...extra });
function game(maps, extraIds = []) {
  const ids = [...extraIds, ...Object.values(maps).flatMap(map => map.monsters.map(s => s.type))];
  return { maps, monsters: Object.fromEntries(ids.map(id => [id, { name: id }])) };
}

test('all seven omitted monsters gain routes on unlisted maps; Pom Pom retains both regions', () => {
  const maps = {
    level2n: { unlist: true, monsters: [spawn('pppompom', { count: 6 }), spawn('pppompom', { boundary: [153,-303,432,-75], count: 7 })] },
    mforest: { unlist: true, monsters: [spawn('odino'), spawn('dryad')] },
    level2w: { unlist: true, monsters: [spawn('oneeye')] },
    level2e: { unlist: true, monsters: [spawn('pinkgoblin', { polygon: [[0,0],[10,0],[0,10]] })] },
    uhills: { unlist: true, monsters: [spawn('sparkbot'), spawn('targetron')] },
  };
  const choices = catalog(game(maps));
  assert.equal(choices.length, 7);
  assert.ok(choices.every(m => m.locations.length && m.spawnRecords.every(s => !s.restrictions.length)));
  const areas = farmingAreas(choices, ['pppompom']);
  assert.equal(areas.length, 2);
  for (const area of areas) assert.ok(validFarmingLocation(choices, ['pppompom'], area));
  assert.deepEqual(choices.find(m => m.id === 'pinkgoblin').locations[0].polygon, [[0,0],[10,0],[0,10]]);
});

test('existing monsters retain public regions and gain previously omitted regions', () => {
  const ids = ['greenfairy','redfairy','bluefairy','cgoo','mummy','bbpompom'];
  const choices = catalog(game({ main: { monsters: ids.map(id => spawn(id)) },
    hidden: { unlist: true, monsters: ids.map(id => spawn(id)) } }));
  assert.ok(choices.every(m => m.locations.length === 2));
});

test('restricted records remain inspectable but never become farming destinations', () => {
  const maps = Object.fromEntries(['ignore','instance','irregular'].map(flag =>
    [flag, { [flag]: true, monsters: [spawn(flag)] }]));
  maps.main = { monsters: [spawn('zero', { count: 0 }), spawn('invalid', { boundary: undefined })] };
  const choices = catalog(game(maps));
  assert.ok(choices.every(m => !m.locations.length && m.spawnRecords.length === 1));
  assert.deepEqual(choices.find(m => m.id === 'zero').spawnRecords[0].restrictions, ['zero-count']);
  assert.deepEqual(choices.find(m => m.id === 'invalid').spawnRecords[0].restrictions, ['invalid-geometry']);
  for (const m of choices) assert.equal(validFarmingLocation(choices, [m.id], { map: m.spawnRecords[0].map, x: -427, y: -153 }), null);
  assert.equal(audit(game(maps)).noLocations, 5);
});

test('Jrs, five cross-map Phoenix regions, passive rares and point spawns retain behavior', () => {
  const G = game({ main: { monsters: [spawn('jr'), spawn('greenjr'),
    spawn('phoenix', { boundary: undefined, boundaries: ['main','main','main','halloween','cave'].map((map, i) => [map,i*100,0,i*100+10,10]) }),
    spawn('point', { boundary: undefined, position: [12,34] })] },
    halloween: { monsters: [] }, cave: { monsters: [] } }, ['cutebee','goldenbat']);
  const choices = catalog(G);
  assert.equal(choices.find(m => m.id === 'phoenix').locations.length, 5);
  for (const id of ['jr','greenjr','point']) assert.equal(choices.find(m => m.id === id).locations.length, 1);
  for (const id of ['cutebee','goldenbat']) assert.deepEqual(choices.find(m => m.id === id).spawnRecords, []);
  assert.equal(audit(G).noMapRecords, 2);
});

test('cross-map records honor source and destination restrictions and missing maps', () => {
  const G = game({ source: { unlist: true, monsters: [spawn('multi', { boundary: undefined,
    boundaries: [['ok',0,0,10,10],['restricted',0,0,10,10],['missing',0,0,10,10]] })] },
    ok: { unlist: true, monsters: [] }, restricted: { instance: true, monsters: [] },
    ignored: { ignore: true, monsters: [spawn('blocked', { boundary: undefined, boundaries: [['ok',0,0,10,10]] })] } });
  const choices = catalog(G), multi = choices.find(m => m.id === 'multi');
  assert.deepEqual(multi.locations.map(l => l.map), ['ok']);
  assert.equal(multi.spawnRecords.length, 3);
  assert.ok(multi.spawnRecords.every(s => s.sourceMap === 'source'));
  assert.equal(choices.find(m => m.id === 'blocked').locations.length, 0);
});
