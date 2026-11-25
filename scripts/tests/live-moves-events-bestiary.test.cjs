// The Bestiary's event sources, which left the live October additions spec (test-windows
// DESIGN.md 4.1, E22): the live row read the catalog a real client derived from G.events and
// G.monsters, so the derivation needs no game stack. The row runs the status owner's character
// report (runtime/status/character/report.ts `eventMonsterSources`) on the game definitions the
// live server loads: design/events.js, monsters.js and maps.js of the game source at
// tools/sim/pins.json's `game` commit, which `node tools/sim/setup.mts` checks out.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createReport } = require('../../runtime/status/character/report.ts');
const { spawnCatalog } = require('../../runtime/hunting/api.ts');

const design = path.resolve(__dirname, '../../.build/sim/chronal/upstream/adventureland_mongodb/design');
function gameDefinitions() {
  if (!fs.existsSync(path.join(design, 'events.js'))) throw Error('The Bestiary row needs the pinned game source at ' + design + '; run node tools/sim/setup.mts');
  const context = vm.createContext({});
  for (const file of ['events.js', 'monsters.js', 'maps.js']) vm.runInContext(fs.readFileSync(path.join(design, file), 'utf8'), context, { filename: file });
  return { events: context.events, monsters: context.monsters, maps: context.maps, items: {}, classes: {}, skills: {}, conditions: {}, drops: {} };
}

// A door that answers any read or call with itself, so the report's other sections build
// (status-report-doors.test.cjs).
const any = new Proxy(function () {}, {
  get: (_t, key) => key === Symbol.toPrimitive ? () => 0 : key === 'then' || key === 'toJSON' ? undefined : key === Symbol.iterator ? [][Symbol.iterator] : any,
  apply: () => any,
});
const doors = over => new Proxy(over, { get: (t, key) => key in t ? t[key] : any });

test('E22: the Bestiary credits each event-only monster to its event', async () => {
  const G = gameDefinitions();
  const report = createReport({
    me: () => doors({ name: 'W', map: 'main', x: 1, y: 2, items: [], slots: {}, s: {} }), G: () => G,
    parent: () => ({ entities: {} }), root: () => ({ __partyHooks: any }), initialTracker: () => null,
    game: doors({ entity: () => null }), current: () => true, sleep: () => Promise.resolve(), smart: () => null,
    owners: doors({ hunting: doors({ spawnCatalog }),
      items: doors({ reads: doors({ nativeMonsterDropTables: () => ({}), itemWorldInfo: () => {}, safeItemDefinition: v => v }) }) }),
  });
  // The catalogs ride the first report once they are prepared (report.ts `catalog`).
  await report.prepareCatalog();
  const catalog = report.snapshot().bestiaryCatalog;
  const sources = Object.fromEntries(['horseman', 'jackowalker', 'zombie', 'ghoul', 'gargoyle', 'ghost'].map(id =>
    [id, (catalog.find(monster => monster.id === id)?.eventSources || []).map(source => `${source.id}:${source.role}`)]));
  // The ghost spawns on an ordinary map, so no event claims it.
  assert.deepEqual(sources, { horseman: ['horseman:boss'], jackowalker: ['horseman:add'], zombie: ['graveyard:wave'], ghoul: ['graveyard:wave'], gargoyle: ['graveyard:boss'], ghost: [] });
});
