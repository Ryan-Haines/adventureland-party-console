const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {recoveryRoute}=require('../../runtime/movement/character/formation.ts');
const {createNative}=require('./pathfinder-benchmark/native.cjs');
const {directory,version}=require('../../scripts/tests/helpers/installed-game.cjs');
const native=createNative(directory),base={h:8,v:7,vn:2},results=[];
for(const reach of [21,161.5]){
 const start={x:0,y:395.76},target={x:-11,y:115};let probes=0;
 const clear=(a,b)=>{probes++;return native.context.can_move({map:'level1',x:a.x,y:a.y,going_x:b.x,going_y:b.y,base});};
 const reaches=[reach,(reach+Math.min(reach,42))/2,Math.min(reach,42)],goals=[];
 for(const radius of reaches.filter((r,i)=>i===0||Math.abs(r-reaches[i-1])>1))for(let side=0;side<16;side++){
  const angle=side*Math.PI/8,point={x:target.x+Math.cos(angle)*radius,y:target.y+Math.sin(angle)*radius};if(clear(point,point))goals.push(point);
 }
 probes=0;const search=recoveryRoute(start,goals,clear),started=performance.now();let ticks=0,route;
 while(route===undefined&&ticks<1000){ticks++;route=search.tick();}
 assert.ok(route?.length);const nativeProbes=probes;let previous=start;
 for(const point of route){assert.ok(clear(previous,point),'every route edge is native collision clear');previous=point;}
 assert.ok(goals.some(goal=>goal.x===previous.x&&goal.y===previous.y),'endpoint belongs to authorized goal set');
 results.push({reach,start,target,goals:goals.length,ticks,nativeProbes,elapsedMs:performance.now()-started,route});
}
const output=path.resolve(process.argv[2]||'.build/native-combat-planner-replay.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({version,map:'level1',source:'38228085482 shard14 native multi-corner geometry',results},null,2));
console.log(JSON.stringify({output,version,scenarios:results.length,probes:results.map(r=>r.nativeProbes),ticks:results.map(r=>r.ticks)}));
