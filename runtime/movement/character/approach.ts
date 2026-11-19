// The member's own approaches (R1.1 `approach.ts`, appendix A2 APP): the farm approach, which searches
// the selected zone and routes around an obstacle to a blocked target, and the independent approach's
// journey check, intercept and the ports its client drives. Moved from shared.js with today's checks,
// order, fields and windows. The independent approach itself (from runtime/combat/): the
// coordinator's capability, readiness and confirmation rules, which targeting's queue asks through
// movement's published reads, and the member's approach client, which the fight queue's client ticks.
// Moved with today's order, fields and windows. The farm approach's record and the formation target the
// independent approach reads live here; FORM's `formationMove` writes the target until it reaches its
// owner. Targeting's retire holds the unreachable mark.

import { reportInterval as memberInterval } from '../../protocol/reports.ts';
import type { WalkClient } from './walk-client.ts';
import type { Member } from '../../coordinator/targeting/api.ts';
import type { IndependentConfirmation, IndependentReady, RecoveryPoint } from '../geometry/contracts.ts';
import { ageOf, currentQueue, fresh, reportClockError } from '../../protocol/reports.ts';
import { samePlace } from '../../protocol/place.ts';
import { copyPrediction, occupied, predictCombatIntercept, stepStalled, type CombatPrediction } from './steps.ts';
import { eventFacts } from '../../events/api.ts';

// The movement service, the game objects and the grouped record are shared.js's untyped values.
type Value = any;
interface Point { x: number; y: number }
// The game's reads and the runtime records the approaches read and write, on shared.js's runtime
// root.
interface ApproachHost {
  parent: { entities?: Record<string, Value>; socket?: { connected?: boolean } | null };
  get_entity(id: Value): Value;
  is_in_range(target: Value): boolean;
  can_move_to(x: number, y: number): boolean;
  // The game's distance, can_move and can_walk come from old_common_functions.js, which the CODE
  // runner loads in the browser and in caracAL (the client's client_scripts.json `runner` list).
  distance(a: Value, b: Value): number;
  can_move(query: Value): boolean;
  can_walk(entity: Value): boolean;
  partyCombatPosition?: Value;
  partyCombatRoutes?: { regroup: number; approach: number };
  partyQueueClient?: Value;
  partyFarmingZones?: { searchPoints(location: Value): Value[] };
  partyRoleRunner?: { isKnownDead?(id: Value): boolean; retiring?(id: Value): boolean };
  __partyFarmingEngagement?: Value;
  __partyMovementPaused?: boolean;
}
// What shared.js hands the approaches: one read each of its state, the combat steps' rules
// (STEP), the formation's frame and geometry (FORM, TERR), the group route's cancel (GRP), the
// requesters' journey handle and farm approach identity, and the targeting owner's, the events owner's and the hunting owner's reads, until that
// state and those rules reach their owners.
export interface ApproachPorts {
  // The convoy this character defends (owner.ts WalkState `convoyDefense`).
  convoyDefense(): string | null;
  // The hook registry's notice (runtime/hooks/registry.ts `notify`), which hands an unreachable
  // target back to targeting.
  notify(name: 'targeting.unreachable', payload: Record<string, unknown>): unknown;
  now(): number;
  clockOffset(): number;
  character(): Value;
  movement(): Value;
  current(): boolean;
  intent(): { revision: number; cancelled?: boolean };
  joinedEvent(): Value;
  anniversary(): { staging: boolean; busy: boolean };
  convoyActive(): boolean;
  groupedCombat(): Value;
  grouped(): boolean;
  fresh(): boolean;
  partyLocation(): Value;
  farmTravelPaused(): boolean;
  lastAttackAt(): number;
  // The turns owner's attack cooldown edge (turns/api.ts attackReadyAt), or null before the
  // first attack.
  attackReadyAt(): number | null;
  inFarmArea(target: Value, location: Value, margin: number): boolean;
  activeEvent(): Value;
  eventReturnHolds(): boolean;
  rareActive(): boolean;
  unfinishedFight(): boolean;
  defensiveTarget(): Value;
  dungeonOwned(): boolean;
  attacking(target: Value): boolean;
  realm(): Value;
  journeyHandle(): Value;
  farmApproachRequest(route: Value): { owner: Value };
  smartMove(destination: Value, callback: Value, options: Value): Value;
  combatDistance(target: Value): number;
  combatApproachPoint(target: Value, desired?: number | null, center?: Point | null): Value;
  safeCombatPoint(point: Point, target: Value): boolean;
  resetCombatMovement(): void;
  setFormationFrame(frame: Value): void;
  formationBody(entity: Value, point?: Point | null): Value;
  formationMotion(entity: Value): Value;
  recoverCorner(reference: Value, priest: Value, selfPriest: boolean, members: Value[], step: number): Value;
  cancelGroupRoute(): void;
  // Resolves when this character's next status report completes (owner.ts `nextReport`).
  nextReport(): Promise<unknown>;
}

export function createApproach(host: ApproachHost, walk: WalkClient, ports: ApproachPorts) {
  // Class B: the target approach searches again on the next movement tick, with no delay of its
  // own. The zone search's next try waits for this character's next report (`awaitSearchReport`).
  const farmApproach: Value = { target: null, progressAt: 0, distance: Infinity, route: null, searchIndex: 0, areaId: null, points: null, searchWaiting: false };
  // Separate check B2: a search point's route that ends, and a search that ran out of points, wait for
  // the next report (class B's signal) before the next try, so an unplannable zone costs one planner
  // search per report, not one per tick. v1.5.0 waited 1 s and 10 s
  // (shared.js:16106:16145).
  function awaitSearchReport() {
    farmApproach.searchWaiting = true;
    void ports.nextReport().then(function () { farmApproach.searchWaiting = false; });
  }
  // The target FORM's `formationMove` last met, which a local independent approach follows for one
  // of this character's report intervals (shared.js:16681).
  const independentApproach: { reference: { target: Value; at: number } | null } = { reference: null };
  function cancelFarmApproach(reason: string) {
    const route=farmApproach.route;
    farmApproach.route=null;
    // The approach releases its own journey; a newer holder keeps the character.
    if (route) ports.movement().release(ports.farmApproachRequest(route).owner);
    if(route)host.partyCombatPosition={at:ports.now(),mode:"recovery-cancelled",reason:reason,movementOwner:null};
  }
  // and: an approach that cannot reach its target hands it back to targeting, whose retire marks it
  // and drops the selection.
  function handBack(target: Value, why: string) {
    ports.notify('targeting.unreachable',{character:ports.character().name,target:target,why:why});
  }
  function monsterOnCharacter(character: Value) {
    const entities = host.parent.entities || {};
    return Object.keys(entities).some(function(id){const e=entities[id];return e && e.visible && !e.dead && e.type==="monster" && e.target===character.name;});
  }
  function recoverFarmApproach(target: Value) {
    const anniversary = ports.anniversary();
    if (anniversary.staging || anniversary.busy) {
      cancelFarmApproach("anniversary owns staging movement");
      return !target;
    }
    if (ports.defensiveTarget()) {
      cancelFarmApproach("defending visible party attackers");
      return false;
    }
    if (ports.eventReturnHolds()) {
      cancelFarmApproach("event return owns movement");
      return !target;
    }
    if (!target && ports.rareActive()) {
      cancelFarmApproach("rare encounter owns movement; waiting for combat selection");
      return true;
    }
    if (!target && ports.unfinishedFight()) {
      cancelFarmApproach("unfinished fight; no empty-area search");
      return true;
    }
    const groupedCombat = ports.groupedCombat();
    if(!target && groupedCombat && groupedCombat.target && groupedCombat.target.state==='planned') {
      host.partyCombatPosition={at:ports.now(),mode:'target-observation',movementOwner:'group',target:groupedCombat.target.id,reason:'Waiting for party observation of nominated target'};
      return true;
    }
    const character = ports.character(), navigationIntent = ports.intent(), movement = ports.movement();
    if (character.ctype === "merchant") return false;
    // The convoy defence releases the walk only to fight a target targeting's selection names: a farm
    // search with no target keeps the walk moving.
    if ((ports.convoyActive() || walk.groupWalk.travel) && (!ports.convoyDefense() || !target)) {
      cancelFarmApproach("convoy owns movement"); return true;
    }
    if (!ports.current() || character.rip || occupied() || ports.activeEvent() || ports.joinedEvent() || navigationIntent.cancelled) {
      cancelFarmApproach("navigation or activity changed"); return false;
    }
    const now=ports.now(), route=farmApproach.route, partyLocation=ports.partyLocation();
    if (!target && partyLocation && ports.inFarmArea(character, partyLocation, 0)) {
      cancelFarmApproach("inside farming area; waiting for respawns");
      host.partyCombatPosition={at:now,mode:"farm-search-wait",movementOwner:null,reason:"inside farming area; waiting for respawns"};
      return false;
    }
    if(route) {
      const arrived=character.map===route.destination.map && Math.hypot(character.x-route.destination.x,character.y-route.destination.y)<15;
      const threat=monsterOnCharacter(character);
      const ready=target && host.is_in_range(target);
      const replaced=ports.journeyHandle()!==route.onDone;
      // The route lasts until one of these signals or its own end below; a route that cannot reach
      // the target ends there and hands it back to targeting.
      if(replaced || route.revision!==navigationIntent.revision || ready || threat || arrived ||
          route.target && (!target || target.id!==route.target)) {
        cancelFarmApproach(replaced?"new movement owner":ready?"engaging reachable target":threat?"defending":arrived?"search point reached":"target changed");
        farmApproach.progressAt=now;
        return false;
      }
      host.partyCombatPosition={at:now,mode:"farm-approach-route",target:route.target,movementOwner:"farm-recovery",reason:"routing around obstacle"};
      return true;
    }
    if(ports.farmTravelPaused()) {
      if(target && host.is_in_range(target) || monsterOnCharacter(character))return false;
      host.partyCombatPosition={at:now,mode:"farm-travel-paused",movementOwner:null,reason:"zone travel failed; choose a farming area to retry"};return true;
    }
    if(!partyLocation || !host.partyFarmingZones)return false;
    let destination: Value=null;
    if(target) {
      if(host.is_in_range(target) && ports.combatDistance(target) <= Number(character.range)) {farmApproach.progressAt=now;return false;}
      const distance=ports.combatDistance(target);
      if(farmApproach.target!==target.id || distance<farmApproach.distance-8) {
        farmApproach.target=target.id;farmApproach.distance=distance;farmApproach.progressAt=now;return false;
      }
      // shared.js:16104: the route starts once the approach's walking try stalls.
      if(!stepStalled(character.moving,farmApproach.progressAt,now,movement))return false;
      // Selected is not the same as engaged: an unreachable selection must not
      // indefinitely suppress path recovery. Never path away from actual aggro.
      if(monsterOnCharacter(character))return false;
      // An attack counts as the fight until the character passes an attack turn it was ready for, one
      // attack interval after the later of its last attack and its cooldown edge. The interval is the
      // game's 1000 / frequency (game client functions.js skill_timeout, `attack`).
      const lastTurn=Math.max(Number(ports.attackReadyAt())||0,Number(ports.lastAttackAt())||0);
      if(now<lastTurn+1000/Number(character.frequency))return false;
      const entities = host.parent.entities || {};
      const enemies=Object.keys(entities).map(function(id){return entities[id];}).filter(function(e){return e && e.visible && !e.dead && e.type==="monster";});
      ports.setFormationFrame({attackers:[],enemies:enemies,motions:new Map(),self:ports.formationBody(character)});
      try {
        const local=ports.recoverCorner(target,character,true,[],Math.max(1,character.speed*0.6));
        if(local && host.partyCombatPosition.mode==="formation-regrouping")return true;
      } finally {ports.setFormationFrame(null);}
      destination=ports.combatApproachPoint(target);
      destination.map=character.map;
    } else {
      if (walk.groupedFollower()) return false;
      if (farmApproach.searchWaiting) {
        host.partyCombatPosition={at:now,mode:"farm-search-wait",movementOwner:null,reason:"zone search waiting for the next report"};return true;
      }
      if(farmApproach.areaId!==partyLocation.id || !farmApproach.points) {
        farmApproach.areaId=partyLocation.id;farmApproach.searchIndex=0;
        farmApproach.points=host.partyFarmingZones.searchPoints(partyLocation).filter(function(p: Value){return host.can_move({map:p.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:character.base});});
      }
      if(!farmApproach.points.length || farmApproach.searchIndex>=farmApproach.points.length) {
        farmApproach.searchIndex=0;awaitSearchReport();
        host.partyCombatPosition={at:now,mode:"farm-search-wait",movementOwner:null,reason:"zone search exhausted; waiting for reachable spawns"};return true;
      }
      destination=farmApproach.points[farmApproach.searchIndex++];
      if(character.map===destination.map && Math.hypot(character.x-destination.x,character.y-destination.y)<20)return true;
    }
    if(!host.can_walk(character))return true;
    if (destination.map === character.map && host.can_move_to(destination.x,destination.y) && ports.safeCombatPoint(destination,target)) {
      if (!target) farmApproach.searchIndex = Math.max(0, farmApproach.searchIndex-1);
      Promise.resolve(movement.step(destination,"farm-local-approach",{target:target && target.id!=null ? String(target.id) : undefined}).sent).catch(function () {});
      host.partyCombatPosition={at:now,mode:"farm-local-approach",target:target && target.id,movementOwner:"farm-recovery",reason:"clear local approach"};
      return true;
    }
    const localKey=JSON.stringify([destination.map,target ? target.id : [destination.x,destination.y],navigationIntent.revision]);
    let local=farmApproach.local;
    const gap=destination.map===character.map ? Math.hypot(character.x-destination.x,character.y-destination.y) : Infinity;
    if (!local || local.key!==localKey) local=farmApproach.local={key:localKey,at:now,gap:gap,point:null};
    if (gap<local.gap-8) {local.gap=gap;local.at=now;}
    const formationApproach=host.partyQueueClient && host.partyQueueClient.formation;
    const certifiedApproach=target && formationApproach && formationApproach.approachStatus &&
      /^(planning|routing)$/.test(formationApproach.approachStatus());
    // The local detour lasts until its walking try stalls, as the target approach above does, so
    // the report age no longer sets its window.
    const detourStalled=stepStalled(character.moving,local.at,now,movement);
    if (certifiedApproach && detourStalled) return false;
    if (destination.map===character.map && !detourStalled) {
      if (!target) farmApproach.searchIndex=Math.max(0,farmApproach.searchIndex-1);
      if (local.point && Math.hypot(character.x-local.point.x,character.y-local.point.y)<8) local.point=null;
      if (!local.point) {
        const bearing=Math.atan2(destination.y-character.y,destination.x-character.x), step=Number(character.speed || 40)*0.6;
        const turns=[Math.PI/6,-Math.PI/6,Math.PI/3,-Math.PI/3,Math.PI/2,-Math.PI/2];
        for (let turn=0;turn<turns.length;turn++) {
          const point={x:character.x+Math.cos(bearing+turns[turn])*step,y:character.y+Math.sin(bearing+turns[turn])*step};
          if (host.can_move_to(point.x,point.y) && ports.safeCombatPoint(point,target)) {local.point=point;break;}
        }
      }
      if (!local.point && certifiedApproach) return false;
      if (local.point && host.can_move_to(local.point.x,local.point.y) && ports.safeCombatPoint(local.point,target))
        Promise.resolve(movement.step(local.point,"farm-local-detour",{target:target && target.id!=null ? String(target.id) : undefined}).sent).catch(function(){});
      host.partyCombatPosition={at:now,mode:"farm-local-detour",movementOwner:"farm-recovery",reason:"trying local obstacle recovery"};
      return true;
    }
    farmApproach.local=null;
    const recovery: Value={target:target && target.id || null,destination:destination,revision:navigationIntent.revision,at:now,onDone:null};
    farmApproach.route=recovery;
    host.partyCombatRoutes=host.partyCombatRoutes || {regroup:0,approach:0};host.partyCombatRoutes.approach++;
    try {
      const promise=ports.smartMove(destination,undefined,{request:ports.farmApproachRequest(recovery)});recovery.onDone=ports.journeyHandle();
      Promise.resolve(promise).catch(function(){if(farmApproach.route===recovery && recovery.target)handBack(recovery.target,'approach');})
        .finally(function(){if(farmApproach.route===recovery){farmApproach.route=null;farmApproach.progressAt=ports.now();if(!recovery.target)awaitSearchReport();}});
    } catch { farmApproach.route=null;if(target)handBack(target.id,'approach');else awaitSearchReport(); }
    host.partyCombatPosition={at:now,mode:"farm-approach-route",target:recovery.target,movementOwner:"farm-recovery",reason:target?"blocked target approach":"searching selected zone"};
    return true;
  }
  function independentApproachOwnsJourney() {
    const r=ports.movement().report();return !!(r && r.owner && typeof r.owner.recoveryStage==='string' && r.owner.recoveryStage.indexOf('combat-approach:')===0);
  }
  // Whether the independent approach's live journey walks to `target`: the approach's position record
  // names the target it routes to, and its journey owns movement.
  function approachingTarget(target: { id?: unknown } | null | undefined) {
    const position=host.partyCombatPosition as { mode?: string; movementOwner?: string; target?: unknown } | null | undefined;
    return !!target && target.id!==undefined && !!position && position.mode==='independent-approach' && position.movementOwner==='combat-approach' &&
      String(position.target)===String(target.id) && independentApproachOwnsJourney();
  }
  function combatRangeReference(target: Value, point?: Point | null) {
    const body=ports.formationBody(target,point);body.type=target.type;body.mtype=target.mtype;
    if(target.map===undefined)delete body.map;
    if(target.in===undefined)delete body.in;
    return body;
  }
  function combatInterceptCenter(target: Value, desired: number, record?: Value) {
    const current={x:Number.isFinite(target.real_x)?target.real_x:target.x,y:Number.isFinite(target.real_y)?target.real_y:target.y},client=host.partyQueueClient && host.partyQueueClient.independent;
    if(!target.moving || !client || typeof client.intercept!=='function')return current;
    const character=ports.character(),motion=ports.formationMotion(target),self=ports.formationBody(character);
    const reach=desired+Math.max(0,Math.hypot(self.x-motion.body.x,self.y-motion.body.y)-ports.combatDistance(target));
    const ownSpeed=Number(character.speed),point=client.intercept(self,ownSpeed,motion.body,reach,motion);
    if(record && motion.duration>0 && Number.isFinite(ownSpeed) && ownSpeed>0)Object.assign(record,{
      at:ports.now(),target:{x:motion.body.x,y:motion.body.y},destination:{x:target.going_x,y:target.going_y},
      targetSpeed:Number(target.speed),own:{x:self.x,y:self.y},ownSpeed:ownSpeed,reach:reach,
      horizon:Math.hypot(point.x-motion.body.x,point.y-motion.body.y)/Math.hypot(motion.vx,motion.vy)});
    return point;
  }
  function independentApproachPorts() {
    function context() {
      const character=ports.character(),groupedCombat=ports.groupedCombat(),navigationIntent=ports.intent(),movement=ports.movement();
      const coordinated=!!(ports.grouped() && ports.fresh() && groupedCombat.independentApproach);
      const reference=independentApproach.reference;
      const local=reference && ports.now()-reference.at<=movement.reportInterval() ? reference.target:null;
      const t=coordinated?groupedCombat.target:local,observed=t && host.get_entity(t.id);
      if(!t || !coordinated && (!observed || !observed.visible))return null;
      const e=observed && observed.visible?observed:t;
      const knownDead=host.partyRoleRunner && typeof host.partyRoleRunner.isKnownDead==='function' && host.partyRoleRunner.isKnownDead(t.id);
      const retiring=!!(host.partyRoleRunner && typeof host.partyRoleRunner.retiring==='function' && host.partyRoleRunner.retiring(t.id));
      const route=movement.report(),foreignOwned=route && route.owner && !independentApproachOwnsJourney();
      // A coordinator-owned farming encounter has released convoy walking to
      // grouped combat. Its selected target still needs native range reports
      // before either fighter can commit; unrelated convoy targets stay fenced.
      const encounter=host.__partyFarmingEngagement;
      const farmingHandoff=!!(coordinated && encounter && !encounter.finished && encounter.target && String(encounter.target.id)===String(t.id));
      const travel=walk.groupWalk.travel;
      const allowed=!!(!foreignOwned && (!ports.convoyActive() || farmingHandoff) && (!travel || farmingHandoff && travel.defensePaused) && !occupied() && (coordinated || !ports.grouped()) && ports.current() && (!host.parent.socket || host.parent.socket.connected!==false) && !ports.dungeonOwned() && !!!eventFacts().travellingEventName() && character.ctype!=='merchant' &&
        !navigationIntent.cancelled && !character.rip && !movement.consolePaused() && !host.__partyMovementPaused &&
        !knownDead && (!observed || !observed.dead && !(Number(observed.hp)<=0)) && Number.isFinite(e.x) && Number.isFinite(e.y) &&
        (coordinated || e.visible && !e.dead && e.hp>0) && (!coordinated || t.map===character.map && t.in===character.in && t.server===ports.realm()) &&
        !Object.values(host.parent.entities||{}).some(function(other: Value){return other && other.type==='monster' && !other.dead &&
          (other.target===character.name || other.id!==e.id && ports.attacking(other));}));
      const prediction: Value={},radius=Math.max(1,(Number(character.range)||1)-10),point=combatInterceptCenter(e,radius,prediction);
      return {allowed:allowed,retiring:retiring,planned:coordinated?t.state==='planned':true,selection:coordinated?groupedCombat.selection:undefined,committed:coordinated?!!groupedCombat.committed:true,confirmation:coordinated && groupedCombat.independentConfirmation && groupedCombat.independentConfirmation.selection===groupedCombat.selection && groupedCombat.independentConfirmation.target===String(t.id)?groupedCombat.independentConfirmation.id:undefined,target:String(t.id),
        key:JSON.stringify([t.id,character.map,character.in,ports.realm(),navigationIntent.revision,coordinated?[groupedCombat.key,groupedCombat.selection,groupedCombat.resetAt]:ports.joinedEvent()]),point:point,prediction:prediction.at!==undefined?prediction:undefined,radius:radius,
        update:observed && observed.visible ? observed.move_num : undefined};
    }
    return {
      context:context,now:function(){return ports.now()+ports.clockOffset();},
      // The approach's last level tells targeting.
      unreachable:function(target: Value){handBack(target,'approach');},
      ready:function(){const c=context(),e=c && host.get_entity(c.target);return !!(c && c.allowed && e && e.visible && !e.dead && e.hp>0 && host.is_in_range(e));},
      buffered:function(){const c=context(),e=c && host.get_entity(c.target);if(!e || !host.is_in_range(e))return false;
        const character=ports.character(),gap=host.distance(character,e);
        return gap<=Math.max(1,(Number(character.range)||1)-10);},
      clear:function(goal: Point){const character=ports.character();return host.can_move({map:character.map,x:character.real_x,y:character.real_y,going_x:goal.x,going_y:goal.y,base:character.base});},
      goal:function(point: Point,radius: number){
        const c=context(),observed=c && host.get_entity(c.target),groupedCombat=ports.groupedCombat(),e=observed && observed.visible?observed:groupedCombat && groupedCombat.target;
        if(!c || !c.allowed || !e || String(e.id)!==c.target)return null;
        const character=ports.character();
        const actual={x:Number.isFinite(e.real_x)?e.real_x:e.x,y:Number.isFinite(e.real_y)?e.real_y:e.y};
        const first=ports.combatApproachPoint(e,radius,actual),angle=Math.atan2(character.real_y-point.y,character.real_x-point.x),reach=Math.hypot(first.x-actual.x,first.y-actual.y),goals: Point[]=[];
        for(let i=0;i<16;i++){const a=angle+i*Math.PI/8,p={x:point.x+Math.cos(a)*reach,y:point.y+Math.sin(a)*reach};
          if(host.can_move({map:character.map,x:p.x,y:p.y,going_x:p.x,going_y:p.y,base:character.base}))goals.push(p);}
        goals.sort(function(a,b){return Math.hypot(a.x-character.real_x,a.y-character.real_y)-Math.hypot(b.x-character.real_x,b.y-character.real_y);});return goals.find(function(p){return host.can_move({map:character.map,x:character.real_x,y:character.real_y,going_x:p.x,going_y:p.y,base:character.base});})||goals[0]||null;
      },
      start:function(goal: Point,id: string,direct?: boolean){const approach=host.partyCombatPosition,character=ports.character(),movement=ports.movement();
        ports.cancelGroupRoute();cancelFarmApproach('individual combat approach');ports.resetCombatMovement();
        if(approach && approach.mode==='independent-approach' && approach.movementOwner==='combat-approach' && approach.approachId===id)host.partyCombatPosition=approach;
        const walking=movement.move({map:character.map,in:character.in,x:goal.x,y:goal.y},undefined,{request:{kind:'approach',owner:'approach:'+id},rejectUnreachableGoal:true,town:false,arrivalTolerance:3,owner:{recoveryStage:id}});
        if(direct){try{movement.install([{map:character.map,in:character.in,x:goal.x,y:goal.y}],movement.identity,'direct');}
          catch(error){const report=movement.report();if(report && report.owner && report.owner.recoveryStage===id){try{movement.cancel('Direct combat approach rejected: '+String(error),{by:{kind:'approach',owner:'approach:'+id}});}catch{ /* the journey already ended */ }}}}
        movement.tick();
        return walking;},
      // Design section 2.3: the owner moves the live approach to the new point in place.
      retarget:function(goal: Point,id: string){const movement=ports.movement(),character=ports.character(),report=movement.report();if(!report || !report.owner || report.owner.recoveryStage!==id)return false;
        return movement.retarget({map:character.map,in:character.in,x:goal.x,y:goal.y},{request:{kind:'approach',owner:'approach:'+id},rejectUnreachableGoal:true,town:false,arrivalTolerance:3,owner:{recoveryStage:id}});},
      owned:function(id: string){const report=ports.movement().report();return !!(report && report.owner && report.owner.recoveryStage===id);},
      cancel:function(id: string){const movement=ports.movement(),report=movement.report();if(report && report.owner && report.owner.recoveryStage===id)movement.cancel('Individual combat approach cancelled',{code:'combat-approach-cancelled',by:{kind:'approach',owner:'approach:'+id}});},
      position:function(id: string,target: Value,radius: number,goal: Point,phase: string){host.partyCombatPosition={at:ports.now(),mode:'independent-approach',movementOwner:'combat-approach',
        approachId:id,target:target,radius:radius,phase:phase,destination:goal,reason:phase==='ready'?'In native attack range; waiting for every fighter':'Independently approaching native attack range'};}
    };
  }
  // The fight queue's client (runtime/characters/targeting/queue-client.ts) builds the member's approach client through
  // `root.partyMovement.independentApproachClient` on each install and ticks it.
  function independentApproachClient() { return createIndependentApproachClient(independentApproachPorts()); }
  return { farmApproach, independentApproach, cancelFarmApproach, recoverFarmApproach, independentApproachOwnsJourney, approachingTarget,
    combatRangeReference, combatInterceptCenter, independentApproachPorts, independentApproachClient };
}
// The independent approach's rules on the coordinator. Targeting's queue asks them through
// `movement.independentApproach`, `movement.independentReadiness` and
// `movement.confirmIndependentApproach`.
type Status=NonNullable<Member['status']>;
function available(member:Member):member is Member & {status:Status} {
  const s=member.status;
  return !!s && !member.cancelled && !s.rip && s.hp>0 && !s.presence;
}
function sameServerPlace(s:Status,anchor:Status):boolean {
  return s.server===anchor.server && samePlace(s,anchor);
}
function currentCapability(s:Status,now:number):boolean {
  return fresh(s.seenAt,now) && currentQueue(s.groupedCombat) && s.groupedCombat.independentApproach===true;
}
/** Capability is ownership support, never proof of physical attack arrival. */
export function independentApproach(members:Member[],now:number):boolean {
  const anchor=members[0]?.status;
  return !!anchor && members.every(member=>available(member) && sameServerPlace(member.status,anchor) && currentCapability(member.status,now));
}

/** Snapshot only actual actor reports; capability and target ACK remain separate. */
export function independentReadiness(members:Member[]):Record<string,IndependentReady> {
  return Object.fromEntries(members.flatMap(member=>{const r=member.status?.groupedCombat?.independentReady;
    return r?[[member.name,{selection:r.selection,target:r.target,at:r.at,ready:r.ready,confirmation:r.confirmation}]]:[];}));
}
export function allIndependentReady(members:Member[],selection:string|null,target:string,now:number):boolean {
  return !!selection && members.every(member=>{const r=member.status?.groupedCombat?.independentReady;
    return !!r && r.ready===true && r.selection===selection && r.target===target && fresh(r.at,now,'report',reportClockError(member.status));});
}

interface ConfirmationState {independentConfirmation?:IndependentConfirmation;independentConfirmationRevision?:number}
function currentRound(previous:ConfirmationState|undefined,selection:string,target:string,now:number):IndependentConfirmation|undefined {
  const round=previous?.independentConfirmation;
  return round && round.selection===selection && round.target===target && now>=round.startedAt && now<round.expiresAt?round:undefined;
}
// independent-approach.ts:38:43: a confirmation echo counts for one report interval of the
// member that confirms it, at least the period of the status timer that sends the report (report
// interval floor, 1 s), which also stands in before the member's interval is measured.
const reportInterval=(member:Member)=>memberInterval(member.status as {reportIntervalMs?:unknown}|undefined);
function staleEcho(members:Member[],round:IndependentConfirmation,now:number):boolean {
  return members.some(member=>{const r=member.status?.groupedCombat?.independentReady;
    return r?.confirmation===round.id && now-r.at>reportInterval(member);});
}
function confirmed(member:Member,round:IndependentConfirmation,now:number):boolean {
  const r=member.status?.groupedCombat?.independentReady;
  return !!r && r.ready===true && r.selection===round.selection && r.target===round.target &&
    r.confirmation===round.id && r.at>=round.startedAt && now-r.at<=reportInterval(member) && r.at<=now+reportClockError(member.status);
}
/** Issue and settle in the same status evaluation; no timing hold substitutes for checks. */
export function confirmIndependentApproach(previous:ConfirmationState|undefined,members:Member[],selection:string|null,target:string,now:number) {
  let revision=previous?.independentConfirmationRevision||0;
  if(!selection || !allIndependentReady(members,selection,target,now))return {revision,ready:false};
  let confirmation=currentRound(previous,selection,target,now);
  if(confirmation && staleEcho(members,confirmation,now))confirmation=undefined;
  if(!confirmation){revision++;confirmation={id:JSON.stringify([selection,revision,now]),selection,target,startedAt:now,expiresAt:now+ageOf('report')};
    return {revision,confirmation,ready:false};}
  return {revision,confirmation,ready:members.every(member=>confirmed(member,confirmation!,now))};
}
// The member's independent approach client. `update` is the game's move counter of the visible
// target (`move_num`), which counts the entity updates the game sends for it.
// `retiring`: this character told targeting it cannot reach the target, and the queue's retire of
// that lock has not landed yet (targeting/retire.ts `retiring`).
interface IndependentContext {prediction?:CombatPrediction;key:string;target:string;point:RecoveryPoint;radius:number;allowed:boolean;retiring?:boolean;planned:boolean;selection?:string;committed?:boolean;confirmation?:string;update?:unknown}
interface IndependentPorts {now():number;context():IndependentContext|null;ready():boolean;buffered?():boolean;clear(goal:RecoveryPoint):boolean;goal(point:RecoveryPoint,radius:number):RecoveryPoint|null;start(goal:RecoveryPoint,id:string,direct:boolean):Promise<unknown>;retarget?(goal:RecoveryPoint,id:string):boolean;owned(id:string):boolean;cancel(id:string):void;position(id:string,target:string,radius:number,goal:RecoveryPoint|null,phase:string):void;
 // The approach's last level sends `targeting.unreachable` once per approach.
 unreachable?(target:string):void}
/** One actor's collision-certified approach; actual range confirms readiness, then committed combat takes ownership. */
export function createIndependentApproachClient(p:IndependentPorts){
 let completedKey:string|null=null;
 let current:{prediction?:CombatPrediction;key:string;target:string;point:RecoveryPoint;radius:number;level:number;id:string;goal:RecoveryPoint|null;pending:boolean;arrived:boolean;failed:boolean;ready:boolean;direct:boolean;issuedAt:number;told?:boolean;update?:unknown}|null=null,serial=0;
 // Re-aims of a pending direct journey: kept in place by the movement owner, or relaunched,
 // and how many of the relaunched ones had a clear line.
 const reaims={retargeted:0,relaunched:0,relaunchedClear:0};
 function retire(){const old=current;current=null;if(old&&p.owned(old.id))p.cancel(old.id);}
 function stop(){completedKey=null;retire();}
 function launch(c:NonNullable<typeof current>){
  c.goal=p.goal(c.point,c.radius);c.arrived=false;c.ready=false;c.failed=false;c.issuedAt=p.now();
  if(!c.goal){c.failed=true;return;}
  c.pending=true;c.direct=p.clear(c.goal);p.position(c.id,c.target,c.radius,c.goal,'routing');
  const issued=c.id;
  const settled=(arrived:boolean)=>{if(current!==c||c.id!==issued||!c.pending)return;c.pending=false;c.arrived=arrived;c.failed=!arrived;tick();};
  try {void p.start(c.goal,c.id,c.direct).then(()=>settled(true),()=>settled(false));}
  catch {if(current===c&&c.id===issued){c.pending=false;c.failed=true;}}
 }
 function retireSuperseded(ctx:IndependentContext){if(current&&(current.key!==ctx.key||current.target!==ctx.target))stop();}
 function issue(c:NonNullable<typeof current>,ctx:IndependentContext){if(p.owned(c.id))p.cancel(c.id);c.point={...ctx.point};c.prediction=copyPrediction(ctx.prediction);c.update=ctx.update;c.id='combat-approach:'+ ++serial;launch(c);}
 // independent-approach-client.ts:28: the approach re-aims at most once per entity update the
 // game sends for its target; a target out of sight has no counter, and its point alone decides.
 function followTarget(c:NonNullable<typeof current>,ctx:IndependentContext){
  if(c.pending&&!c.direct)return false;
  if(!c.pending&&c.level<8&&c.radius>1)return false;
  if(Math.hypot(c.point.x-ctx.point.x,c.point.y-ctx.point.y)<=12||ctx.update!==undefined&&ctx.update===c.update)return false;
  if(c.pending&&c.direct&&reaim(c,ctx))return true;
  issue(c,ctx);return true;
 }
 // Design section 2.3: the movement owner moves a pending direct journey to the new point in
 // place, under the same id, with no stop packet. Without it the approach relaunches.
 function reaim(c:NonNullable<typeof current>,ctx:IndependentContext){
  const goal=p.goal(ctx.point,c.radius),clear=!!goal&&p.clear(goal);
  if(clear&&p.owned(c.id)&&p.retarget?.(goal!,c.id)){
   c.point={...ctx.point};c.prediction=copyPrediction(ctx.prediction);c.update=ctx.update;c.goal=goal;c.issuedAt=p.now();reaims.retargeted++;
   p.position(c.id,c.target,c.radius,c.goal,'routing');return true;
  }
  reaims.relaunched++;if(clear)reaims.relaunchedClear++;
  return false;
 }
 function advance(c:NonNullable<typeof current>,ctx:IndependentContext){
  if(c.pending||!c.arrived&&!c.failed)return true;
  if(c.level>=8||c.radius<=1){p.position(c.id,c.target,c.radius,c.goal,'unreachable');if(!c.told){c.told=true;p.unreachable?.(c.target);}return false;}
  // Class B: the next level goes on this movement tick.
  c.level++;c.radius=Math.max(1,c.radius/2);issue(c,ctx);return true;
 }
 function makeCurrent(ctx:IndependentContext){return {prediction:copyPrediction(ctx.prediction),key:ctx.key,target:ctx.target,point:{...ctx.point},radius:Math.max(1,ctx.radius),level:0,id:'combat-approach:'+ ++serial,goal:null,pending:false,arrived:false,failed:false,ready:false,direct:false,issuedAt:-Infinity};}
 function waitReady(ctx:IndependentContext){
  if(ctx.committed){completedKey=ctx.key;retire();return false;}
  if(current?.pending && p.owned(current.id) && p.buffered?.()===false){
   p.position(current.id,current.target,current.radius,current.goal,'buffering');return true;
  }
  if(!current)current=makeCurrent(ctx);
  if(p.owned(current.id))p.cancel(current.id);
  current.pending=false;current.failed=false;current.arrived=true;current.ready=true;
  p.position(current.id,current.target,current.radius,current.goal,'ready');return true;
 }
 function readiness(){
  const ctx=p.context();if(!ctx?.allowed||!ctx.selection)return;
  const matching=!current||current.key===ctx.key&&current.target===ctx.target,ready=matching&&p.ready();
  return {selection:ctx.selection,target:ctx.target,at:p.now(),ready,confirmation:ready?ctx.confirmation:undefined};
 }
 function resumeReady(c:NonNullable<typeof current>,ctx:IndependentContext){
  if(c.goal&&!c.direct){c.radius=Math.max(1,c.radius/2);c.level=Math.min(8,c.level+1);}
  issue(c,ctx);
 }
 function route(c:NonNullable<typeof current>,ctx:IndependentContext){
  if(c.pending&&!p.owned(c.id)){stop();return false;}
  if(c.ready)resumeReady(c,ctx);
  if(!followTarget(c,ctx)&&!advance(c,ctx))return true;
  p.position(c.id,c.target,c.radius,c.goal,c.pending?'routing':'planning');return true;
 }
 function tick(){
  const ctx=p.context();if(!ctx){stop();return false;}
  if(completedKey!==ctx.key)completedKey=null;
  if(!ctx.allowed){retire();return false;}
  if(completedKey===ctx.key)return false;
  retireSuperseded(ctx);if(p.ready())return waitReady(ctx);
  // The queue's reply that retires the target lands one round trip after the notice. A superseded
  // key or a dropped context in that window ends the last level's approach, so the client holds
  // here as the last level does and starts no approach to the marked target.
  if(!current&&ctx.retiring)return true;
  if(!current){current=makeCurrent(ctx);launch(current);}
  return route(current,ctx);
 }
 return {tick,movement:tick,stop,readiness,intercept:predictCombatIntercept,reaims:()=>({...reaims}),report:()=>current?{id:current.id,key:current.key,target:current.target,point:{...current.point},issuedAt:current.issuedAt,prediction:copyPrediction(current.prediction),radius:current.radius,level:current.level,direct:current.direct,pending:current.pending,goal:current.goal,phase:current.ready?'ready':!current.pending&&(current.level>=8||current.radius<=1)?'unreachable':'routing'}:null};
}
