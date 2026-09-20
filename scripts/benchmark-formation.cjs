// Isolated numeric/formation benchmark: never attaches to the running game.
const fs = require('node:fs'), vm = require('node:vm'), { performance } = require('node:perf_hooks');
const fixture = fs.readFileSync('scripts/tests/priest-formation.test.cjs', 'utf8');
const box = vm.createContext({ require, process });
vm.runInContext(fixture.slice(0, fixture.indexOf("test('")), box);
for (const role of ['warrior', 'priest', 'mage']) for (const count of [1, 10, 30, 60]) {
  for (const fields of [0, 100]) {
    const r = box.setup(role === 'priest');
    r.c.character.ctype = role;
    r.monster.target = r.c.character.name;
    if (role === 'priest') r.monster.x = 170;
    if (role === 'mage') { r.c.character.range = 200; r.c.character.x = 270; }
    for (let i = 0; i < count; i++) {
      const angle = i * 2 * Math.PI / count;
      const e = { id: 'E' + i, type: 'monster', mtype: 'goo', map: 'main', visible: true,
        x: r.c.character.x + Math.cos(angle) * 80, y: Math.sin(angle) * 80,
        speed: 40, moving: true, going_x: r.c.character.x, going_y: 0 };
      for (let j = 0; j < fields; j++) e['field' + j] = j;
      r.entities[e.id] = e;
    }
    for (let j = 0; j < fields; j++) r.c.character['field' + j] = j;
    if (process.argv.includes('--game-geometry')) {
      if (!require('./tests/helpers/game-geometry.cjs').installGameGeometry(r.c))
        throw Error('Downloaded game geometry is required for --game-geometry');
      for (const entity of [r.warrior, r.priest, ...Object.values(r.entities)]) {
        entity.map = 'winter_cave'; entity.awidth = 24; entity.aheight = 32;
      }
      r.c.character.base = { h: 8, v: 7, vn: 2 };
    }
    const samples = [];
    for (let i = 0; i < 120; i++) {
      r.now(10000 + i * 100);
      const start = performance.now(); r.c.formationMove(r.monster);
      if (i >= 20) samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ role, monsters: count, extraFields: fields, gameGeometry: process.argv.includes('--game-geometry'),
      meanMs: +(samples.reduce((a, b) => a + b) / samples.length).toFixed(3),
      p95Ms: +samples[94].toFixed(3), collisionChecksPerTick:
        +(r.c.formationPerformance.collisionChecks / r.c.formationPerformance.ticks).toFixed(2) }));
  }
}
