const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { createPlannerService } = require('../../runtime/movement/coordinator/planner-service.ts');
const { repairDoorApproaches } = require('../../runtime/movement/geometry/door-approach.ts');
const { validateRoute } = require('../../runtime/movement/geometry/validation.ts');
const { DOOR_DETOUR_EXPANSIONS } = require('../../runtime/movement/rules.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/daisy-door-routes-scenario.cjs');
scenarioTable('routes through doors validate completely, keep their transition and refuse locked doors (MOV-010)', fixture, [
 // The planner's own plot, after the door repair every install runs (owner.ts `install`), validates whole on the
 // pinned game with no Town step. No walking leg of it collides, so the journey repair (owner.ts `beginRepair`)
 // has nothing to bridge.
 ['Daisy to both booboo spawns validates completely after the door repair', async ({ native, ports })=>{
  const service = createPlannerService(path.resolve('.build/runtime/movement-planner.cjs'), require('./helpers/run-scope.cjs').testScope('02', 'act'));
  const from = { map:'main', x:126, y:-413 };
  try {
    const prepared = service.prepare(native.game, 17175); await prepared.ready;
    assert.equal(prepared.fingerprint, '65911a4d-e2f70215-218667');
    for (const to of [{ map:'spookytown', x:415, y:-702 }, { map:'spookytown', x:-695, y:-785 }]) {
      const result = await service.plan({ id:JSON.stringify(to), version:17175, fingerprint:prepared.fingerprint,
        from, to, town:false, speed:60, base:{h:8,v:7,vn:2} });
      const plot = repairDoorApproaches(ports, from, result.plot);
      assert.equal(validateRoute(ports, from, to, plot, false), null);
      assert.equal(plot.some(p => p.town), false);
    }
  } finally { service.dispose(); }
 }],
 ['level1 door detour walks around the wall and retains the selected transition', ({ ports })=>{
 const  from = {map:'level1',x:-377,y:576};
  const transition = {map:'level2',x:1,y:-5,transport:true,s:1};
  assert.match(validateRoute(ports,from,transition,[transition],false).reason,/approach/);
  const repaired = repairDoorApproaches(ports,from,[transition]);
  assert.ok(repaired.length > 2);
  assert.equal(repaired.at(-1),transition);
  assert.equal(validateRoute(ports,from,transition,repaired,false),null);
 }],
 ['inaccessible or locked doors remain rejected without changing the destination', ({ ports })=>{
 const  from = {map:'level1',x:-377,y:576};
  const transition = {map:'level2',x:1,y:-5,transport:true,s:1};
  const blocked = {...ports,walk:()=>false};
  assert.deepEqual(repairDoorApproaches(blocked,from,[transition]),[transition]);
  const door = ports.game.maps.level1.doors.find(d=>d[4]==='level2'); door[7]='key';
  assert.deepEqual(repairDoorApproaches(ports,from,[{...transition,key:'bkey'}]),[{...transition,key:'bkey'}]);
 }],
 ['unreachable door search stays within its fixed collision-check budget', ({ ports })=>{
 const  from = {map:'level1',x:-377,y:576};
  const transition = {map:'level2',x:1,y:-5,transport:true,s:1};
  let checks = 0;
  const isolated = {...ports, walk:(a,b) => { checks++; return b.x <= from.x && ports.walk(a,b); }};
  assert.deepEqual(repairDoorApproaches(isolated,from,[transition]),[transition]);
  // With every check refused, each candidate point costs one check; a candidate that passes costs at
  // most three (door-approach.ts: its own point, the walk to it, stepIssue's walk).
  let candidates = 0;
  repairDoorApproaches({...ports, walk:() => { candidates++; return false; }},from,[transition]);
  assert.ok(checks > 3 * candidates, 'exercise the local search, not just direct rejection');
  // Each expansion checks its eight grid neighbours and one target step (door-detour.ts expand, stepIssue).
  assert.ok(checks <= DOOR_DETOUR_EXPANSIONS * 9 + 3 * candidates, 'at most DOOR_DETOUR_EXPANSIONS expansions plus the direct candidates');
 }],
]);
// MOV-010's cap: an open grid whose one reachable candidate sits off the 8-unit grid is searched
// until DOOR_DETOUR_EXPANSIONS, then the search stops and tells the bound record. The grid holds
// (2 x 28 + 1) squared nodes, more than the cap, so the cap ends it.
test('a door detour that finds no approach stops at DOOR_DETOUR_EXPANSIONS and tells the bound record (MOV-010)', () => {
  const { doorDetour } = require('../../runtime/movement/geometry/door-detour.ts');
  const { boundsPending, boundsSent } = require('../../runtime/status/api.ts');
  boundsSent(boundsPending().length);
  const from = { map: 'm', x: 0, y: 0 }, candidate = { map: 'm', x: 100, y: 0 }, to = { map: 'm', x: 1000, y: 1000 };
  // Each node the search takes checks its step to the target once (door-detour.ts stepIssue).
  let taken = 0;
  const ports = { game: { maps: { m: {} } }, door: () => false, hasKey: () => false,
    walk: (a, b) => { if (b !== to) return true; if (a !== candidate) taken++; return a === candidate; } };
  assert.equal(doorDetour(ports, from, to, [candidate]), undefined);
  const firing = boundsPending().find(entry => entry.bound === 'DOOR_DETOUR_EXPANSIONS');
  assert.equal(firing?.owner, '02');
  assert.ok(taken > 0 && taken <= DOOR_DETOUR_EXPANSIONS, 'the search takes at most DOOR_DETOUR_EXPANSIONS nodes, ' + taken);
  boundsSent(boundsPending().length);
});
