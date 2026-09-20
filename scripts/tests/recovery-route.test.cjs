const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {recoveryRoute}=require('../../runtime/combat/recovery-route.ts');
function complete(search){for(let i=0;i<130;i++){const result=search.tick();if(result!==undefined)return result;}throw Error('unbounded search');}
test('recovery routes around monster clearance instead of planning through it and failing while walking',()=>{
 const start={x:0,y:0},goal={x:180,y:0};
 function clear(a,b){const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
  const f=len?Math.max(0,Math.min(1,((90-a.x)*dx-a.y*dy)/len)):0;
  return Math.hypot(a.x+f*dx-90,a.y+f*dy)>32;
 }
 const search=recoveryRoute(start,goal,clear);start.x=999; // Moving client objects cannot mutate the search origin.
 const path=complete(search);assert.ok(path?.length>1);let previous={x:0,y:0};
 for(const point of path){assert.ok(clear(previous,point));previous=point;}assert.deepEqual(previous,goal);
});
test('Winter Cave recovery finds collision-safe route from captured party position to nearby approach side',t=>{
 const c=vm.createContext({G:{},character:{map:'winter_cave',x:-244.4277381244933,y:-0.2802576061211024,base:{h:8,v:7,vn:2}}});
 if(!require('./helpers/game-geometry.cjs').installGameGeometry(c))return t.skip('native geometry unavailable');
 const clear=(a,b)=>c.can_move({map:'winter_cave',x:a.x,y:a.y,going_x:b.x,going_y:b.y,base:c.character.base});
 const goal={x:-335.8132364734755,y:-164.36929068136615};
 const path=complete(recoveryRoute(c.character,goal,clear));assert.ok(path?.length);
 let previous=c.character;for(const p of path){assert.ok(clear(previous,p));previous=p;}
 assert.deepEqual(previous,goal);
});
test('no route terminates with an explicit failure',()=>{
 assert.equal(complete(recoveryRoute({x:0,y:0},{x:100,y:100},()=>false)),null);
});

test('a passage between coarse grid lines retries at finer resolution',()=>{
 const start={x:0,y:0},goal={x:32,y:0};
 const corridor=[start,{x:0,y:8},{x:8,y:8},{x:16,y:8},{x:24,y:8},{x:32,y:8},goal];
 const index=p=>corridor.findIndex(q=>q.x===p.x&&q.y===p.y);
 const clear=(a,b)=>index(a)>=0&&index(b)>=0&&Math.abs(index(a)-index(b))<=1;
 assert.ok(complete(recoveryRoute(start,goal,clear))?.length);
});

test('captured Arena followers reach the priest through the narrow passage',t=>{
 const goal={x:681.4298435591344,y:-319.03938308003706};
 for(const start of [{x:880,y:-380},{x:610,y:-144}]){
  const c=vm.createContext({G:{},character:{map:'arena',...start,base:{h:8,v:7,vn:2}}});
  if(!require('./helpers/game-geometry.cjs').installGameGeometry(c))return t.skip('native geometry unavailable');
  const clear=(a,b)=>c.can_move({map:'arena',x:a.x,y:a.y,going_x:b.x,going_y:b.y,base:c.character.base});
  const path=complete(recoveryRoute(start,goal,clear));assert.ok(path?.length);
  let previous=start;for(const p of path){assert.ok(clear(previous,p));previous=p;}
  assert.deepEqual(previous,goal);
  assert.ok(path.some((p,i)=>Math.hypot(p.x-goal.x,p.y-goal.y)>Math.hypot((i?path[i-1]:start).x-goal.x,(i?path[i-1]:start).y-goal.y)), 'wall requires a temporary detour away from priest');
 }
});
