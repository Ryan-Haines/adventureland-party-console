const assert=require('node:assert/strict'),vm=require('node:vm');
const {recoveryRoute}=require('../../runtime/movement/character/formation.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
function complete(search){for(let i=0;i<130;i++){const result=search.tick();if(result!==undefined)return result;}throw Error('unbounded search');}
scenarioTable("the recovery route search finds a clear multi-goal route or fails explicitly (MOV-091)", ()=>complete, [
 ['the recovery route search finds the clear route: around monster clearance, and through a passage between coarse grid lines', complete=>{
 {const start={x:0,y:0},goal={x:180,y:0};
  function clear(a,b){const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
   const f=len?Math.max(0,Math.min(1,((90-a.x)*dx-a.y*dy)/len)):0;
   return Math.hypot(a.x+f*dx-90,a.y+f*dy)>32;
  }
  const search=recoveryRoute(start,goal,clear);start.x=999; // Moving client objects cannot mutate the search origin.
  const path=complete(search);assert.ok(path?.length>1);let previous={x:0,y:0};
  for(const point of path){assert.ok(clear(previous,point));previous=point;}assert.deepEqual(previous,goal);}
 {const start={x:0,y:0},goal={x:32,y:0};
  const corridor=[start,{x:0,y:8},{x:8,y:8},{x:16,y:8},{x:24,y:8},{x:32,y:8},goal];
  const index=p=>corridor.findIndex(q=>q.x===p.x&&q.y===p.y);
  const clear=(a,b)=>index(a)>=0&&index(b)>=0&&Math.abs(index(a)-index(b))<=1;
  assert.ok(complete(recoveryRoute(start,goal,clear))?.length);}}],
 // The probe counts bound the native can_move calls one search makes, a per-call cost the
 // rule "no more per-tick work than b9b5c91e" holds the search to.
 ['a multi-corner approach over captured level1 geometry makes fewer than 600 collision probes', (complete,t)=>{
  for(const reach of [21,161.5]){
   const start={x:0,y:395.76},target={x:-11,y:115};
   const c=vm.createContext({G:{},character:{map:'level1',...start,base:{h:8,v:7,vn:2}}});
   if(!require('./helpers/game-geometry.cjs').installGameGeometry(c,require('./helpers/installed-game.cjs').version))return t.skip('native geometry unavailable');
   let probes=0;
   const clear=(a,b)=>{probes++;return c.can_move({map:'level1',x:a.x,y:a.y,going_x:b.x,going_y:b.y,base:c.character.base});};
   const goals=[],reaches=[reach,(reach+Math.min(reach,42))/2,Math.min(reach,42)];
   for(const radius of reaches.filter((r,i)=>i===0||Math.abs(r-reaches[i-1])>1))for(let side=0;side<16;side++){
    const angle=side*Math.PI/8,point={x:target.x+Math.cos(angle)*radius,y:target.y+Math.sin(angle)*radius};
    if(clear(point,point))goals.push(point);
   }
   probes=0;const path=complete(recoveryRoute(start,goals,clear));
   assert.ok(path?.length,'a real terrain-safe path must be found');
   assert.ok(probes<600,`${reach}-range approach made ${probes} redundant native probes`);
   let previous=start;for(const point of path){assert.ok(clear(previous,point));previous=point;}
   assert.ok(goals.some(goal=>goal.x===previous.x&&goal.y===previous.y),'endpoint remains an authorized goal');
  }}],
 ['a clear distant endpoint is a direct single-edge route after one probe', complete=>{
  const start={x:0,y:0},goal={x:1800,y:100};let probes=0;
  assert.deepEqual(complete(recoveryRoute(start,goal,()=>{probes++;return true;})),[goal]);
  assert.equal(probes,1);}],
 // A walled-in goal: the search spreads to its reach and counts the nodes the reach drops, and a
 // tick that stops on its expansion cap counts that cap, each as a cap count, not a bound firing.
 ['a search the reach and the tick cap cut counts each cap', complete=>{
  const {boundsPending,boundsSent}=require('../../runtime/status/api.ts');boundsSent(boundsPending().length);
  const goal={x:100,y:0},clear=(a,b)=>Math.hypot(b.x-goal.x,b.y-goal.y)>8;
  assert.equal(complete(recoveryRoute({x:0,y:0},goal,clear)),null);
  const counts=Object.fromEntries(boundsPending().filter(f=>f.cap).map(f=>[f.bound,f.state.count]));
  assert.ok(counts.ROUTE_REACH>0,'the reach drops nodes');assert.ok(counts.ROUTE_TICK_EXPANSIONS>0,'a tick stops on its cap');
  boundsSent(boundsPending().length);}],
]);
