const { test } = require('node:test'), assert = require('node:assert/strict');
const { loadCoordinatorGeometry } = require('../../runtime/movement/coordinator/planner-geometry.ts');
const loadPlannerGeometry = (data, common) => loadCoordinatorGeometry(data, common).game;

test('planner initialization executes client preprocessing before returning geometry', () => {
  const game = loadPlannerGeometry('var G={maps:{main:{spawns:[[0,0]]}},geometry:{main:{x_lines:[],y_lines:[]}},npcs:{}};',
    'function process_game_data(){if(Place!=="client")throw Error("wrong context");G.geometry.main.x_lines.push([10,20,30]);G.maps.main.data=G.geometry.main;}');
  assert.equal(JSON.stringify(game.geometry.main.x_lines), '[[10,20,30]]');
  assert.equal(game.maps.main.data, game.geometry.main);
  // A preprocessing failure never hands the planner raw geometry.
  assert.throws(() => loadPlannerGeometry('var G={};', 'function process_game_data(){throw Error("bad data");}'), /bad data/);
  assert.throws(() => loadPlannerGeometry('var G={};', ''), /process_game_data/);
  // A game file that never finishes ends at its named bound, which the loading thread reports.
  const { evalBoundFired } = require('../../runtime/movement/coordinator/planner-geometry.ts');
  let cut;
  try { loadCoordinatorGeometry('var G={};', 'function process_game_data(){for(;;){}}', 50); } catch (error) { cut = error; }
  assert.match(String(cut), /prepare-movement\.js did not evaluate within GAME_FILE_EVAL_MS/);
  assert.equal(evalBoundFired('collision did not load: ' + String(cut)), true);
});

// Real game data through the planner worker: the processed geometry matches the live fingerprint and
// the reported routes plan and validate. The fixtures are the pinned games (scripts/ci/restore-game-fixtures.cjs),
// and the worker bundle is `.build/runtime/movement-planner.cjs`.
const path = require('node:path'), vm = require('node:vm');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { geometryFingerprint } = require('../../runtime/movement/geometry/contracts.ts');
const { createPlannerService } = require('../../runtime/movement/coordinator/planner-service.ts');
const { repairDoorApproaches } = require('../../runtime/movement/geometry/door-approach.ts');
const { validateRoute } = require('../../runtime/movement/geometry/validation.ts');
const { createNative } = require('../../tools/game/pathfinder-benchmark/native.cjs');
const { downloadedGameSource } = require('./helpers/downloaded-game.cjs');
const plannerService = () => createPlannerService(path.resolve('.build/runtime/movement-planner.cjs'), require('./helpers/run-scope.cjs').testScope('02', 'act'));
const portsOf = native => ({ game: native.game, walk: (a, b) => native.canWalk(a, b),
  door: (p, d) => native.context.is_door_close(p.map, d, p.x, p.y) && native.context.can_use_door(p.map, d, p.x, p.y), hasKey: () => false });
scenarioTable('the planner worker plans reported routes over the pinned games and validates them against game collision', () => undefined, [
 ['game 17083 collisions match the live fingerprint and the reported route plans successfully', async () => {
  const directory = path.resolve('.caracal/game_files/17083');
  const source = downloadedGameSource('data.js', 17083);
  const game = loadPlannerGeometry(source, downloadedGameSource('old_common_functions.js', 17083));
  const raw = {}; vm.runInNewContext(source, raw);
  assert.notEqual(geometryFingerprint(raw.G), geometryFingerprint(game));
  assert.equal(geometryFingerprint(game), '65911a4d-e2f70215-218667');
  assert.equal(game.geometry.main.x_lines.length - raw.G.geometry.main.x_lines.length, 4);
  assert.equal(game.geometry.main.y_lines.length - raw.G.geometry.main.y_lines.length, 4);
  const native = createNative(directory), service = plannerService();
  try {
   const prepared = service.prepare(game, 17083); await prepared.ready;
   assert.equal(prepared.fingerprint, geometryFingerprint(native.game));
   const from = { map: 'main', x: -1184, y: 232 }, to = { map: 'main', x: -1184, y: 61.8 };
   const request = { id: 'reported-route', version: 17083, fingerprint: prepared.fingerprint, from, to, town: true, speed: 60 };
   const result = await service.plan(request);
   assert.ok(result.plot.length);
   assert.equal(validateRoute(portsOf(native), from, to, result.plot, true), null);
   await assert.rejects(service.plan({ ...request, id: 'raw', fingerprint: geometryFingerprint(raw.G) }), /requested.*prepared/);
  } finally { service.dispose(); }
 }],
 ['a Winterland return includes a reachable transporter approach in both route candidates', async () => {
  const native = createNative(path.resolve('.caracal/game_files/17175')), service = plannerService(), ports = portsOf(native);
  try {
   const prepared = service.prepare(native.game, 17175); await prepared.ready;
   const from = { map: 'winterland', x: 797, y: -874 }, to = { map: 'main', x: 126, y: -413 };
   for (const town of [false, true]) {
    const result = await service.plan({ id: 'winterland-' + town, version: 17175, fingerprint: prepared.fingerprint, from, to, town, speed: 57 });
    const plot = repairDoorApproaches(ports, from, result.plot);
    assert.equal(validateRoute(ports, from, to, plot, town), null);
    const i = plot.findIndex(p => p.transport && p.map === 'main'); assert.ok(i > 0, 'the plot crosses by a transporter');
    assert.ok(Math.hypot(plot[i - 1].x + 73, plot[i - 1].y + 393) < 75, 'the step before it stands at the transporter');
   }
  } finally { service.dispose(); }
 }],
]);
