import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import * as planner from 'alpathfinder';
import type {GData,MapKey} from 'typed-adventureland';

// Reproducible offline route research; no characters or live game requests.
const version=process.argv[2]??'18183';
if(!/^\d+$/.test(version))throw Error('Expected native game version');
const context=vm.createContext({console,Place:'client'});
for(const file of ['data.js','old_common_functions.js'])vm.runInContext(fs.readFileSync(path.join('.caracal/game_files',version,file),'utf8'),context);
vm.runInContext('process_game_data()',context);
const game=context.G as GData;
const native=createRequire(import.meta.url)('./pathfinder-benchmark/native.cjs').createNative(path.join('.caracal/game_files',version));
// New event definitions are absent from the pinned upstream type package.
const doors=(context.G.events.trickortreat.doors as [MapKey,number,number][]).map(([map,x,y])=>({map,x,y:y+40}));
planner.prepare(game);
const points=[...doors,{map:'halloween' as MapKey,x:0,y:0}];
const legs=points.map((from,i)=>points.map((to,j)=>{
  if(i===j)return {distance:0,path:[]};
  let route=planner.getPath(from.map,from.x,from.y,to.map,to.x,to.y,{speed:10000});
  if(!route)throw Error(`No path ${i} -> ${j}`);
  let probe=from;
  const valid=route.every(node=>{const okay=node.method!=='move'||node.map!==probe.map||native.canWalk(probe,node);probe=node;return okay;});
  if(!valid){const fallback=native.query({from,to,town:false});if(fallback.error)throw Error(`Native route ${i} -> ${j}: ${fallback.error}`);route=fallback.path;}
  if(!route)throw Error('Missing native route');
  let previous=from,distance=0;
  for(const node of route){
    if(node.map===previous.map){
      if(node.method==='move' && !context.can_move({map:node.map,x:previous.x,y:previous.y,going_x:node.x,going_y:node.y,base:{h:8,v:7,vn:2}}))throw Error(`Native collision rejected ${i} -> ${j}`);
      distance+=Math.hypot(node.x-previous.x,node.y-previous.y);
    }else distance+=300;
    previous=node;
  }
  return {distance,path:route};
}));
let best:number[]=[],cost=Infinity,count=0;
function visit(order:number[],remaining:number[],length:number){
  if(!remaining.length){count++;if(length<cost){cost=length;best=order;}return;}
  for(const id of remaining)visit([...order,id],remaining.filter(other=>other!==id),length+legs[order.at(-1)??7][id].distance);
}
visit([],doors.map((_,i)=>i),0);
fs.mkdirSync('.build/october-research',{recursive:true});
fs.writeFileSync('.build/october-research/door-route.json',JSON.stringify({version,start:points[7],crossMapCost:300,permutations:count,route:best,cost,doors,legs},null,2));
console.log(JSON.stringify({route:best,cost,permutations:count,evidence:'.build/october-research/door-route.json'}));
