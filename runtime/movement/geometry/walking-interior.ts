// The walking interior ("walking endpoint and interior"): repairWalkingInteriors connects a
// same-map walking step the game's line check rejects through a door detour into the step's 8-unit
// neighbourhood, keeping the step itself.
import {isTransition,sameContext,type Point,type Step} from './contracts.ts';
import {doorDetour} from './door-detour.ts';
import type {ValidationPorts} from './validation.ts';

function eligible(ports:ValidationPorts,from:Step,to:Step):boolean{
 return !isTransition(from)&&!isTransition(to)&&sameContext(from,to)&&!ports.walk(from,to)&&
  ports.walk(from,from)&&ports.walk(to,to);
}
/** Small native-certified interior connector; preserves the exact walking step. */
export function walkingInterior(ports:ValidationPorts,from:Step,to:Step):Point[]|undefined{
 if(!eligible(ports,from,to))return;
 const candidates:Point[]=[];
 for(const dx of [-8,0,8])for(const dy of [-8,0,8])candidates.push({...to,x:to.x+dx,y:to.y+dy});
 // Retain the existing detour's near-target distance, expansion and grid bounds.
 const bounded:ValidationPorts={...ports,walk:(a,b)=>sameContext(from,a,b)&&ports.walk(a,b)};
 // doorDetour walks every leg it returns, the last one to `to` included, on the bounded port.
 return doorDetour(bounded,from,to,candidates);
}
export function repairWalkingInteriors(ports:ValidationPorts,from:Point,plot:Step[]):Step[]{
 const result:Step[]=[];let previous:Step=from;
 for(const step of plot){
  // The current map already has owned native segment recovery. Future-map
  // edges cannot use that repair without abandoning the cross-map itinerary.
  // Each repair is one bounded doorDetour search, so every eligible edge gets one.
  const connector=step.map!==from.map?walkingInterior(ports,previous,step):undefined;
  if(connector)result.push(...connector);
  result.push(step);previous=step;
 }
 return result;
}
