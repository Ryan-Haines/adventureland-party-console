import type {FormationRecovery, FormationRecoveryReport, RecoveryPoint} from './formation-recovery.ts';
import {errorReason} from '../characters/roles/types.ts';
import {recoveryRoute} from './recovery-route.ts';
interface Waypoint extends RecoveryPoint {map:string;town?:boolean;transport?:boolean}
interface NativeSmart {on_done:unknown;found:boolean;plot:Waypoint[];searching?:boolean}
interface Owner {tick():void}
interface Gate {owner:Owner|null;original():void}
interface Drawing {destroy?():void}
interface Route {gate:Gate;owner:Owner;onDone:unknown;goal:RecoveryPoint;checked:boolean;drawAt:number;remaining:number;issued?:Waypoint;search?:ReturnType<typeof recoveryRoute>}
interface Ports {
  now():number;self():RecoveryPoint & {name:string;map:string;moving?:boolean;going_x?:number;going_y?:number};
  context():{allowed:boolean;key?:string;target?:string;covered?:boolean};
  smart():NativeSmart;gate():Gate;safe(point:RecoveryPoint):boolean;
  start(goal:RecoveryPoint):unknown;plan():void;stop():void;hold():void;
  segmentClear?(this:void,from:RecoveryPoint,to:RecoveryPoint):boolean;
  approachReady?():boolean; goals?():RecoveryPoint[];
  coveredStep?(point:RecoveryPoint):boolean; follow?():void; stepSize?:number;
  release?():void;
  log(phase:string,details:object):void;position(control:FormationRecovery,remaining?:number):void;
  debug():boolean;draw(goal:RecoveryPoint,points:Waypoint[]):Drawing[]|undefined;
}
function routeKey(c:FormationRecovery|undefined):string {return JSON.stringify([c?.id,c?.phase,c?.attempt]);}
/** The native scheduler remains the only walker; combat owns its gate during a detour. */
export function createFormationRecoveryClient(p:Ports) {
  let control:FormationRecovery|undefined, proposal:FormationRecoveryReport|undefined;
  let outcome:FormationRecoveryReport|undefined, route:Route|null=null, seenId='', drawings:Drawing[]=[];
  let movementBlock:string|undefined;
  let follower:{goal:RecoveryPoint;search:ReturnType<typeof recoveryRoute>;path?:RecoveryPoint[]}|undefined;
  function clearDrawings(){for(const d of drawings)d?.destroy?.();drawings=[];}
  function cancel(){
    follower=undefined;
    const old=route;route=null;movementBlock=undefined;clearDrawings();
    if(!old)return;
    if(old.gate.owner===old.owner)old.gate.owner=null;
    if(p.smart().on_done===old.onDone){p.stop();}
  }
  function valid(){const c=p.context();return !!control && c.allowed && c.key===control.key && c.target===control.target;}
  function finish(reason?:string){
    if(!control)return;
    outcome={target:control.target,at:p.now(),ack:control.id,attempt:control.attempt,outcome:reason?'failed':'arrived',reason};
    cancel();p.log(reason?'failed':'arrived',{...control,reason});
  }
  function overlay(current:Route,s:NativeSmart){
    if(!p.debug()){clearDrawings();return;}
    if(p.now()-current.drawAt<500)return;
    current.drawAt=p.now();clearDrawings();drawings=p.draw(current.goal,s.plot)||[];
  }
  function shortenSegment(s:NativeSmart,self:ReturnType<Ports['self']>):void {
    const next=s.plot[0];
    if(next && !self.moving && p.stepSize){
      const distance=Math.hypot(next.x-self.x,next.y-self.y);
      if(distance>p.stepSize)s.plot.unshift({...s.plot[0]!,map:self.map,x:self.x+(next.x-self.x)*p.stepSize/distance,y:self.y+(next.y-self.y)*p.stepSize/distance});
    }
  }
  function segmentReady(s:NativeSmart,self:ReturnType<Ports['self']>):boolean {
    shortenSegment(s,self);
    const segment=self.moving?{map:self.map,x:Number(self.going_x),y:Number(self.going_y)}:s.plot[0];
    if(segment && p.coveredStep && !p.coveredStep(segment)){
      movementBlock='waiting for followers to preserve healing coverage';return false;
    }
    movementBlock=undefined;
    if(segment&&!p.safe(segment)){
      if(p.segmentClear && route && !self.moving){
        route.search=undefined;route.checked=false;s.found=false;s.plot=[];
        movementBlock='replanning around changed monster positions';return false;
      }
      finish('terrain or monster blocks the next segment');return false;
    }
    return true;
  }
  function step(current:Route){
    const s=p.smart(),self=p.self();
    if(!s.found){plan(current,s);return;}
    if(!current.checked){
      if(s.plot.some(v=>v.town||v.transport||v.map!==self.map)){finish('route leaves the current map');return;}
      current.checked=true;
    }
    if(!segmentReady(s,self))return;
    const remaining=self.moving && current.issued ? [current.issued,...s.plot] : s.plot;
    current.remaining=remaining.reduce((sum,v,i)=>sum+Math.hypot(v.x-(i?remaining[i-1]!.x:self.x),v.y-(i?remaining[i-1]!.y:self.y)),0);
    if(!self.moving)current.issued=s.plot[0];
    overlay(current,s);current.gate.original();
  }
  function walk(){
    if(!route)return;
    if(!valid()){cancel();return;}
    if(p.smart().on_done!==route.onDone||route.gate.owner!==route.owner){finish('movement ownership changed');return;}
    if(p.now()-control!.phaseAt>=30000){finish('route timeout');return;}
    try {step(route);} catch(error){finish(errorReason(error));}
  }
  function start(){
    if(!control)return;
    const gate=p.gate();
    if(gate.owner){finish('another route owns the native walker');return;}
    const goal=control.goal || control.goals[(control.attempt-1)%control.goals.length]!;
    route={gate,owner:{tick:walk},onDone:null,goal,checked:false,drawAt:0,remaining:Infinity};
    const owned=route;gate.owner=owned.owner;
    try {
      const promise=p.start(goal);owned.onDone=p.smart().on_done;
      p.log('routing',{...control,destination:goal});
      Promise.resolve(promise).then(()=>{
        if(route!==owned)return;
        finish(Math.hypot(p.self().x-goal.x,p.self().y-goal.y)<=12?undefined:'route ended before the recovery position');
      }).catch((error)=>{if(route===owned)finish(errorReason(error));});
    } catch(error){finish(errorReason(error));}
  }
  function accept(next:FormationRecovery|undefined){
    if(routeKey(control)!==routeKey(next))cancel();
    if(control && !next){proposal=undefined;outcome=undefined;p.release?.();}
    control=next;
    if(next && seenId!==next.id){seenId=next.id;proposal=undefined;outcome=undefined;p.hold();p.log('pausing',next);}
    tick();
  }
  function tick(){
    if(!control){if(!p.context().allowed)proposal=undefined;return;}
    if(!valid()){cancel();proposal=undefined;return;}
    if(control!.phase!=='routing'||control!.mover!==p.self().name)return;
    if(outcome?.attempt===control!.attempt)return;
    if(!route)start();
  }
  function activeReport():FormationRecoveryReport {
    return {...(outcome?.attempt===control!.attempt?outcome:undefined),target:control!.target,at:p.now(),ack:control!.id,attempt:control!.attempt,
      approachReady:p.approachReady?.(),goals:control!.phase==='retry'?p.goals?.():undefined,remaining:route?.remaining};
  }
  function plan(current:Route,s:NativeSmart):void {
    if(!p.segmentClear){p.plan();return;}
    current.search??=recoveryRoute(p.self(),current.goal,p.segmentClear);
    const points=current.search.tick();
    if(points===null){finish('no safe same-map route to recovery position');return;}
    if(points){s.plot=points.map(point=>({...point,map:p.self().map}));s.searching=false;s.found=true;}
  }
  function report():FormationRecoveryReport|undefined {
    if(valid())return activeReport();
    if(proposal && p.context().allowed && proposal.target===p.context().target)return {...proposal,at:p.now()};
  }
  function position():void {
    p.position({...control!,reason:movementBlock || control!.reason},route?.remaining);
  }
  function movement():boolean {
    if(!valid())return false;
    if(control!.mover!==p.self().name && p.follow && control!.phase!=='pausing' && control!.phase!=='failed'){
      p.follow();return true;
    }
    if(control!.phase==='regrouping' && p.self().name!==control!.mover && !p.context().covered)return false;
    position();
    return true;
  }
  function followPoint(goal:RecoveryPoint):RecoveryPoint|undefined {
    if(!p.segmentClear)return goal;
    const self=p.self();
    if(!follower || Math.hypot(goal.x-follower.goal.x,goal.y-follower.goal.y)>40)
      follower={goal:{...goal},search:recoveryRoute(self,goal,p.segmentClear)};
    if(!follower.path){const result=follower.search.tick();if(result===null){follower=undefined;return;}follower.path=result;}
    while(follower.path?.length && Math.hypot(follower.path[0]!.x-self.x,follower.path[0]!.y-self.y)<6)follower.path.shift();
    return follower.path?.[0];
  }
  return {accept,tick,report,movement,blocks:()=>valid(),
    followPoint,
    propose(target:string,goals:RecoveryPoint[]){if(!control && goals.length && p.context().allowed)proposal={target,goals,at:p.now()};},
    stop(){cancel();control=undefined;proposal=undefined;outcome=undefined;}};
}
