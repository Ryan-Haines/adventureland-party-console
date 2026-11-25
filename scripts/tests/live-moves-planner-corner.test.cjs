// The planner's corner edges (#147, MOV-028), which left the live W10 window (test-windows
// DESIGN.md 4.3, C19): the live row planned through the coordinator's /movement-plan route and
// checked each edge with the game server's can_move. Here the planner worker runs on the newest
// pinned game with the game's own collision, and the pinned game's can_move checks each edge.
// The worker runs from its source (planner-worker.ts), so the check reads the code it guards. W10
// keeps the unrepaired walk and the walk back on unloadable game files.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { scenarioTable } = require('./fixtures/scenarios.cjs');
const { createPlannerService } = require('../../runtime/movement/coordinator/planner-service.ts');
const { createNative } = require('../../tools/game/pathfinder-benchmark/native.cjs');
const { testScope } = require('./helpers/run-scope.cjs');
const { versions } = require('./fixtures/game/manifest.json');

// The corner and the tunnel door from the failure report (#147): from main (135, 72) the
// planner's own first edge to (153, -51) crosses the wall at x=144.
const start = { map: 'main', x: 135, y: 72 }, door = { map: 'main', x: 311, y: -328 }, base = { h: 8, v: 7, vn: 2 };
// The other reported corners, and two other character bases on the corner and in the open.
const corners = [[87, -208, 105, -235], [-457, 261, -337, 280], [-457, 280, -439, 261], [343, -200, 311, -219], [-119, 149, -137, 168], [-345, -656, -327, -616]]
  .map(([x, y, tx, ty]) => ({ from: { map: 'main', x, y }, to: { map: 'main', x: tx, y: ty }, base }))
  .concat([{ from: start, to: door, base: { h: 6, v: 5, vn: 1 } }, { from: { map: 'main', x: 100, y: 100 }, to: { map: 'main', x: 100, y: -100 }, base: { h: 12, v: 9, vn: 4 } }]);

async function planner() {
  const version = versions.map(v => v.version).sort((x, y) => Number(y) - Number(x))[0];
  const directory = path.resolve('.caracal/game_files', version), native = createNative(directory);
  const service = createPlannerService(path.resolve('runtime/movement/coordinator/planner-worker.ts'), testScope('02', 'act'));
  const collision = { data: fs.readFileSync(path.join(directory, 'data.js'), 'utf8'), common: fs.readFileSync(path.join(directory, 'old_common_functions.js'), 'utf8') };
  const prepared = service.prepare(native.game, Number(version), collision);
  await prepared.ready;
  let id = 0;
  const plan = sample => service.plan({ id: 'corner-' + ++id, version: Number(version), fingerprint: prepared.fingerprint,
    from: { in: 'main', ...sample.from }, to: { in: 'main', ...sample.to }, town: false, speed: 55, base: sample.base });
  // Every same-map walking edge of a plot, with the game's can_move for the character's base.
  const rejected = (from, plot, edgeBase) => [from, ...plot].slice(1).map((b, i, rest) => [i ? rest[i - 1] : from, b])
    .filter(([p, q]) => p.map === q.map && !q.transport && !q.town && !native.context.can_move({ map: p.map, x: p.x, y: p.y, going_x: q.x, going_y: q.y, base: edgeBase }));
  return { native, plan, rejected, dispose: () => service.dispose() };
}

scenarioTable('the planner worker routes around corners the game rejects', planner, [
  ['the route from the town corner holds no edge the game rejects, with one detour point in front of the corner', async ({ native, plan, rejected, dispose }) => {
    try {
      const result = await plan({ from: start, to: door, base });
      assert.deepEqual(rejected(start, result.plot, base), [], 'The planned route must contain no edge the game rejects');
      // The plot opens with the start itself, so one detour point is one point between the two.
      const corner = result.plot.findIndex(p => p.map === 'main' && Math.hypot(p.x - 153, p.y + 51) <= 1);
      const before = result.plot.slice(0, corner).filter(p => Math.hypot(p.x - start.x, p.y - start.y) > 1);
      assert.ok(corner > 0, 'The route keeps the planner\'s point past the corner');
      assert.equal(before.length, 1, 'One detour point in front of the corner');
      assert.equal(native.context.can_move({ map: 'main', x: start.x, y: start.y, going_x: 153, going_y: -51, base }), false, 'The planner\'s own edge past the corner is one the game rejects');
    } finally { dispose(); }
  }],
  ['every reported corner plans a route whose edges pass the game\'s collision', async ({ plan, rejected, dispose }) => {
    try {
      for (const [index, sample] of corners.entries()) {
        const result = await plan(sample);
        assert.ok(!result.error, 'Reported corner ' + index + ' must produce a route');
        assert.deepEqual(rejected(sample.from, result.plot, sample.base), [], 'Every sampled edge must pass native collision');
      }
    } finally { dispose(); }
  }],
]);
