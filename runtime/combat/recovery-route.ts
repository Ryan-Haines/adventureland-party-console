import type {RecoveryPoint} from './formation-recovery.ts';
interface Node extends RecoveryPoint {cost:number;rank:number;parent?:Node}
/** Incremental same-map search: every edge uses the same safety rule as the walker. */
export function recoveryRoute(origin:RecoveryPoint, destination:RecoveryPoint, clear:(a:RecoveryPoint,b:RecoveryPoint)=>boolean) {
  const start={x:origin.x,y:origin.y},goal={x:destination.x,y:destination.y};
  const open:Node[]=[{...start,cost:0,rank:0}], costs=new Map<string,number>();
  let expanded=0, finished=false;
  let spacing=16;
  const key=(p:RecoveryPoint)=>`${Math.round((p.x-start.x)/spacing)},${Math.round((p.y-start.y)/spacing)}`;
  const distance=(a:RecoveryPoint,b:RecoveryPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
  costs.set(key(start),0);
  function path(node:Node):RecoveryPoint[] {const result:RecoveryPoint[]=[goal];let n:Node|undefined=node;while(n?.parent){result.unshift({x:n.x,y:n.y});n=n.parent;}return result;}
  function neighbors(current:Node):void {
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++){
      if(!x&&!y)continue;
      const next={x:current.x+x*spacing,y:current.y+y*spacing}, cost=current.cost+distance(current,next);
      if(cost>= (costs.get(key(next))??Infinity) || distance(start,next)>distance(start,goal)+384 || !clear(current,next))continue;
      costs.set(key(next),cost);open.push({...next,cost,rank:cost+distance(next,goal),parent:current});
    }
  }
  return {tick():RecoveryPoint[]|null|undefined {
    if(finished)return null;
    for(let i=0;i<128 && open.length && expanded<8192;i++,expanded++){
      open.sort((a,b)=>b.rank-a.rank);const current=open.pop()!;
      if(clear(current,goal)){finished=true;return path(current);}
      neighbors(current);
    }
    if(!open.length||expanded>=8192){
      // Narrow passages can fall between grid lines. Retry at finer resolution,
      // retaining the same per-tick budget and collision checks on every edge.
      if(spacing===16){spacing=8;expanded=0;open.length=0;costs.clear();costs.set(key(start),0);open.push({...start,cost:0,rank:0});return;}
      finished=true;return null;
    }
  }};
}
