// Isolated test for the idle-aggro route cost.
// Failure list first.
// A run cannot hold a wandering idle
// monster at a fixed offset from a route for each case below, so this is isolated; the
// walks scenario covers the rule in play. Blocks follow the server's 32-unit grid: a
// monster in cell (cx, cy) aggroes a player standing in the 3x3 cells around it.
const assert=require('node:assert/strict');
const {routeAroundIdleAggro}=require('../../runtime/movement/geometry/route-aggro.ts');
const {idle,open}=require('./fixtures/step-safety-scenario.cjs');
const {p,enters}=require('./fixtures/route-aggro-scenario.cjs');
const {scenarioTable}=require('./fixtures/scenarios.cjs');

scenarioTable("the route cost walks around idle aggro blocks and keeps the line where no detour fits (MOV-027)", ()=>routeAroundIdleAggro, [
 ['a journey walks through an idle pack: a segment detours around a block, never into another, and keeps its line from inside a block, past a busy monster or with no detour', routeAroundIdleAggro=>{
  // A bee in cell (5, 0); its block covers x 128 to 224 and y -32 to 64.
  const bee=idle('bee',176,16), plot=[p(0,16),p(400,16)];
  const {plot:routed,detours}=routeAroundIdleAggro(plot,[bee],open);
  assert.equal(detours,1);
  assert.equal(enters(routed,[bee]),false);
  assert.deepEqual(routed[0],plot[0]);
  assert.deepEqual(routed.at(-1),plot.at(-1));
  assert.ok(routed.every(step=>step.map==='main'));
  // Blocks above and below leave the detour no room to enter another one.
  const bees=[idle('a',176,16),idle('b',176,112),idle('c',176,-80)];
  assert.equal(enters(routeAroundIdleAggro(plot,bees,open).plot,bees),false);
  // A segment that starts or ends inside the block keeps its line.
  for(const inside of [[p(170,20),p(400,20)],[p(0,20),p(180,20)]]){
    const kept=routeAroundIdleAggro(inside,[bee],open);
    assert.equal(kept.detours,0);
    assert.deepEqual(kept.plot,inside);
  }
  // A monster with a target, no aggro or no life adds no cost.
  for(const busy of [idle('bee',176,16,{target:'someone'}),idle('bee',176,16,{aggro:0}),idle('bee',176,16,{aggro:undefined}),idle('bee',176,16,{dead:true})])
    assert.deepEqual(routeAroundIdleAggro(plot,[busy],open).plot,plot);
  // Only the straight line itself is walkable, so the line stays and counts its crossing.
  const straight=(a,b)=>a.y===16&&b.y===16;
  const blocked=routeAroundIdleAggro(plot,[bee],straight);
  assert.deepEqual(blocked.plot,plot);
  assert.equal(blocked.detours,0);
  assert.equal(blocked.crossings,1);}],
]);
