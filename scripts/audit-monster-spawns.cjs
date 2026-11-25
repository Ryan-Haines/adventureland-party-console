// Read-only audit of trusted, locally installed executable game data.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { spawnCatalog } = require('../runtime/hunting/api.ts');

// The catalog the console farms from: the hunting owner's `spawnCatalog` through its door (runtime/hunting/api.ts),
// with no sprites.
function catalog(G) {
  return JSON.parse(JSON.stringify(spawnCatalog(G)));
}

function audit(G) {
  const choices = catalog(G);
  const monsters = choices.map(monster => {
    // Independently scan every map, including excluded source maps.
    const rawSpawns = Object.entries(G.maps).flatMap(([map, definition]) =>
      (Array.isArray(definition.monsters) ? definition.monsters : [])
        .filter(spawn => spawn?.type === monster.id).map(spawn => ({ sourceMap: map, ...spawn })));
    return { id: monster.id, locationCount: monster.locations.length,
      rawSpawns, spawnRecords: monster.spawnRecords };
  });
  return { monsterCount: monsters.length,
    noLocations: monsters.filter(monster => !monster.locationCount).length,
    noMapRecords: monsters.filter(monster => !monster.rawSpawns.length).length,
    monsters };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/audit-monster-spawns.cjs <trusted game data.js>');
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.resolve(file), 'utf8'), context, { filename: file, timeout: 10000 });
  console.log(JSON.stringify(audit(context.G), null, 2));
}
module.exports = { catalog, audit };
