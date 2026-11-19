// The member's combat steps (R1.1 `steps.ts`, appendix A2 STEP): the range a fighter keeps, its
// approach point, the kite around its attacker, the event boss's corner step and terrain detour,
// and the one send every step goes through, which hands the step to the movement owner. The fight
// queue's recovery step (appendix A2 QUEUE): the sight recovery's move, coverage cost and reason.
// The sight recovery and the intercept prediction (from runtime/combat/): the fight queue's
// client builds and ticks the first, and the independent approach reads the second. The steps came
// from shared.js and the recovery and prediction from runtime/combat/, with v1.5.0's
// checks, order and fields; their windows are and rules. The
// kite's state and the event detour live here; the formation's record is formation.ts's.

import type { WalkClient } from './walk-client.ts';
import type { RecoveryPoint } from '../geometry/contracts.ts';
import { MOVEMENT_TICK_MS } from '../rules.ts';
import { eventFacts } from '../../events/api.ts';
import { partyHooks } from '../../hooks/index.ts';
// The request table's occupied rows: the turns owner's published ask, which the formation and the
// approaches read.
export const occupied = (): boolean => !!partyHooks().skills.allows({ rank: 'damage', occupied: true });

// A combat step holds its mover's turn for the time the game needs to walk it at the character's
// speed, plus one movement tick, the gap before the next step can be sent. Kiting, separation and
// the owner's combat pause read this one window. A combat step's length toward its goal, each the
// earlier console's: the approach walks 0.6 s of the character's speed
// (characters/shared.js:17248:17319) and the Cave revival's approach a quarter second (:2686). Every
// step is at least 1 unit.
const STEP_SECONDS = { approach: 0.6, recovery: 0.25 } as const;
export function stepLength(speed: unknown, kind: keyof typeof STEP_SECONDS): number {
  return Math.max(1, (Number(speed) || 0) * STEP_SECONDS[kind]);
}
// The approach's candidate points: one step toward `goal`, then turned 0.4 and 0.8 radians each way.
const APPROACH_FAN = [0, 0.4, -0.4, 0.8, -0.8];
export function approachFan(from: { x: number; y: number }, goal: { x: number; y: number }, length: number): { x: number; y: number }[] {
  const angle = Math.atan2(goal.y - from.y, goal.x - from.x);
  return APPROACH_FAN.map(offset => ({ x: from.x + Math.cos(angle + offset) * length, y: from.y + Math.sin(angle + offset) * length }));
}
export function stepWindowMs(from: { x: number; y: number }, to: { x: number; y: number }, speed: unknown): number {
  const walking = Number(speed) > 0 ? Math.hypot(to.x - from.x, to.y - from.y) / Number(speed) * 1000 : 0;
  return walking + MOVEMENT_TICK_MS;
}
// The walking try (R2F3, rule for the approach, corner, formation and sight steps): a step that
// stopped short stalls once one measured round trip has passed since its last progress; a step the
// game shows moving stalls when two of the character's report intervals pass with no progress.
// `since` is the step's last progress or send.
export interface StepClock { roundTrip(): number; reportInterval(): number }
export function stepStalled(moving: unknown, since: number, now: number, clock: StepClock): boolean {
  return now - since > (moving ? 2 * clock.reportInterval() : clock.roundTrip());
}

// The movement service, the game objects and the formation record are shared.js's untyped values.
type Value = any;
interface Point { x: number; y: number }
// The game's reads and the runtime records the steps read and write, on shared.js's runtime root.
interface StepsHost {
  parent: { entities?: Record<string, Value> };
  get_entity(id: Value): Value;
  is_in_range(target: Value): boolean;
  can_move_to(x: number, y: number): boolean;
  // The game's distance, can_move and can_walk come from old_common_functions.js, which the CODE
  // runner loads in the browser and in caracAL (the client's client_scripts.json `runner` list).
  distance(a: Value, b: Value): number;
  can_walk(entity: Value): boolean;
  can_move(query: Value): boolean;
  // Targeting's module (the routine's `targeting`) answers the hitbox-corrected distance once the role
  // runner's attack controller has measured one.
  sharedRoutine?: { targeting: { correctedCombatDistance(target: Value): number | null } };
  partyCombatPosition?: Value;
  __partyQueueTiming?: { target?: Value; firstMovementAt?: number } | null;
}
// What shared.js hands the steps: one read each of its state, the formation's record, counters and
// safe point (FORM, TERR), the independent approach's journey and intercept (APP), and the events owner's event
// stand-ins, until that state and those rules reach their owners.
export interface StepsPorts {
  now(): number;
  character(): Value;
  movement(): Value;
  current(): boolean;
  intent(): { revision: number; cancelled?: boolean };
  following(): boolean;
  forceTraveling(): boolean;
  townTraveling(): boolean;
  departurePending(): boolean;
  formation(): Value;
  performance(): { collisionChecks: number };
  independentApproachOwns(): boolean;
  interceptCenter(target: Value, desired: number): Point | null;
  returning(): boolean;
  franky(): boolean;
  frankyTick(target: Value): boolean;
  eventBoss(target: Value): boolean;
  fightsAdds(eventName: Value): boolean;
  groupedCombat(): Value;
  safePoint(point: Point): boolean;
}

export function createCombatSteps(host: StepsHost, walk: WalkClient, ports: StepsPorts) {
  // `holdMs` is the last step's window (`stepWindowMs`), which "kiting now" lasts from `lastMoveAt`.
  const kiteState: Value = { targetId: null, center: null, offset: 0, lastMoveAt: 0, holdMs: 0 };
  // `searched` names the inputs of the last search that found no point (eventApproachDetour).
  let eventCombatDetour: { identity: string; goal: Point; point: Point | null; searched?: string } | null = null;
  function isCurrentlyKiting() {
    const target = kiteState.targetId && host.get_entity(kiteState.targetId), character = ports.character();
    return !!(target && !target.dead && target.target === character.name &&
      ports.now() - kiteState.lastMoveAt < kiteState.holdMs);
  }
  function desiredCombatRange() {
    const range = Math.max(1, Number(ports.character().range) || 25);
    return Math.max(1, range - Math.min(12, Math.max(2, range * 0.05)));
  }
  function combatDistance(target: Value): number {
    const character = ports.character();
    const corrected = host.sharedRoutine?.targeting.correctedCombatDistance(target);
    if (typeof corrected === "number") return corrected;
    return host.distance(character, target);
  }
  function combatApproachPoint(target: Value, desired?: number | null, center?: Point | null) {
    if (!target) return null;
    const character = ports.character();
    const selfX=Number.isFinite(character.real_x)?character.real_x:character.x,selfY=Number.isFinite(character.real_y)?character.real_y:character.y;
    const targetX=Number.isFinite(target.real_x)?target.real_x:target.x,targetY=Number.isFinite(target.real_y)?target.real_y:target.y;
    let dx = selfX - targetX, dy = selfY - targetY, length = Math.hypot(dx, dy);
    if (length < 0.001) { dx = 1; dy = 0; length = 1; }
    // Translate the engine's hitbox-aware attack distance into a center radius.
    let approach=desired==null?desiredCombatRange():desired;
    if(!host.is_in_range(target) && Number(character.range)>0)
      approach=Math.min(approach,Math.max(1,Number(character.range)-10));
    const radius = approach + Math.max(0, length - combatDistance(target));
    if(!center && !host.is_in_range(target))
      center=ports.interceptCenter(target,approach);
    center=center||{x:targetX,y:targetY};dx=selfX-center.x;dy=selfY-center.y;length=Math.hypot(dx,dy);
    if(length<0.001){dx=1;dy=0;length=1;}
    return { x: center.x + dx / length * radius, y: center.y + dy / length * radius };
  }
  function resetCombatMovement() {
    if(ports.independentApproachOwns())return;
    eventCombatDetour = null;
    // Letting go resumes a journey that combat steps paused, or stops only the character's
    // own step, never another requester's journey (rule 5).
    ports.movement().letGo();
    const formationState = ports.formation();
    host.partyCombatPosition = { at: ports.now(), mode: "idle", movementOwner: null, target: null,
      reason: "no valid target or immediate threat" };
    formationState.warriorPhase = null; formationState.warriorSegment = null;
    formationState.heading = null; formationState.meleeProgress = null;
    formationState.approachProgress = null; formationState.approachIdentity = null; formationState.recovery = null;
    kiteState.targetId = null; kiteState.destination = null; kiteState.mode = "idle";
  }
  // The owner's reason for the last combat step it refused, which the approach's blocked record
  // names; a sent step clears it.
  let stepRefusal: string | null = null;
  // The visible live monsters on this character: `sameInstance` keeps those on its map and instance,
  // and `except` leaves one out.
  function attackers(character: Value, options: { sameInstance?: boolean; except?: Value } = {}): Value[] {
    return Object.values(host.parent.entities || {}).filter(function (e: Value) {
      return e && e.type === "monster" && e.visible && !e.dead && e.target === character.name &&
        (!options.sameInstance || (!e.map || e.map === character.map) && (e.in == null || e.in === character.in)) &&
        (!options.except || e.id !== options.except.id);
    });
  }
  function sendCombatMove(target: Value, destination: Point, mode: string, closes?: string) {
    if(ports.independentApproachOwns())return true;
    if(ports.returning())return false;
    const now = ports.now();
    const timing=host.__partyQueueTiming;
    if(timing && timing.target===target.id && !timing.firstMovementAt)timing.firstMovementAt=now;
    // The movement service sends the step. It pauses a journey whose row allows steps,
    // keeps a repeat of the step being walked, and refuses a step during a hold or one
    // that step safety refuses.
    const stepOptions = { target: target && target.id != null ? String(target.id) : undefined, closes: closes };
    // The move packet leaves inside step(), so the report names this step before the call. A
    // refused or kept step puts the last report back.
    const reported = host.partyCombatPosition;
    host.partyCombatPosition = { at: now, target: target.id, distance: combatDistance(target),
      desiredRange: desiredCombatRange(), mode: mode, movementOwner: "combat", intent:"approach", destination:destination, issuedAt:now };
    const stepped = ports.movement().step(destination, mode, stepOptions);
    if (stepped.status === "refused") { host.partyCombatPosition = reported; stepRefusal = stepped.reason; return false; }
    stepRefusal = null;
    if (stepped.status === "kept") { host.partyCombatPosition = reported; return true; }
    const character = ports.character();
    kiteState.destination = destination; kiteState.lastMoveAt = now; kiteState.mode = mode;
    kiteState.holdMs = stepWindowMs({ x: character.real_x ?? character.x, y: character.real_y ?? character.y }, destination, character.speed);
    try { Promise.resolve(stepped.sent).catch(function (error: Value) {
      if(kiteState.destination===destination)host.partyCombatPosition.reason="movement rejected: "+String(error && error.message || error);
    }); } catch (error: Value) { host.partyCombatPosition.reason="movement rejected: "+String(error && error.message || error); }
    return true;
  }
  function safeCombatPoint(point: Point, target: Value) {
    ports.performance().collisionChecks++;
    if (!host.can_move_to(point.x, point.y)) return false;
    // The owner's step safety is the check: terrain, attackers and idle monsters' aggro
    // blocks, with for every mover: an idle block only refuses while the character fights.
    return ports.movement().stepAllows(point, target ? String(target.id) : undefined);
  }
  // The first candidate that passes step safety, or the least risky one when standing still
  // fights nothing (queue AV).
  function chooseCombatStep(points: Point[], target: Value) {
    const chosen = ports.movement().chooseStep(points, target ? String(target.id) : undefined);
    return chosen ? chosen.point : null;
  }
  function eventKitePoint(point: Point, target: Value) {
    if (!ports.eventBoss(target)) return true;
    const character = ports.character();
    const radius = Math.hypot(character.x - target.x, character.y - target.y);
    const limit = radius + Math.max(0, desiredCombatRange() - combatDistance(target));
    return Math.hypot(point.x - target.x, point.y - target.y) <= limit;
  }
  function eventCornerStep(target: Value, attacker: Value, step: number) {
    if (!ports.eventBoss(target)) return false;
    const character = ports.character();
    let best: Point | null = null, clearance = -Infinity;
    const onCharacter = attackers(character, { sameInstance: true });
    // The two ordinary kite arcs can both point into a corner. Search every
    // direction, but retain collision, attacker-clearance and boss-range checks.
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const point = { x: character.x + Math.cos(angle) * step, y: character.y + Math.sin(angle) * step };
      if (!eventKitePoint(point, target) || !safeCombatPoint(point, attacker)) continue;
      const gap = Math.min.apply(Math, onCharacter.map(function (e: Value) { return Math.hypot(point.x - e.x, point.y - e.y); }));
      if (gap > clearance) { best = point; clearance = gap; }
    }
    return best ? sendCombatMove(target, best, "event-kiting") : false;
  }
  async function kiteIfNeeded(target: Value) {
    if (ports.franky()) return false;
    if(ports.returning())return false;
    const character = ports.character();
    const attacker = target && target.target === character.name ? target
      : attackers(character).sort(function (a, b) { return combatDistance(a) - combatDistance(b); })[0];
    if (!attacker || attacker.dead) { kiteState.targetId = null; return false; }
    if (target && (target.id === attacker.id || ports.eventBoss(target)) && !host.is_in_range(target) && await approachCombatTarget(target)) return true;
    if (kiteState.targetId !== attacker.id) { kiteState.targetId = attacker.id; kiteState.direction = 1; }
    const dx = character.x - attacker.x, dy = character.y - attacker.y;
    const radius = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
    const desired = desiredCombatRange() + Math.max(0, radius - combatDistance(attacker));
    const step = Math.max(1, (Number(character.speed) || 40) * 0.6);
    const turn = Math.min(0.65, step / Math.max(desired, radius, 1));
    let nextRadius = radius + Math.max(-step * 0.65, Math.min(step * 0.8, desired - radius));
    nextRadius = Math.max(1, nextRadius);
    const signs = [kiteState.direction || 1, -(kiteState.direction || 1)];
    for (let i = 0; i < signs.length; i++) {
      const nextAngle = angle + turn * signs[i];
      const point = { x: attacker.x + nextRadius * Math.cos(nextAngle), y: attacker.y + nextRadius * Math.sin(nextAngle) };
      if (eventKitePoint(point, target) && safeCombatPoint(point, attacker)) {
        kiteState.direction = signs[i]; return sendCombatMove(attacker, point, "kiting");
      }
    }
    const outward = { x: character.x + Math.cos(angle) * step, y: character.y + Math.sin(angle) * step };
    if (eventKitePoint(outward, target) && safeCombatPoint(outward, attacker)) return sendCombatMove(attacker, outward, "escaping");
    if (eventCornerStep(target, attacker, step)) return true;
    host.partyCombatPosition = { at: ports.now(), target: attacker.id, distance: combatDistance(attacker),
      desiredRange: desiredCombatRange(), mode: "blocked", movementOwner: "combat",
      blockingAttacker: attacker.id, reason: "No safe kite step; trying combat approach" };
    // No move was issued. Let the selected target's approach try its own
    // collision-checked steps, retaining all secondary-attacker safeguards.
    return false;
  }
  function eventApproachDetour(target: Value, destination: Point, step: number) {
    // Event combat owns this local detour; farming/navigation never inherit it.
    if (!ports.current()) { eventCombatDetour=null; return false; }
    const character = ports.character(), navigationIntent = ports.intent(), joined = eventFacts().joinedEventName();
    if (!joined || !host.can_walk(character) ||
        navigationIntent.cancelled || walk.groupWalk.travel || ports.following() || ports.forceTraveling() || ports.townTraveling() || ports.departurePending()) {
      if(eventCombatDetour)resetCombatMovement();
      return false;
    }
    const identity = [target.id, character.map, character.in, joined, navigationIntent.revision].join(":");
    let route = eventCombatDetour;
    if (!route || route.identity !== identity || Math.hypot(route.goal.x-destination.x,route.goal.y-destination.y)>80)
      route = eventCombatDetour = {identity:identity,goal:destination,point:null};
    if (route.point && (Math.hypot(route.point.x-character.x,route.point.y-character.y)<8 ||
        !safeCombatPoint(route.point,target))) route.point=null;
    // Class B: a detour search that found no point searches again once its inputs change: the
    // character's position or the attackers on it. A new goal past 80 starts a new route above. the
    // earlier console searched at most once a second (shared.js:17278).
    const inputs = [character.x, character.y, attackers(character).map(function (e) { return e.id; }).sort().join(",")].join(":");
    if (!route.point && route.searched !== inputs) {
      let score=Infinity;
      // Native collision checks validate both legs; all intermediate samples
      // retain the same secondary-attacker clearance as ordinary combat.
      for(let ring=0;ring<4;ring++)for(let angle=0;angle<16;angle++) {
        const radius=80*Math.pow(2,ring), radians=angle*Math.PI/8;
        const point={x:character.x+Math.cos(radians)*radius,y:character.y+Math.sin(radians)*radius};
        const cost=radius+Math.hypot(destination.x-point.x,destination.y-point.y);
        if(cost>=score || !safeCombatPoint(point,target) ||
            !host.can_move({map:character.map,x:point.x,y:point.y,going_x:destination.x,going_y:destination.y,base:character.base}) ||
            !eventApproachLegSafe(character,point,target) || !eventApproachLegSafe(point,destination,target))continue;
        route.point=point;score=cost;
      }
      if(!route.point)route.searched=inputs;
    }
    if(!route.point)return false;
    const dx=route.point.x-character.x,dy=route.point.y-character.y,length=Math.hypot(dx,dy);
    const next={x:character.x+dx*Math.min(1,step/length),y:character.y+dy*Math.min(1,step/length)};
    return safeCombatPoint(next,target) && sendCombatMove(target,next,"event-terrain-detour");
  }
  function eventApproachLegSafe(from: Point, to: Point, target: Value) {
    const character = ports.character();
    const others=attackers(character,{except:target});
    const samples=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/20));
    for(let index=0;index<=samples;index++) {
      const point={x:from.x+(to.x-from.x)*index/samples,y:from.y+(to.y-from.y)*index/samples};
      if(others.some(function(enemy){return Math.hypot(point.x-enemy.x,point.y-enemy.y)<
        Math.min(Math.hypot(character.x-enemy.x,character.y-enemy.y),Number(enemy.range)||30)-1;}))return false;
    }
    return true;
  }
  async function approachCombatTarget(target: Value) {
    if (ports.franky()) return ports.frankyTick(target);
    if (!target || target.dead) { eventCombatDetour=null; return false; }
    const character = ports.character(), joined = eventFacts().joinedEventName();
    const delta = combatDistance(target) - desiredCombatRange();
    const tolerance = Math.min(3, Math.max(0.5, Number(character.range) * 0.01));
    if (Math.abs(delta) <= tolerance && host.is_in_range(target)) { eventCombatDetour=null; return false; }
    const destination = combatApproachPoint(target)!;
    const step = Math.min(Math.hypot(destination.x - character.x, destination.y - character.y), stepLength(character.speed, 'approach'));
    const fan = approachFan(character, destination, step);
    if (delta>0 && eventCombatDetour && eventCombatDetour.point && eventApproachDetour(target,destination,step)) return true;
    // The least risky approach goes when no candidate is safe and standing still fights
    // nothing. An event boss's approach closes on it whatever idle adds stand near
    // (queue A23): only the attacker rule applies. Fighting adds on the way, the boss
    // approach takes the full check below.
    const eventBoss = delta > 0 && !!joined && target.mtype === joined && !ports.fightsAdds(joined);
    if (eventBoss) {
      for (const point of fan) if (sendCombatMove(target, point, "approaching", "attackers")) return true;
    } else {
      const chosen = chooseCombatStep(fan, target);
      if (chosen) return sendCombatMove(target, chosen, delta > 0 ? "approaching" : "retreating");
    }
    if (delta>0 && eventApproachDetour(target,destination,step)) return true;
    const blockedKite = host.partyCombatPosition;
    host.partyCombatPosition = { at: ports.now(), target: target.id, distance: combatDistance(target),
      desiredRange: desiredCombatRange(), mode: "blocked", movementOwner: "combat",
      blockingAttacker: blockedKite && blockedKite.mode === "blocked" ? blockedKite.blockingAttacker : null,
      reason: stepRefusal ? "Movement refused the step: " + stepRefusal : "No collision-safe combat approach satisfying attacker clearance" };
    return false;
  }
  // The fight queue's sight recovery sends its breadcrumb and detour steps through the first, scores
  // a point by how far it leaves the anchor's cover with the second, and reports why it moves with the
  // third.
  function queueRecoveryMove(point: Point) {
    const groupedCombat = ports.groupedCombat(), target = groupedCombat && groupedCombat.target;
    if (target && ports.safePoint(point)) sendCombatMove(target, point, "fight-recovery");
  }
  function queueCoverageCost(point: Point) {
    const groupedCombat = ports.groupedCombat(), anchor = groupedCombat && groupedCombat.anchor, character = ports.character();
    return anchor && anchor.map === character.map && anchor.in === character.in ?
      Math.max(0, Math.hypot(point.x - anchor.x, point.y - anchor.y) - groupedCombat.range) : 0;
  }
  function queueRecoveryReason(reason: string) {
    host.partyCombatPosition = { at: ports.now(), mode: "fight-recovery", movementOwner: "group", reason: reason };
  }
  // The fight queue's client (runtime/characters/targeting/queue-client.ts) builds the sight recovery through
  // `root.partyMovement.queueSightRecovery` on each install, with its own notice for an exhausted search.
  function queueSightRecovery(unreachable?: (id: string) => void) {
    const movement = ports.movement();
    return createSightRecovery({ now: ports.now, self: () => ports.character(), clear: point => ports.safePoint(point),
      budget: () => movement.sightSearch(), clock: movement,
      cost: point => queueCoverageCost(point), move: point => { queueRecoveryMove(point); }, report: reason => queueRecoveryReason(reason), unreachable });
  }
  return { kiteState, isCurrentlyKiting, desiredCombatRange, combatDistance, combatApproachPoint, resetCombatMovement,
    sendCombatMove, safeCombatPoint, kiteIfNeeded, approachCombatTarget, queueRecoveryMove, queueCoverageCost,
    queueRecoveryReason, queueSightRecovery };
}
// The intercept prediction.
/** Numeric native leg projection; no sampled/estimated game velocity enters here. */
interface NativeMotion {vx:number;vy:number;duration:number}
/** Issue-time numeric evidence, separate from game entities and later packet observations. */
export interface CombatPrediction {at:number;target:RecoveryPoint;destination:RecoveryPoint;targetSpeed:number;own:RecoveryPoint;ownSpeed:number;reach:number;horizon:number}
export function copyPrediction(value?:CombatPrediction):CombatPrediction|undefined {
  return value?{...value,target:{...value.target},destination:{...value.destination},own:{...value.own}}:undefined;
}
function interceptionTime(dx:number,dy:number,speed:number,reach:number,motion:NativeMotion):number {
  const a=motion.vx*motion.vx+motion.vy*motion.vy-speed*speed;
  const b=2*(dx*motion.vx+dy*motion.vy-speed*reach),c=dx*dx+dy*dy-reach*reach;
  if(c<=0)return 0;
  if(Math.abs(a)<1e-8)return b<0?-c/b:Infinity;
  const discriminant=b*b-4*a*c;if(discriminant<0)return Infinity;
  const root=Math.sqrt(discriminant),times=[(-b-root)/(2*a),(-b+root)/(2*a)].filter(t=>t>=0);
  return times.length?Math.min(...times):Infinity;
}
export function predictCombatIntercept(self:RecoveryPoint,speed:number,target:RecoveryPoint,reach:number,motion?:NativeMotion):RecoveryPoint {
  const current={x:target.x,y:target.y};
  if(!motion || ![self.x,self.y,target.x,target.y,speed,reach,motion.vx,motion.vy,motion.duration].every(Number.isFinite))return current;
  if(speed<=0 || reach<0 || motion.duration<=0 || Math.hypot(motion.vx,motion.vy)<=0)return current;
  // The target walks its leg until the game's leg duration ends, so the prediction stops there.
  // also capped it at 2 s, a picked number.
  const time=Math.min(motion.duration,interceptionTime(target.x-self.x,target.y-self.y,speed,reach,motion));
  return {x:target.x+motion.vx*time,y:target.y+motion.vy*time};
}
// The fight queue's sight recovery.
interface SightPorts {now():number;self():Point&{speed:number;moving?:boolean};clear(p:Point):boolean;cost?(p:Point):number;move(p:Point):void;report(reason:string):void;
  // One search's budget, rules.ts `MOVEMENT_PICKS.movementSightSearchMs` and `movementSightSteps` (R2F4).
  budget():{ms:number;steps:number};
  // The walking try's clock for a detour step (`stepStalled`).
  clock:StepClock;
  // The search's end sends `targeting.unreachable` once per search.
  unreachable?(id:string):void}
// `update` is the game's move counter for the character (`move_num`), which counts its entity updates.
interface Footstep extends Point {at:number;visible:boolean;update?:unknown}
/** Breadcrumbs and local detours only; no weapon-range circles or pathfinder. */
export function createSightRecovery(p:SightPorts){
  let key='',historyKey='',history:Footstep[]=[],trail:Point[]=[],side=1,progressAt=0,distance=Infinity;
  let waypoint:Point|null=null,fan=0,startedAt=0,steps=0,told=false;
  // Where the character stood and the goal of the last fan that found no step.
  let blocked='';
  const failed=new Map<string,number>(),visited=new Map<string,number>();
  const cell=(v:Point)=>Math.round(v.x/8)+','+Math.round(v.y/8);
  function reset(){key='';waypoint=null;trail=[];failed.clear();visited.clear();fan=0;blocked='';}
  // sight-recovery.ts:17: a footstep is sampled per entity update the game sends for the
  // character, and the history covers one search's budget (:19).
  function observe(id:string,pos:Point&{move_num?:unknown},visible:boolean){
    if(historyKey!==id){historyKey=id;history=[];reset();}
    const now=p.now(),last=history.at(-1);
    if(!last||Math.hypot(last.x-pos.x,last.y-pos.y)>=4||last.visible!==visible||last.update!==pos.move_num)
      history.push({x:pos.x,y:pos.y,at:now,visible,update:pos.move_num});
    history=history.filter(v=>now-v.at<=p.budget().ms).slice(-80);
    if(visible)reset();
  }
  function tick(id:string,last:Point,remembered:Point|null,observers:Point[]){
    const now=p.now(),self=p.self();
    if(key!==id){startedAt=now;steps=0;told=false;key=id;side=1;progressAt=now;distance=Infinity;waypoint=null;fan=0;
      let visibleIndex=-1; if(historyKey===id)history.forEach((v,i)=>{if(v.visible)visibleIndex=i;});
      trail=visibleIndex>=0?history.slice(Math.max(0,visibleIndex-8)).reverse().map(v=>({x:v.x,y:v.y})):remembered?[remembered]:[];
    }
    const budget=p.budget();
    if(now-startedAt>=budget.ms||steps>=budget.steps){p.report('Search paused: bounded search exhausted; awaiting fresh coverage or target retirement');if(!told){told=true;p.unreachable?.(id);}return true;}
    // The failed and visited cells live as long as the search (sight-recovery.ts:29); `reset` clears them.
    if(waypoint){const gap=Math.hypot(self.x-waypoint.x,self.y-waypoint.y);
      if(gap<distance-2){distance=gap;progressAt=now;}
      if(gap<5){visited.set(cell(waypoint),now);waypoint=null;}
      else if(!p.clear(waypoint)||stepStalled(self.moving,progressAt,now,p.clock)){failed.set(cell(waypoint),now);waypoint=null;side*=-1;fan++;}
      else {p.report('Recovering sight: continuing local detour');return true;}
    }
    while(trail.length && Math.hypot(self.x-trail[0].x,self.y-trail[0].y)<7)trail.shift();
    const observer=observers.slice().sort((a,b)=>Math.hypot(a.x-self.x,a.y-self.y)-Math.hypot(b.x-self.x,b.y-self.y))[0];
    const goal=trail[0]||observer||last;
    const reason=trail.length?'retracing recent footsteps':observer?'approaching teammate who sees target':'searching from last useful sighting';
    const length=Math.max(8,Math.min(24,self.speed*0.4)),gap=Math.hypot(goal.x-self.x,goal.y-self.y);
    // A blocked fan widens its radius every four tries up to its widest (below); at the widest,
    // the same fan again finds the same nothing until the character or the goal moves.
    const inputs=[self.x,self.y,goal.x,goal.y].join();
    if(fan>=8&&blocked===inputs){p.report('Recovering sight: local steps blocked; retrying without releasing target');return true;}
    const heading=Math.atan2(goal.y-self.y,goal.x-self.x);
    const allowed=(v:Point)=>!failed.has(cell(v))&&!visited.has(cell(v))&&p.clear(v);
    const send=(v:Point,why:string)=>{steps++;waypoint=v;distance=Math.hypot(v.x-self.x,v.y-self.y);progressAt=now;p.report('Recovering sight: '+why);p.move(v);return true;};
    if(gap>=7){const direct={x:self.x+(goal.x-self.x)*Math.min(1,length/gap),y:self.y+(goal.y-self.y)*Math.min(1,length/gap)};
      if(allowed(direct))return send(direct,reason);
      failed.set(cell(direct),now);
    } else if(trail.length)trail.shift();
    // Keep the same side while progressing; reverse only on a stall or blocked fan.
    for(let pass=0;pass<2;pass++){
      const candidates=[30,60,90,120,150].map((degrees,index)=>{
        const angle=heading+side*degrees*Math.PI/180;
        const radius=length*(1+Math.min(2,Math.floor(fan/4))*0.25);
        return {x:self.x+Math.cos(angle)*radius,y:self.y+Math.sin(angle)*radius,index};
      }).filter(allowed).sort((a,b)=>(p.cost?.(a)||0)-(p.cost?.(b)||0)||a.index-b.index);
      if(candidates.length){fan++;return send(candidates[0],gap<7?'bounded fan search':'persistent '+(side>0?'left':'right')+' detour; '+reason);}
      side*=-1;
    }
    // Class B: a blocked fan tries again on the next movement tick until its radius is at its widest,
    // then once the character or the goal moves. v1.5.0 waited 250 ms.
    fan++;blocked=inputs;p.report('Recovering sight: local steps blocked; retrying without releasing target');return true;
  }
  return {tick,reset,observe};
}
