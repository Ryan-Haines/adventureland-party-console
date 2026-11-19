const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { createPlannerService } = require('../../runtime/movement/coordinator/planner-service.ts');
const { repairDoorApproaches } = require('../../runtime/movement/geometry/door-approach.ts');
const { validateRoute } = require('../../runtime/movement/geometry/validation.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture}=require('./fixtures/daisy-door-routes-scenario.cjs');
scenarioTable('routes through doors validate completely, keep their transition and refuse locked doors (MOV-010)', fixture, [
 ['Daisy to both booboo spawns validates completely after the bounded walking repair', async ({ native, ports })=>{
  const service = createPlannerService(path.resolve('.build/runtime/movement-planner.cjs'), require('./helpers/run-scope.cjs').testScope('02', 'act'));
  const from = { map:'main', x:126, y:-413 };
  try {
    const prepared = service.prepare(native.game, 17175); await prepared.ready;
    assert.equal(prepared.fingerprint, '65911a4d-e2f70215-218667');
    for (const to of [{ map:'spookytown', x:415, y:-702 }, { map:'spookytown', x:-695, y:-785 }]) {
      const result = await service.plan({ id:JSON.stringify(to), version:17175, fingerprint:prepared.fingerprint,
        from, to, town:false, speed:60, base:{h:8,v:7,vn:2} });
      let plot = repairDoorApproaches(ports, from, result.plot);
      const issue = validateRoute(ports, from, to, plot, false);
      if (issue) {
        assert.equal(issue.reason, 'collisions detected');
        assert.equal(issue.from.map, 'main');
        const connector = native.query({from, to:issue.to, town:false},42,3000);
        assert.equal(connector.error, null);
        const bridge = connector.path.map(p => ({...p, transport:p.method==='transport', town:p.method==='town', s:p.spawn}));
        assert.ok(bridge.every(p => p.map==='main' && !p.transport && !p.town));
        plot = [...bridge, ...plot.slice(plot.indexOf(issue.to)+1)];
      }
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
  assert.ok(checks > 100, 'exercise the local search, not just direct rejection');
  assert.ok(checks < 17000, 'at most 2048 expansions with eight edges plus direct candidates');
 }],
]);
