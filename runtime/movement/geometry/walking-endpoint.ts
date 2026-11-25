// The walking endpoint ("walking endpoint and interior"): repairWalkingEndpoint connects the native
// search's exact goal, which it appends after its coarse goal edge unchecked, through a door detour
// bounded to the last step's radius.
import {distance,isTransition,sameContext,type Point,type Step} from './contracts.ts';
import {doorDetour} from './door-detour.ts';
import type {ValidationPorts} from './validation.ts';

const RADIUS=150;
function eligible(from:Point,destination:Point,previous:Step,last:Step):boolean{
 return !isTransition(previous)&&!isTransition(last)&&last.map===destination.map&&
  last.x===destination.x&&last.y===destination.y&&sameContext(from,destination,previous,last)&&
  distance(previous,last)<=RADIUS;
}
/** Native BFS may append an unchecked exact goal after its coarse goal edge. */
export function repairWalkingEndpoint(ports:ValidationPorts,from:Point,destination:Point,plot:Step[]):Step[]{
 const last=plot.at(-1),previous=plot.at(-2)||from;
 if(!last||!eligible(from,destination,previous,last)||ports.walk(previous,last))return plot;
 const bounded:ValidationPorts={...ports,walk:(a,b)=>sameContext(from,a,b)&&
  distance(previous,a)<=RADIUS&&distance(previous,b)<=RADIUS&&ports.walk(a,b)};
 const connector=doorDetour(bounded,previous,last,[last]);
 if(!connector)return plot;
 // Retain the owned endpoint and all preceding transitions/segments. The
 // caller's full native route validator checks this route again before walking.
 return [...plot.slice(0,-1),...connector,last];
}
