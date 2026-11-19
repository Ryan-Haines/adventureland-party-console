// The member's formation.
// The group movement (appendix A2 GRP): the approach report each status carries, the anchor's
// cover, the leader's group approach request, the fight and encounter catch-up moves, and the
// regroup toward the anchor with its steps and its task walk ladder. The formation solver
// (appendix A2 FORM): the party's live bodies, the swept monster clearance, the step a fighter
// takes around its healer and target, the hold, the spread step and the defensive kite. The corner
// and terrain recovery (appendix A2 TERR): the solver's detour around a blocked approach, the
// terrain recovery's goals, safe segments and follower, and the ports its client drives. The terrain
// recovery itself (from runtime/combat/): the route search and the member's recovery client,
// which the fight queue's client ticks; the coordinator's recovery round is
// movement/coordinator/recovery.ts. Both parts keep b9b5c91e's order and fields; their
// windows are the fix pass's signals (fix pass rows).

import type { WalkClient } from './walk-client.ts';
import { partyHooks } from '../../hooks/index.ts';
import type { FormationRecovery, FormationRecoveryReport, RecoveryPoint } from '../geometry/contracts.ts';
import { movementError } from './records.ts';
import { taskRound } from '../../protocol/ladder.ts';
import { currentQueue } from '../../protocol/reports.ts';
import { samePlace } from '../../protocol/place.ts';
import { approachFan, occupied, stepLength, stepStalled, stepWindowMs } from './steps.ts';
import { eventFacts } from '../../events/api.ts';
import { boundFired, capReached } from '../../status/api.ts';
import { DEFAULT_MONSTER_RANGE } from '../geometry/step-safety.ts';

// The movement service, the game objects and the group and formation records are shared.js's
// untyped values.
type Value = any;
interface Request { kind: string; owner: string; tier?: string }
// The game's functions and runtime records the group movement reads, on shared.js's runtime root.
interface FormationHost {
  parent: { entities?: Record<string, Value> };
  get_entity(id: Value): Value;
  get_player(name: string): Value;
  can_move_to(x: number, y: number): boolean;
  partyCombatPosition?: Value;
  partyQueueClient?: Value;
  __partyTargetLastVisible?: Value;
  __partyFarmingEngagement?: Value;
}
// What shared.js hands the group movement: one read each of its state, its formation and farm
// approach moves, the hunting owner's hunt travel stand-ins, and the movement requesters' walks, until
// that state and those moves reach their owners.
interface FormationPorts {
  // The formation solver's defensive move, which the regroup takes first.
  defensiveFormationMove(): boolean;
  // The card's navigation detail (owner.ts WalkState `navigationDetail`, its one writer).
  showNavigation(detail: string | null): void;
  now(): number;
  character(): Value;
  G(): Value;
  movement(): Value;
  intent(): { revision: number; cancelled?: boolean };
  groupedCombat(): Value;
  clockOffset(): number;
  leader(): string | null;
  partyLocation(): Value;
  // The coordinator's convoy mark (shared.js `partyConvoyActive`).
  convoyActive(): boolean;
  joinedEvent(): Value;
  kite(): Value;
  formation(): Value;
  rareControl(): Value;
  grouped(): boolean;
  fresh(): boolean;
  anchorVisible(): boolean;
  defensiveTarget(): Value;
  huntDefense(): boolean;
  huntControl(): Value;
  rareActive(): boolean;
  escaping(): boolean;
  attacking(entity: Value): boolean;
  passiveRare(target: Value): boolean;
  passingKey(target: Value): string;
  realm(): string;
  combatDistance(target: Value): number;
  safeCombatPoint(point: { x: number; y: number }, target: null): boolean;
  cancelFarmApproach(reason: string): void;
  formationMove(target: Value): boolean;
  holdFormation(reference: Value, reason: string): boolean;
  logGroupMovement(key: string, message: string): void;
  request(path: string, options: { method: string; body: unknown }): Promise<unknown>;
  // Resolves when this character's next status report completes (owner.ts `nextReport`).
  nextReport(): Promise<void>;
  smartMove(destination: Value, callback: undefined, options: { request: Value }): Promise<unknown>;
  catchupRequest(route: Value): Request;
  endTaskWalk(owner: string): void;
  climbTaskWalk(walk: Value): void;
}

export function installGroupMovement(host: FormationHost, walk: WalkClient, ports: FormationPorts) {
  let approachObservation: { identity: string; x: number; y: number } | null = null;
  let groupRegroup: Value = { key: null, distance: Infinity, progressAt: 0, climb: null };
  // The leader's group approach request is pending from its send until its answer, and a sent one
  // asks again after the member's next report (RF6 class B).
  let groupApproachPending = false;
  function groupedApproachReport() {
    const groupedCombat = ports.groupedCombat(), character = ports.character(), navigationIntent = ports.intent(), kiteState = ports.kite();
    const t=groupedCombat && groupedCombat.target, p=host.partyCombatPosition || {}, now=ports.now()+ports.clockOffset();
    if(!t)return null;
    const identity=JSON.stringify([t.server,t.map,t.in,t.id]);
    const prior=approachObservation, displacement=prior && prior.identity===identity ? Math.hypot(character.x-prior.x,character.y-prior.y) : 0;
    approachObservation={identity:identity,x:character.x,y:character.y};
    const entity=host.get_entity(t.id), recovery=ports.formation().recovery;
    let point=recovery && recovery.point;
    const individual=host.partyQueueClient && host.partyQueueClient.independent && host.partyQueueClient.independent.report();
    if(individual && individual.target===String(t.id))point=individual.goal;
    let active=ports.fresh() && !navigationIntent.cancelled && (!(ports.convoyActive() || walk.groupWalk.travel) || ports.huntDefense()) &&
      !character.rip && !eventFacts().travellingEventName() && !ports.joinedEvent() && !occupied() &&
      !(groupedCombat.recovering || []).length && p.target===t.id;
    if(individual && individual.target===String(t.id))active=ports.fresh() && !navigationIntent.cancelled && !character.rip && !eventFacts().travellingEventName();
    return {target:identity,at:now,active:!!active,visible:!!(entity && entity.visible && !entity.dead),
      intent:individual && individual.target===String(t.id) || ports.combatDistance(t)>Number(character.range || 0) || !(entity && entity.visible && !entity.dead) || Number(p.coverageDeficit)>0 ? 'approach':'hold',moving:!!character.moving,displacement:displacement,
      deficit:Math.max(0,ports.combatDistance(t)-Number(character.range || 0)),coverage:Number(p.coverageDeficit)||0,
      blocked:p.constraint || (String(p.reason || "").indexOf("movement rejected")===0 ? p.reason : null),destination:individual?individual.goal:kiteState.destination || null,issuedAt:individual?p.at:kiteState.lastMoveAt,
      waypoint:point ? {key:individual?individual.id:JSON.stringify([identity,point.x,point.y]),remaining:Math.hypot(character.x-point.x,character.y-point.y)} : undefined};
  }
  function groupedCovered() {
    const groupedCombat = ports.groupedCombat(), character = ports.character();
    if (!ports.fresh() || !groupedCombat.anchor) return false;
    let anchor = host.get_player(groupedCombat.anchor.name) || groupedCombat.anchor;
    if (groupedCombat.anchor.name === character.name) anchor = character;
    return anchor.map === character.map && anchor.in === character.in &&
      Math.hypot(character.x-anchor.x,character.y-anchor.y) <= groupedCombat.range;
  }
  function requestGroupApproach(destination: Value) {
    const groupedCombat = ports.groupedCombat(), character = ports.character();
    if (!ports.grouped() || !groupedCombat) return false;
    if (ports.convoyActive() || walk.groupWalk.travel) return true;
    if (character.name !== ports.leader() || !groupedCovered() || groupApproachPending) return true;
    groupApproachPending=true;
    ports.request("/grouped-approach", {method:"POST",body:{character:character.name, key:groupedCombat.key,
      navigationRevision:ports.intent().revision, selection:groupedCombat.selection,
      location:{map:destination.map,x:destination.x,y:destination.y}}})
      .then(function () { ports.logGroupMovement("approach", "Group path recovery: convoy to " + destination.map + " [" + Math.round(destination.x) + ", " + Math.round(destination.y) + "]"); })
      .catch(function (error) {
        const held = "Group approach held: "+String(error.message || error);
        ports.showNavigation(held);
        ports.logGroupMovement("approach-held", held);
      })
      .then(function () { return ports.nextReport(); })
      .finally(function () {groupApproachPending=false;});
    return true;
  }
  function cancelGroupRoute() {
    // The regroup climb ends with its journey or hold, by its own identity.
    if (groupRegroup.climb) {
      const climbed = groupRegroup.climb; groupRegroup.climb = null; ports.endTaskWalk(climbed);
    }
  }
  function groupedFightMovement() {
    const groupedCombat = ports.groupedCombat(), character = ports.character();
    const fight=groupedCombat.target, now=ports.now(), entity=fight && host.get_entity(fight.id);
    cancelGroupRoute();
    if(!fight)return false;
    if(fight.map!==character.map || fight.in!==character.in || fight.server!==ports.realm()) {
      ports.cancelFarmApproach("shared target is in another instance");
      host.partyCombatPosition={at:now,mode:"fight-recovery",movementOwner:"group",reason:"Shared target is in another instance; waiting for authorized farm return"};return true;
    }
    if(entity && entity.visible && !entity.dead) {
      if(host.partyQueueClient)host.partyQueueClient.sight.reset();
      return false; // Visible but outside weapon range uses the ordinary approach.
    }
    ports.cancelFarmApproach("local visibility recovery owns movement");
    if(!host.partyQueueClient){host.partyCombatPosition={at:now,mode:"fight-recovery",reason:"Waiting for local visibility recovery runtime; target retained"};return true;}
    const prior=host.__partyTargetLastVisible;
    const remembered=prior && prior.id===fight.id && prior.map===character.map && prior.in===character.in ? prior : null;
    const allies=(groupedCombat.observers||[]).filter(function(p: Value){return p.name!==character.name && p.map===character.map && p.in===character.in && p.server===ports.realm() && ports.movement().fresh(p.seenAt,ports.now()+ports.clockOffset(),'report',0,true);});
    if(ports.fresh() && allies.length && ports.formationMove(fight))return true;
    return host.partyQueueClient.sight.tick(fight.id,fight,remembered,allies);
  }
  function cancelEncounterCatchup(c: Value) {
    const route=c && c.encounterCatchup;
    if(!route)return;
    route.cancelled=true;delete c.encounterCatchup;
    // The holder's own release is a no-op once another request holds movement.
    ports.movement().release(ports.catchupRequest(route).owner);
  }
  function encounterCatchup() {
    const c=walk.groupWalk.travel, control=ports.huntControl(), navigationIntent=ports.intent(), character=ports.character();
    const t=control && control.primary;
    const allowed=c && control && control.defending && c.phase==='defending' && !c.holdRequested && !c.communication &&
      !navigationIntent.cancelled && Number(c.navigationRevision)===Number(navigationIntent.revision) &&
      !character.rip && !ports.joinedEvent() && !eventFacts().travellingEventName() && !ports.escaping() && ports.fresh();
    if(!allowed || !t || t.server!==ports.realm()){cancelEncounterCatchup(c);return false;}
    if(t.map===character.map && String(t.in??t.map)===String(character.in||character.map)){cancelEncounterCatchup(c);return false;}
    const key=JSON.stringify([c.id,c.epoch,c.commandId,c.navigationRevision,ports.passingKey(t)]);
    if(c.encounterCatchup && c.encounterCatchup.key!==key)cancelEncounterCatchup(c);
    let route=c.encounterCatchup;
    if(route){
      // The request's currency test and its journey's walking try end the walk.
      ports.showNavigation(route.failed || 'Joining '+t.mtype+' encounter; leaving '+character.map);
      return true;
    }
    route=c.encounterCatchup={key:key,target:ports.passingKey(t),from:character.map,map:t.map,startedAt:ports.now()};
    if(String(t.in??t.map)!==t.map){route.failed='Encounter catch-up requires instance '+t.in;return true;}
    let moving;
    // The walk phase table `hold` for a regroup (CF4 W row `encounterCatchup`:14552): the catch-up is current while
    // the travel defense still names its encounter, and its journey's
    // walking try ends a walk that stalls, so no deadline bounds it.
    const catchup=Object.assign(ports.catchupRequest(route),{current:function(){return c.encounterCatchup===route && !route.cancelled;}});
    try{moving=ports.smartMove({map:t.map,x:t.x,y:t.y},undefined,{request:catchup});}
    catch(error){route.failed='Encounter catch-up failed: '+String(error);return true;}
    Promise.resolve(moving).then(function(){if(!route.cancelled)route.arrived=true;},function(error){if(!route.cancelled)route.failed='Encounter catch-up failed: '+String(error);});
    ports.showNavigation('Joining '+t.mtype+' encounter; leaving '+character.map);
    return true;
  }
  function groupedMovement(positions?: () => boolean) {
    if(encounterCatchup())return true;
    const travel = walk.groupWalk.travel, groupedCombat = ports.groupedCombat(), character = ports.character(), navigationIntent = ports.intent();
    const movement = ports.movement(), client = host.partyQueueClient;
    if(travel && !travel.defensePaused)return true;
    if(!(groupedCombat && groupedCombat.independentApproach) && client && client.formation && client.formation.movement())return true;
    const ownedApproach=client && client.independent && client.independent.report();
    const continuingApproach=ownedApproach && groupedCombat && groupedCombat.target && ownedApproach.target===String(groupedCombat.target.id) &&
      !Object.values(host.parent.entities||{}).some(function(e){return e && e.type==='monster' && !e.dead && (e.target===character.name || String(e.id)!==ownedApproach.target && ports.attacking(e));});
    if (!continuingApproach && ports.defensiveTarget() && !navigationIntent.cancelled && !character.rip && !occupied()) {
      cancelGroupRoute(); ports.cancelFarmApproach("defending visible party attackers");
      return false;
    }
    // The coordinator announces ownership before the local command arrives.
    // Never stop or reverse that route while waiting for our command.
    if ((ports.convoyActive() || travel) && !ports.huntDefense() && !host.__partyFarmingEngagement) { cancelGroupRoute(); return true; }
    if (!ports.grouped() || navigationIntent.cancelled || character.rip || occupied() ||
        ports.rareActive() && ports.rareControl().kind !== "encounter") { cancelGroupRoute(); return false; }
    if (!groupedCombat) {return false;}
    const individualTarget=groupedCombat.target;
    if(groupedCombat.independentApproach && ports.fresh() && individualTarget && individualTarget.server===ports.realm() &&
        individualTarget.map===character.map && individualTarget.in===character.in && client && client.independent) {
      cancelGroupRoute();
      return client.independent.movement();
    }
    if (groupedCombat.fights && groupedCombat.fights.length || groupedCombat.target &&
        ports.passiveRare(groupedCombat.target)) return groupedFightMovement();
    const now = ports.now(), fresh = ports.fresh();
    let anchor = fresh && groupedCombat.anchor;
    const key = groupedCombat.key + ":" + navigationIntent.revision;
    if (key !== groupRegroup.key) {
      cancelGroupRoute(); groupRegroup = { key: key, distance: Infinity, progressAt: now };
    }
    const covered = fresh && groupedCovered();
    const visible = anchor && (anchor.name === character.name || ports.anchorVisible());
    const together = anchor && samePlace(anchor, character);
    const separated = anchor && (!together || (!visible || groupedCombat.formationRecovery) && Math.hypot(character.x-anchor.x,character.y-anchor.y) > Math.max(10,groupedCombat.range-10));
    const recovering = groupedCombat.recovering && groupedCombat.recovering.indexOf(character.name) >= 0;
    if (fresh && (!separated && !recovering || covered && visible) && !groupedCombat.formationRecovery) {
      cancelGroupRoute();
      const nominated=groupedCombat.target;
      if(nominated && nominated.state==='planned' && !(groupedCombat.recovering || []).length &&
          nominated.server===ports.realm() && nominated.map===character.map && nominated.in===character.in) {
        const local=host.get_entity(nominated.id);
        const sight=(groupedCombat.observers || []).some(function(o: Value){return o.server===ports.realm() &&
          o.map===character.map && o.in===character.in && movement.fresh(o.seenAt,now+ports.clockOffset());});
        ports.cancelFarmApproach("coordinated target approach owns movement");
        // An add-on that places this character around its target answers first (the
        // "grouped-target-formation" mover in runtime/movement/rules.ts MOVERS).
        if(typeof positions==="function" && positions())return true;
        if(!groupedCombat.ready)return ports.holdFormation(nominated,"waiting for ready party reports");
        if(local && local.visible && !local.dead || sight) return ports.formationMove(local && local.visible && !local.dead ? local : nominated);
        ports.holdFormation(nominated,"missing fresh target visibility");
        return true;
      }
      return false;
    }
    ports.cancelFarmApproach("group cohesion owns movement");
    const reason = fresh ? groupedCombat.blockers.join("; ") : "waiting for fresh group state";
    host.partyCombatPosition = { at: now, mode: "group-regrouping", movementOwner: "group", reason: reason,
      priest: groupedCombat.priest, healingRange: groupedCombat.range };
    // Do not drag an endangered character into a pathfinding wait.
    if (ports.defensiveFormationMove()) { cancelGroupRoute(); return true; }
    if (!anchor || anchor.server !== ports.realm() || groupedCombat.blockers.some(function (reason: string) { return reason.indexOf(": manual navigation") >= 0; })) {
      cancelGroupRoute(); return true;
    }
    const live = anchor.name === character.name ? character : host.get_player(anchor.name);
    if (live && live.visible) anchor = Object.assign({}, anchor, {x:live.x,y:live.y});
    const same = samePlace(anchor, character);
    const dist = same ? Math.hypot(character.x-anchor.x,character.y-anchor.y) : Infinity;
    const inner = Math.max(10,groupedCombat.range-10);
    if (anchor.name === character.name || dist <= inner) {
      cancelGroupRoute();
      // Arriving stops only the regroup step (design section 2.4 rule 6).
      movement.holdStep();
      return false;
    }
    if (dist < groupRegroup.distance-8) { groupRegroup.distance=dist; groupRegroup.progressAt=now; }
    // CF4 W rows shared.js:14634,:14656: the native steps go on until their walking try stalls
    // (`stepStalled`), not for a fixed window.
    const regroupStalled = stepStalled(character.moving, groupRegroup.progressAt, now, movement);
    if (same && !regroupStalled) {
      const length=Math.min(Number(character.speed || 40)*0.6, Math.max(1,dist-inner+5));
      let point={x:character.x+(anchor.x-character.x)*length/dist,y:character.y+(anchor.y-character.y)*length/dist};
      let waypoint = groupRegroup.waypoint;
      if (waypoint && Math.hypot(character.x-waypoint.x,character.y-waypoint.y) < 8) waypoint = null;
      if (!waypoint) {
        const heading = Math.atan2(anchor.y-character.y,anchor.x-character.x);
        const offsets = [0, Math.PI/6, -Math.PI/6, Math.PI/3, -Math.PI/3, Math.PI/2, -Math.PI/2];
        for (let i=0;i<offsets.length;i++) {
          point={x:character.x+Math.cos(heading+offsets[i]!)*length,y:character.y+Math.sin(heading+offsets[i]!)*length};
          if (host.can_move_to(point.x,point.y) && ports.safeCombatPoint(point,null)) { waypoint=point; break; }
        }
        groupRegroup.waypoint=waypoint;
      }
      if (waypoint && host.can_move_to(waypoint.x,waypoint.y) && ports.safeCombatPoint(waypoint,null)) {
        // The service sends this step once while the character walks it (design section 2.4 rule 4).
        Promise.resolve(movement.step(waypoint,"group-regroup").sent).catch(function (error: unknown) {
          ports.logGroupMovement("regroup-step", "Group regroup step rejected: " + movementError(error).message);
        }); return true;
      }
    }
    // Queue A28: once the native steps stall, the member climbs a task walk's ladder toward the
    // anchor, by the saved farm spot when the direct way fails, while it makes progress; no count
    // ends it and new pulls are not held.
    if (!regroupStalled) return true;
    const regroupOwner = "regroup:" + anchor.name + ":" + navigationIntent.revision, target = anchor;
    if (groupRegroup.climb && groupRegroup.climb !== regroupOwner) cancelGroupRoute();
    groupRegroup.climb = regroupOwner;
    const partyLocation = ports.partyLocation();
    const farmSpot = partyLocation && partyLocation.map ? { point: { map: partyLocation.map, x: partyLocation.x, y: partyLocation.y }, name: "the saved farm spot" } : undefined;
    ports.climbTaskWalk({ owner: regroupOwner, request: { kind: "formation", owner: regroupOwner }, round: taskRound(ports.G(), anchor.name, farmSpot),
      activity: "Rejoining the group",
      goal: function () { return { map: target.map, in: target.in, x: target.x, y: target.y }; },
      current: function () { return groupRegroup.climb === regroupOwner; } });
    return true;
  }
  return { groupedApproachReport, groupedCovered, requestGroupApproach, cancelGroupRoute, groupedFightMovement,
    cancelEncounterCatchup, encounterCatchup, groupedMovement };
}
interface Point { x: number; y: number }
// The game's reads and the runtime records the formation solver reads and writes, on shared.js's
// runtime root.
interface SolverHost {
  parent: { entities?: Record<string, Value> };
  get_player(name: string): Value;
  get_entity(id: Value): Value;
  is_in_range(target: Value): boolean;
  can_move_to(x: number, y: number): boolean;
  // The game's distance, can_move and can_walk come from old_common_functions.js, which the CODE
  // runner loads in the browser and in caracAL (the client's client_scripts.json `runner` list).
  // The recovery's debug drawing checks draw_line, as today.
  distance(a: Value, b: Value): number;
  can_move(query: Value): boolean;
  draw_line?(x: number, y: number, x2: number, y2: number, size: number, color: number): Value;
  draw_circle?(x: number, y: number, radius: number, size: number, color: number): Value;
  partyCombatPosition?: Value;
  partyCombatPerformance?: Value;
  partyQueueClient?: Value;
  partyRoleRunner?: { isKnownDead(id: Value): boolean; wake(): void };
  partyLootClient?: { huntPending(): boolean };
  partyFormationRecoveryDebug?: boolean;
  __partyFarmingEngagement?: Value;
}
// What shared.js hands the formation solver: one read each of its state and of the errands a
// spread step waits for, the combat steps' kite record and rules (STEP), the independent
// approach's formation target, journey check, intercept and route cancel (APP), the group route's
// cancel and the anchor's cover (GRP), the terrain recovery's requester, route and stop, and the
// event log, until that state and those rules reach their owners.
interface SolverPorts {
  now(): number;
  clockOffset(): number;
  character(): Value;
  G(): Value;
  movement(): Value;
  partyList(): string[];
  partyPositions(): Value[];
  realm(): string;
  groupedCombat(): Value;
  grouped(): boolean;
  joinedEvent(): Value;
  scatter(): boolean;
  leader(): string | null;
  followLeader(): boolean;
  sameTeam(member: Value): boolean;
  leaderSelection(): Value;
  franky(): boolean;
  // The items owner's errand row `formation` (items/rules.ts ERRAND_ROWS) and this character's pending departure.
  bagErrand(): boolean;
  departurePending(): boolean;
  convoyActive(): boolean;
  following(): boolean;
  kite(): Value;
  combatDistance(target: Value): number;
  desiredCombatRange(): number;
  resetCombatMovement(): void;
  sendCombatMove(target: Value, destination: Point, mode: string): boolean;
  safeCombatPoint(point: Point, target: Value): boolean;
  combatApproachPoint(target: Value, desired?: number | null, center?: Point | null): Value;
  kiteIfNeeded(target: Value): Promise<unknown>;
  independentApproach(): { reference: { target: Value; at: number } | null };
  independentApproachOwns(): boolean;
  interceptCenter(target: Value, desired: number): Point | null;
  rangeReference(target: Value, point?: Point | null): Value;
  cancelFarmApproach(reason: string): void;
  intent(): { cancelled?: boolean };
  dungeonOwned(): boolean;
  fresh(): boolean;
  unfinishedFight(): boolean;
  activeEvent(): Value;
  recoveryHolds(): boolean;
  covered(): boolean;
  cancelGroupRoute(): void;
  recoveryRequest(): Request;
  smartMove(destination: Value, callback: undefined, options: { request: Request; town: boolean; gate: Value }): Promise<unknown>;
  stop(request: Request): Promise<unknown>;
  logEvent(type: string, message: string, details: Value, key: string): void;
}

export function createFormationSolver(host: SolverHost, walk: WalkClient, ports: SolverPorts) {
  const formationState: Value = { priest: null, direction: 1, heading: null, targetId: null };
  const formationPerformance = { ticks: 0, totalMs: 0, maxMs: 0, candidates: 0, collisionChecks: 0 };
  // The visible monsters, attackers, own body and motion cache of one solver pass; null between
  // passes.
  let formationFrame: Value = null;
  // The last spread step and its window (`stepWindowMs`), which holds the next spread step back.
  let lastSeparationAt = 0, separationMs = 0;
  function setFormationFrame(frame: Value) { formationFrame = frame; }
  function formationDistance(a: Value, b: Value) {
    return host.distance(a, b);
  }
  function formationMelee(member: Value) {
    return ["warrior", "paladin", "rogue"].indexOf(member.ctype) >= 0 && Number(member.range) < 100;
  }
  // The priest's healing range less a margin of a tenth of it, between 8 and 20, as b9b5c91e
  // shared.js wrote it at each of its eight sites.
  function safeHealingRange(priest: Value) {
    const range = Number(priest.range);
    return range - Math.min(20, Math.max(8, range * 0.1));
  }
  // A step keeps cover when it ends within the safe range of the priest, or of every member for
  // the priest itself. A member already farther than the safe range may keep its distance.
  function coveredStep(body: Value, members: Value[], priest: Value, selfPriest: boolean, safeRange: number) {
    const character = ports.character();
    const near = (other: Value) => formationDistance(body, other) <= Math.max(safeRange, formationDistance(character, other)) + 0.01;
    return selfPriest ? members.every(function (ally) { return ally.name === character.name || near(ally); }) : near(priest);
  }
  // A healthy melee member that nothing attacks may leave cover while another member is the
  // reference's target.
  function maySeparate(reference: Value, members: Value[], selfPriest: boolean) {
    const character = ports.character();
    return !selfPriest && formationMelee(character) && !formationFrame.attackers.length &&
      Number(character.max_hp) > 0 && Number(character.hp) >= Number(character.max_hp) * 0.6 &&
      members.some(function (ally) { return ally.name !== character.name && ally.name === reference.target && !ally.rip; });
  }
  function formationMembers(): Value[] {
    const roster = ports.partyList(), now = ports.now() + ports.clockOffset(), character = ports.character(), movement = ports.movement();
    const positions: Value[] = character.cave ? roster.map(function (name) { return name === character.name ? character : host.get_player(name); }).filter(Boolean) : ports.partyPositions();
    return positions.filter(function (member) {
      return member && roster.indexOf(member.name) >= 0 && member.ctype !== "merchant";
    }).map(function (member) {
      const live = member.name === character.name ? character : host.get_player(member.name);
      if (live && (live === character || live.visible)) return Object.assign(formationBody(live), {
        name: live.name, ctype: live.ctype, hp: live.hp, rip: live.rip, range: live.range, team: live.team });
      if (!movement.fresh(Number(member.seenAt), now) || member.server !== ports.realm()) return null;
      return member;
    }).filter(function (member) {
      return member && !member.rip && member.hp > 0 && member.map === character.map &&
        (member.in == null || character.in == null || member.in === character.in);
    });
  }
  // Only numeric geometry enters the solver. Never copy renderer/game entities.
  function formationBody(entity: Value, point?: Point | null): Value {
    return { x: point ? point.x : Number(entity.real_x !== undefined ? entity.real_x : entity.x),
      y: point ? point.y : Number(entity.real_y !== undefined ? entity.real_y : entity.y),
      awidth: Number(entity.awidth !== undefined ? entity.awidth : (entity.width || 0) / (entity.mscale || 1)) || 0,
      aheight: Number(entity.aheight !== undefined ? entity.aheight : (entity.height || 0) / (entity.mscale || 1)) || 0,
      map: entity.map, in: entity.in };
  }
  function formationMotion(entity: Value) {
    const body = formationBody(entity);
    const moving = entity.moving && Number.isFinite(entity.going_x) && Number.isFinite(entity.going_y);
    const dx = moving ? entity.going_x - body.x : 0, dy = moving ? entity.going_y - body.y : 0;
    const speed = Number(entity.speed) || 0, length = Math.hypot(dx, dy);
    const duration = length && speed > 0 ? length / speed : 0;
    return { body: body, duration: duration, vx: duration ? dx / duration : 0, vy: duration ? dy / duration : 0,
      id: entity.id, safety: formationMonsterSafety(entity) };
  }
  function formationMonsterSafety(entity: Value) {
    const G = ports.G(), groupedCombat = ports.groupedCombat(), character = ports.character();
    const definition=G.monsters && G.monsters[entity.mtype] || {};
    const range=Number(entity.range || definition.range) || DEFAULT_MONSTER_RANGE;
    const selected=entity.id===formationState.targetId || groupedCombat && groupedCombat.target && entity.id===groupedCombat.target.id;
    if(selected)return Math.min(range,Math.max(6,Number(character.range)-24))+8;
    // A ranged monster's reach is not a solid collision obstacle while it targets
    // a teammate; preserve its full reach for its own target (#121).
    if(entity.target!==character.name && range>Number(character.range))return 38;
    return range+8;
  }
  function priestSecondaryClearance(point: Point, enemies: Value[]) {
    const character = ports.character();
    const own = formationFrame ? formationFrame.self : formationBody(character), speed = Number(character.speed) || 0;
    const dx = point.x - own.x, dy = point.y - own.y, length = Math.hypot(dx, dy);
    const duration = length && speed > 0 ? length / speed : 0;
    const vx = duration ? dx / duration : 0, vy = duration ? dy / duration : 0;
    const result: { minimum: number; end: number; current: number; nearest: Value; risk: number } =
      { minimum: Infinity, end: Infinity, current: Infinity, nearest: null, risk: 0 };
    for (let n = 0; n < enemies.length; n++) {
      const enemy = enemies[n];
      let other = formationFrame && formationFrame.motions.get(enemy);
      if (!other) {
        other = formationMotion(enemy);
        if (formationFrame) formationFrame.motions.set(enemy, other);
      }
      const motion = other, b = motion.body;
      const separation = function (time: number) {
        const ax = own.x + vx * Math.min(time, duration), ay = own.y + vy * Math.min(time, duration);
        const bx = b.x + motion.vx * Math.min(time, motion.duration), by = b.y + motion.vy * Math.min(time, motion.duration);
        return Math.hypot(Math.max(Math.abs(ax - bx) - (own.awidth + b.awidth) / 2, 0),
          Math.max(by - b.aheight - ay, ay - own.aheight - by, 0));
      };
      const initial = separation(0);
      let minimum = initial;
      if (initial < result.current) { result.current = initial; result.nearest = motion.id; }
      const first = Math.min(0.6, duration, motion.duration), second = Math.min(0.6, Math.max(duration, motion.duration));
      let start = 0;
      for (let i = 0; i < 3; i++) {
        const end = i === 0 ? first : i === 1 ? second : 0.6;
        if (end <= start) continue;
        const rx = vx * (start < duration ? 1 : 0) - motion.vx * (start < motion.duration ? 1 : 0);
        const ry = vy * (start < duration ? 1 : 0) - motion.vy * (start < motion.duration ? 1 : 0);
        const ax = own.x + vx * Math.min(start, duration) - b.x - motion.vx * Math.min(start, motion.duration);
        const ay = own.y + vy * Math.min(start, duration) - b.y - motion.vy * Math.min(start, motion.duration);
        const denominator = rx * rx + ry * ry;
        const closest = denominator ? Math.max(0, Math.min(end - start, -(ax * rx + ay * ry) / denominator)) : 0;
        minimum = Math.min(minimum, separation(start), separation(start + closest), separation(end));
        start = end;
      }
      result.minimum = Math.min(result.minimum, minimum);
      result.end = Math.min(result.end, separation(0.6));
      result.risk += Math.max(0, motion.safety - minimum);
    }
    return result;
  }
  function formationSegmentSafe(from: Point, to: Point, obstacles: Value[]) {
    const character = ports.character();
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const count = Math.max(1, Math.ceil(length / Math.max(8, Number(character.speed || 40) * 0.6)));
    const saved = formationFrame.self;
    try {
      for (let i = 0; i < count; i++) {
        const start = { x: from.x + (to.x - from.x) * i / count, y: from.y + (to.y - from.y) * i / count };
        const end = { x: from.x + (to.x - from.x) * (i + 1) / count, y: from.y + (to.y - from.y) * (i + 1) / count };
        formationFrame.self = formationBody(character, start);
        if (priestSecondaryClearance(end, obstacles).risk > priestSecondaryClearance(start, obstacles).risk + 0.01) return false;
      }
      return true;
    } finally { formationFrame.self = saved; }
  }
  function formationDesiredRange(reference: Value, priest: Value, selfPriest: boolean, members: Value[], step: number) {
    const character = ports.character();
    let desired=ports.desiredCombatRange();
    if(!host.is_in_range(reference))desired=Math.min(desired,Math.max(1,(Number(character.range)||1)-10));
    if(!selfPriest)return desired;
    const safeRange=safeHealingRange(priest);
    members.forEach(function(ally){
      if(formationMelee(ally) && formationDistance(ally,reference)>Number(ally.range)+3)
        desired=Math.min(desired,Math.max(1,Number(ally.range)-2+safeRange-step));
    });
    return desired;
  }
  function formationStepSafe(point: Point, reference: Value, priest: Value, selfPriest: boolean, members: Value[], safeRange: number, separate?: boolean) {
    const character = ports.character();
    if(!ports.safeCombatPoint(point,reference))return false;
    const body=formationBody(character,point);
    if(!coveredStep(body,members,priest,selfPriest,safeRange) && !(separate && maySeparate(reference,members,selfPriest)))return false;
    const obstacles=formationFrame.enemies.filter(function(e: Value){return e.id!==reference.id || !formationMelee(character);});
    return priestSecondaryClearance(point,obstacles).risk<=priestSecondaryClearance(character,obstacles).risk+0.01;
  }
  function holdFormation(reference: Value, reason: string) {
    if(ports.independentApproachOwns())return true;
    // Holding is a step of zero length: it keeps a combat pause and stops only the
    // character's own step (design section 2.4 rule 6).
    ports.movement().holdStep();
    ports.kite().destination=null;formationState.warriorSegment=null;
    host.partyCombatPosition={at:ports.now(),target:reference.id,mode:"formation-hold",movementOwner:"combat",intent:"hold",
      reason:reason,constraint:reason,distance:ports.combatDistance(reference),desiredRange:ports.desiredCombatRange()};
    return true;
  }
  function formationMove(target: Value) {
    const character = ports.character();
    ports.independentApproach().reference=target?{target:target,at:ports.now()}:null;
    if(!character.cave && host.partyQueueClient && host.partyQueueClient.independent && host.partyQueueClient.independent.movement())return true;
    if (ports.franky()) return false;
    if(!character.cave && host.partyQueueClient && host.partyQueueClient.formation && host.partyQueueClient.formation.movement())return true;
    const context = [character.map, character.in, character.rip, ports.joinedEvent(), !!eventFacts().travellingEventName()].join(":");
    if (formationState.mapContext !== context) {
      formationState.mapContext = context; formationState.approachProgress = null; formationState.recovery = null;
    }
    const started = typeof performance !== "undefined" ? performance.now() : ports.now();
    const entities = host.parent.entities || {};
    const enemies = Object.keys(entities).map(function (id) { return entities[id]; }).filter(function (e) {
      return e && e.visible && !e.dead && e.type === "monster" && (!e.map || e.map === character.map) &&
        !(host.partyRoleRunner && host.partyRoleRunner.isKnownDead(e.id)) &&
        (e.in == null || character.in == null || e.in === character.in);
    });
    formationFrame = { attackers: enemies.filter(function (e) { return e.target === character.name; }),
      enemies: enemies, motions: new Map(), self: formationBody(character) };
    try { return solveFormationMove(target); }
    finally {
      const elapsed = (typeof performance !== "undefined" ? performance.now() : ports.now()) - started;
      formationPerformance.ticks++; formationPerformance.totalMs += elapsed;
      formationPerformance.maxMs = Math.max(formationPerformance.maxMs, elapsed);
      host.partyCombatPerformance = formationPerformance;
      formationFrame = null;
    }
  }
  function solveFormationMove(target: Value) {
    const character = ports.character(), groupedCombat = ports.groupedCombat(), kiteState = ports.kite(), G = ports.G();
    const mageEscort = !ports.scatter() && character.ctype === "mage" && !!ports.leader() && (ports.leader() === character.name || ports.followLeader()) && !eventFacts().travellingEventName();
    if (!character.cave && !ports.grouped() && !mageEscort) return false;
    const members = formationMembers().filter(function (member) {
      if (!character.cave && groupedCombat && currentQueue(groupedCombat) &&
          groupedCombat.recovering.indexOf(member.name) >= 0) return false;
      return ports.sameTeam(member);
    });
    const healerName = groupedCombat && groupedCombat.priest || formationState.priest;
    const priest = members.filter(function (member) { return member.ctype === "priest"; })
      .sort(function (a, b) { return Number(b.name === healerName) - Number(a.name === healerName) ||
        String(a.name).localeCompare(String(b.name)); })[0];
    if (!priest) { formationState.priest = null; return false; }
    const selfPriest = priest.name === character.name;
    const healRange = Number(priest.range) || 0;
    if (!healRange) return false;
    const safeRange = safeHealingRange(priest);
    const attackers: Value[] = formationFrame.attackers;
    const chased = attackers.length > 0;
    const reference = target || attackers.sort(function (a, b) { return ports.combatDistance(a) - ports.combatDistance(b); })[0];
    if (!reference) return false;
    if (formationState.priest !== priest.name || formationState.targetId !== reference.id) {
      // Retire only our previous combat-owned segment before adopting a new
      // target. Every class must shed the old approach and hold state.
      ports.resetCombatMovement();
      formationState.priest = priest.name; formationState.targetId = reference.id; formationState.direction = 1;
      formationState.secondaryDirection = 0; formationState.secondaryMoving = false;
      formationState.warriorPhase = null; formationState.warriorSegment = null;
      if (formationMelee(character)) kiteState.destination = null;
    }
    const step = Math.max(1, Number(character.speed || 40) * 0.6);
    const meleeReady=formationMelee(character) && host.is_in_range(reference);
    // Step 9 rule 2: the anchor never moves because of a follower. The corner detour keeps each
    // first leg inside the priest's coverage, so a non-priest anchor takes none, and its
    // followers come to it.
    const anchorSelf = !selfPriest && !!groupedCombat &&
      !!groupedCombat.anchor && groupedCombat.anchor.name === character.name;
    const recoveryCandidate = meleeReady || anchorSelf ? false : recoverFormationCorner(reference, priest, selfPriest, members, step);
    // A stalled healer can fence in the warrior even when its own straight line is clear.
    // Recovery must respond to the party's inability to engage, not only a wall hit.
    // RF6 shared.js:16806,:16812: the approach and the melee gap stall by the walking try
    // (`stepStalled`) of the character that walks them.
    const movement=ports.movement();
    const stalled=formationState.approachProgress && stepStalled(character.moving,formationState.approachProgress.at,ports.now(),movement);
    const fighter=members.find(function(m){return formationMelee(m);});
    const meleeGap=fighter ? Math.max(0,formationDistance(fighter,reference)-Number(fighter.range)) : 0;
    let meleeProgress=formationState.meleeProgress;
    if(!meleeProgress || meleeProgress.target!==reference.id || meleeGap<meleeProgress.gap-8)
      meleeProgress=formationState.meleeProgress={target:reference.id,gap:meleeGap,at:ports.now()};
    const fighterLive=fighter && (fighter.name===character.name ? character : host.get_player(fighter.name));
    const needsMelee=meleeGap>3 && stepStalled(fighterLive && fighterLive.moving,meleeProgress.at,ports.now(),movement);
    if(selfPriest && stalled && needsMelee && !(recoveryCandidate && recoveryCandidate.blocked) && host.partyQueueClient && host.partyQueueClient.formation && terrainRecoveryContext().allowed) {
      proposeTerrainRecovery(reference,formationDesiredRange(reference,priest,selfPriest,members,step));
    }

    const desired = formationDesiredRange(reference, priest, selfPriest, members, step);
    let rangeReference=reference;
    if(!host.is_in_range(reference)) {
      const intercept=ports.interceptCenter(reference,desired);
      rangeReference=ports.rangeReference(reference,intercept);
    }
    const warrior = formationMelee(character);
    const mage = character.ctype === "mage";
    const priestSpacing = 25;
    const warriorPhaseBefore = formationState.warriorPhase;
    if (warrior) {
      if (!host.is_in_range(reference))
        formationState.warriorPhase = "approaching";
      if (host.is_in_range(reference)) formationState.warriorPhase = "melee-kiting";
    }
    const closing = warrior && formationState.warriorPhase === "approaching";
    const secondary: Value[] = selfPriest || mage ? formationFrame.enemies.filter(function (enemy: Value) {
      if (enemy.id === reference.id) return false;
      // Keep every enemy capable of entering the swept safety area, with a
      // nearby clearance preference zone. Distant mobs must
      // not make an otherwise settled formation orbit forever.
      const motion = formationMotion(enemy);
      formationFrame.motions.set(enemy, motion);
      return formationDistance(character, enemy) <= Math.max(160,
        motion.safety + step + (Number(enemy.speed) || 0) * 0.6 + 40);
    }) : [];
    const avoiding = secondary.length > 0;
    const heldClearance: Value = avoiding ? priestSecondaryClearance(character, secondary) : null;
    const px = character.x - priest.x, py = character.y - priest.y, plen = Math.hypot(px, py) || 1;
    const tangent = selfPriest ? { x: character.x - reference.x, y: character.y - reference.y }
      : { x: -py / plen * formationState.direction, y: px / plen * formationState.direction };
    const tlen = Math.hypot(tangent.x, tangent.y) || 1; tangent.x /= tlen; tangent.y /= tlen;
    function metrics(point: Point): Value {
      const candidate = formationBody(character, point);
      const coverage = selfPriest ? members.reduce(function (worst, ally) {
        return ally.name === character.name ? worst : Math.max(worst, formationDistance(candidate, ally) - safeRange);
      }, 0) : Math.max(0, formationDistance(candidate, priest) - safeRange);
      const danger = attackers.reduce(function (sum, enemy) {
        // A melee warrior must enter the selected enemy's attack radius to
        // fight it. Other attackers retain their full avoidance priority.
        if (warrior && enemy.id === reference.id) return sum;
        const definition = G.monsters && G.monsters[enemy.mtype] || {};
        const limit = Number(enemy.range || definition.range) || DEFAULT_MONSTER_RANGE;
        // Immediate danger means moving deeper into an existing attack zone.
        const before = Math.max(0, limit + 4 - formationDistance(character, enemy));
        return sum + Math.max(0, limit + 4 - formationDistance(candidate, enemy) - before);
      }, 0);
      const rangeError = Math.abs(formationDistance(candidate, rangeReference) - desired);
      const towardPriestX = priest.x - reference.x, towardPriestY = priest.y - reference.y;
      const facing = !selfPriest && ((point.x - reference.x) * towardPriestX +
        (point.y - reference.y) * towardPriestY < 0) ? 1 : 0;
      const dx = point.x - character.x, dy = point.y - character.y;
      const progress = dx * tangent.x + dy * tangent.y;
      const heading = Math.atan2(dy, dx);
      const turn = formationState.heading == null ? 0 : 1 - Math.cos(heading - formationState.heading);
      const clearance = avoiding ? priestSecondaryClearance(point, secondary) : null;
      const secondaryRisk = clearance ? clearance.risk : 0;
      // The selected target's swept safety radius must not keep the mage
      // permanently outside its own range. Retain that spacing preference
      // after attack-range admission; other enemies still outrank admission.
      const targetRisk = mage ? priestSecondaryClearance(point, [reference]).risk : 0;
      const orbitCross = (character.x - reference.x) * (point.y - character.y) -
        (character.y - reference.y) * (point.x - character.x);
      return { point: point, coverage: coverage, danger: danger, rangeError: rangeError,
        clearance: clearance, direction: Math.abs(orbitCross) < 0.01 ? 0 : Math.sign(orbitCross),
        facing: facing, progress: progress, heading: heading, turn: turn,
        score: mage ? [Math.round((danger + secondaryRisk) * 2), Math.ceil(coverage / 2), facing,
          Math.ceil(Math.max(0, formationDistance(candidate, rangeReference) - Number(character.range)) / 3),
          Math.round(targetRisk * 2),
          Math.ceil(Math.max(0, formationDistance(candidate, priest) - priestSpacing) / 3),
          chased ? -progress : Math.hypot(dx, dy), rangeError, turn] :
          [Math.round((danger + secondaryRisk) * 2), Math.ceil(coverage / 2),
          closing ? rangeError : facing,
          closing ? facing : Math.floor(Math.max(0, rangeError - 3) / 3),
          clearance ? -clearance.minimum : 0, clearance ? -clearance.end : 0,
          chased ? -progress : Math.hypot(dx, dy),
          selfPriest ? 0 : -formationDistance(candidate, priest), turn] };
    }
    const current = metrics(character);
    if(recoveryCandidate && !recoveryCandidate.blocked && formationStepSafe(recoveryCandidate,reference,priest,selfPriest,members,safeRange,true)) {
      ports.sendCombatMove(reference,recoveryCandidate,"formation-regrouping");
      host.partyCombatPosition.reason="local detour around blocked approach";
      host.partyCombatPosition.coverageDeficit=metrics(recoveryCandidate).coverage;
      return true;
    }
    if(recoveryCandidate && !recoveryCandidate.blocked && !chased &&
        host.partyQueueClient && host.partyQueueClient.formation && terrainRecoveryContext().allowed) {
      const terrainGoal=ports.combatApproachPoint(reference,desired);
      if(!host.can_move_to(terrainGoal.x,terrainGoal.y)) {
        holdFormation(reference,"terrain detour requires temporary separation");
        host.partyCombatPosition.constraint="terrain-blocked approach";
        proposeTerrainRecovery(reference,desired);
        return true;
      }
    }
    if(recoveryCandidate && recoveryCandidate.blocked && !chased) {
      if(mageEscort && eventApproach(reference,desired))return true;
      holdFormation(reference,"no safe local detour; waiting for an opening");
      host.partyCombatPosition.mode="formation-blocked";
      host.partyCombatPosition.constraint=recoveryCandidate.reason;
      if(!recoveryCandidate.planning)proposeTerrainRecovery(reference,desired);
      return true;
    }

    let warriorMoveReason = "new segment";
    if (warrior) {
      const segment = formationState.warriorSegment;
      const held = segment && metrics(segment.point);
      const remaining = segment ? Math.hypot(character.x - segment.point.x, character.y - segment.point.y) : 0;
      const safeHeld = held && formationStepSafe(segment.point, reference, priest, selfPriest, members, safeRange) && held.danger <= 0 &&
        held.coverage <= current.coverage && !held.facing;
      const usefulHeld = held && (closing ? held.rangeError < current.rangeError - 0.5 : held.rangeError <= 5);
      warriorMoveReason = !segment ? "new target or formation" : !safeHeld ? "segment became unsafe" :
        warriorPhaseBefore !== formationState.warriorPhase ? "melee state changed" :
        !usefulHeld ? "target moved" : remaining <= Number(character.speed) * 0.15 ? "segment nearly complete" : "segment refresh";
      if (segment && character.moving && safeHeld && usefulHeld &&
          warriorPhaseBefore === formationState.warriorPhase && ports.now() - segment.sentAt < ports.movement().roundTrip() &&
          remaining > Number(character.speed) * 0.15) {
        host.partyCombatPosition = Object.assign({}, host.partyCombatPosition, {
          at: ports.now(), distance: ports.combatDistance(reference), warriorPhase: formationState.warriorPhase,
          healingDistance: formationDistance(character, priest), movementReason: "retaining safe segment" });
        return true;
      }
    }
    if (((!avoiding && !mage && current.rangeError <= 3 && (!warrior || meleeReady)) ||
        (mage && formationDistance(character, priest) <= priestSpacing && ports.combatDistance(reference) <= Number(character.range) &&
          (!heldClearance || heldClearance.risk === 0))) && !chased && current.coverage <= 0 && !current.facing) {
      holdFormation(reference,"settled in formation");
      kiteState.targetId = null;
      // holdFormation above already stopped the own step.
      if (warrior && formationState.warriorSegment) formationState.warriorSegment = null;
      host.partyCombatPosition = { at: ports.now(), mode: "formation-hold", movementOwner: "combat",
        priest: priest.name, healingDistance: selfPriest ? 0 : formationDistance(character, priest),
        healingRange: safeRange, target: reference.id, desiredRange: desired, distance: ports.combatDistance(reference) };
      return true;
    }
    const points: Point[] = [];
    if (avoiding || warrior && chased && !closing) {
      const radial = Math.hypot(character.x - reference.x, character.y - reference.y);
      const ring = desired + Math.max(0, radial - ports.combatDistance(reference));
      const bearing = Math.atan2(character.y - reference.y, character.x - reference.x);
      [1, -1].forEach(function (sign) {
        const turn = Math.min(0.5, step / Math.max(1, ring));
        const destination = { x: reference.x + ring * Math.cos(bearing + sign * turn),
          y: reference.y + ring * Math.sin(bearing + sign * turn) };
        const length = Math.hypot(destination.x - character.x, destination.y - character.y);
        const fraction = Math.min(1, step / Math.max(1, length));
        points.push({ x: character.x + (destination.x - character.x) * fraction,
          y: character.y + (destination.y - character.y) * fraction });
      });
    }
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI / 16;
      points.push({ x: character.x + Math.cos(angle) * step, y: character.y + Math.sin(angle) * step });
      points.push({ x: character.x + Math.cos(angle) * step * 0.5, y: character.y + Math.sin(angle) * step * 0.5 });
    }
    // Include exact range corrections, so stationary formations don't oscillate
    // between fixed-size steps on either side of the desired radius.
    const ideal = ports.combatApproachPoint(reference, desired), dx = ideal.x - character.x, dy = ideal.y - character.y;
    const len = Math.hypot(dx, dy);
    if (len > 0.5 && (closing || !chased || len > Number(character.speed) * 0.2))
      points.push({ x: character.x + dx * Math.min(1, step / len), y: character.y + dy * Math.min(1, step / len) });
    if (mage) {
      const priestDistance = Math.hypot(character.x - priest.x, character.y - priest.y);
      const approach = Math.min(step, Math.max(0, priestDistance - priestSpacing));
      if (approach > 0) points.push({ x: character.x + (priest.x - character.x) / priestDistance * approach,
        y: character.y + (priest.y - character.y) / priestDistance * approach });
    }
    formationPerformance.candidates += points.length;
    const candidates = points.map(metrics);
    const collisionSafe = function (candidate: Value) {
      if (candidate.safe === undefined) candidate.safe = formationStepSafe(candidate.point, reference, priest, selfPriest, members, safeRange) &&
        (!mage || !candidate.clearance || candidate.clearance.risk <= heldClearance.risk + 0.01);
      return candidate.safe;
    };
    candidates.sort(function (a, b) {
      for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
      return 0;
    });
    let best = candidates.find(collisionSafe);
    // R4 `formation.routine`: the formation entry this character picked answers for it. Its point
    // still passes the solver's collision check, else the solver's best runs; a hold holds here.
    const pick = ports.movement().routinePick(character.name, 'formation');
    const routine = pick === undefined ? undefined : partyHooks().movement.formationRoutine(pick, { character: character.name, ctype: character.ctype,
      target: reference.id, healer: priest.name, desiredRange: desired, mode: ports.scatter() ? 'scatter' : 'grouped',
      members: members.map(function (m: Value) { return { name: m.name, ctype: m.ctype, x: m.x, y: m.y }; }),
      candidates: candidates.map(function (c: Value) { return { x: c.point.x, y: c.point.y, danger: c.danger, coverage: c.coverage, rangeError: c.rangeError,
        ...(c.clearance ? { clearance: c.clearance.risk } : {}) }; }) });
    if (routine && 'hold' in routine) return holdFormation(reference, "held by the " + pick + " formation");
    const named = routine && metrics(routine);
    if (named && collisionSafe(named)) best = named;
    if (!best) {
      holdFormation(reference,"no safe formation step");
      // holdFormation above already stopped the own step.
      if (warrior && formationState.warriorSegment) formationState.warriorSegment = null;
      host.partyCombatPosition = { at: ports.now(), mode: "formation-blocked", priest: priest.name,
        movementOwner: "combat", target: reference.id, constraint: "no collision-safe segment" };
      if (avoiding) Object.assign(host.partyCombatPosition, { nearestOtherMonster: heldClearance.nearest,
        secondaryClearance: heldClearance.current, predictedSecondaryClearance: heldClearance.minimum,
        avoidanceDirection: formationState.secondaryDirection || 0, avoidanceReason: "both arcs blocked" });
      return true;
    }
    if(closing && !attackers.some(function(e){return e.id!==reference.id;}) && best.rangeError>=current.rangeError-0.5 && best.coverage>=current.coverage-0.5 && best.danger>=current.danger) {
      holdFormation(reference,"waiting for healing coverage or a clear melee approach");
      host.partyCombatPosition.constraint="melee approach constrained";
      return true;
    }
    if(!chased && (!avoiding || mage)) {
      const improvement=best.danger<current.danger-0.5 || best.coverage<current.coverage-0.5 ||
        best.rangeError<current.rangeError-0.5 || mage && formationDistance(formationBody(character,best.point),priest)<formationDistance(character,priest)-0.5 ||
        best.clearance && (best.clearance.risk<current.clearance.risk-0.01 || best.clearance.minimum>current.clearance.minimum+5);
      if(!improvement)return holdFormation(reference,"no meaningful safe improvement");
    }
    if (warrior && chased && !closing) {
      // Retain our arc direction whenever it meets the same safety, healing,
      // facing and attack-range constraints as the best alternative.
      const sameDirection = candidates.find(function (candidate) {
        return candidate.progress > 1 && collisionSafe(candidate) && candidate.score.slice(0, 4).every(function (value: number, i: number) {
          return value <= best.score[i];
        });
      });
      if (sameDirection) best = sameDirection;
    }
    if (avoiding && !mage) {
      const advantage = function (a: Value, b: Value) {
        return Math.max(a.clearance.minimum - b.clearance.minimum, a.clearance.end - b.clearance.end);
      };
      const preferred = candidates.find(function (candidate) {
        return candidate.direction === formationState.secondaryDirection && collisionSafe(candidate) &&
          candidate.score.slice(0, 4).every(function (value: number, i: number) { return value === best.score[i]; });
      });
      let reason = "increasing secondary clearance";
      if (preferred && advantage(best, preferred) < 5) { best = preferred; reason = "retaining arc direction"; }
      const preventsEncroachment = heldClearance.minimum < heldClearance.current - 0.5 &&
        best.clearance.minimum >= heldClearance.current - 0.5;
      if (!chased && current.coverage <= 0 && current.rangeError <= 3 && best.score[0] >= current.score[0] &&
          (best.score[0] > current.score[0] || best.score[1] > current.score[1] || best.rangeError > 3 ||
           !preventsEncroachment && advantage(best, current) < 5)) {
        kiteState.targetId = null;
        // Retire an obsolete direct destination when holding is now equally safe.
        holdFormation(reference,"no meaningful safe improvement");
        formationState.secondaryMoving = false;
        host.partyCombatPosition = { at: ports.now(), mode: "formation-hold", movementOwner: "combat",
          priest: priest.name, target: reference.id, desiredRange: desired, distance: ports.combatDistance(reference),
          nearestOtherMonster: heldClearance.nearest, secondaryClearance: heldClearance.current,
          predictedSecondaryClearance: heldClearance.minimum, avoidanceReason: "no meaningful safe improvement",
          avoidanceDirection: formationState.secondaryDirection || 0 };
        return true;
      }
      if (formationState.secondaryDirection && best.direction && best.direction !== formationState.secondaryDirection)
        reason = preferred ? "reversing for safer clearance" : "reversing around blocked or infeasible arc";
      if (best.direction) formationState.secondaryDirection = best.direction;
      formationState.secondaryMoving = true;
      formationState.avoidanceDetail = { nearestOtherMonster: heldClearance.nearest,
        secondaryClearance: heldClearance.current, predictedSecondaryClearance: best.clearance.minimum,
        endpointSecondaryClearance: best.clearance.end, avoidanceDirection: best.direction,
        avoidanceReason: reason };
    }
    if (!selfPriest && chased && !closing && best.progress < -1) {
      formationState.direction *= -1;
      if (warrior) warriorMoveReason = "reversing for formation safety or range";
    }
    formationState.heading = best.heading;
    kiteState.targetId = chased ? attackers[0].id : null;
    ports.sendCombatMove(reference, best.point, closing ? "formation-approaching" : chased ? "formation-kiting" : "formation-positioning");
    if (warrior) {
      formationState.warriorSegment = { point: best.point, sentAt: ports.now() };
      host.partyCombatPosition.warriorPhase = formationState.warriorPhase;
      host.partyCombatPosition.movementReason = warriorMoveReason;
    }
    const selection = ports.leaderSelection();
    host.partyCombatPosition = Object.assign({}, host.partyCombatPosition, avoiding ? formationState.avoidanceDetail : {}, { priest: priest.name,
      healingDistance: selfPriest ? 0 : formationDistance(character, priest), healingRange: safeRange, coverageDeficit:best.coverage,
      targetRevision: selection && selection.revision,
      constraint: best.danger > 0 ? "immediate danger" : best.clearance && best.clearance.risk > 0 ? "monster avoidance" : best.coverage > 0 ? "recovering healing coverage" :
        best.rangeError > 3 ? "weapon range sacrificed" : null });
    return true;
  }
  // One spread step away from party members standing on this character, in a direction its name
  // fixes; the first name in order stays.
  async function separateFromParty(minimumDistance?: number) {
    const character = ports.character();
    const distance = minimumDistance || 16;
    if (ports.bagErrand() || ports.departurePending() || ports.convoyActive() || walk.groupWalk.travel ||
        ports.following() || character.moving || ports.now() - lastSeparationAt < separationMs) return false;
    const overlapping = ports.partyPositions().filter(function (member) {
      if (!member || member.name === character.name || member.map !== character.map) return false;
      const dx = member.x - character.x;
      const dy = member.y - character.y;
      return Math.sqrt(dx * dx + dy * dy) < distance;
    });
    if (!overlapping.length) return false;
    const names = overlapping.map(function (member) { return member.name; }).concat(character.name).sort();
    const position = names.indexOf(character.name);
    if (position === 0) return false;
    let hash = 0;
    for (let i = 0; i < character.name.length; i += 1)
      hash = (hash * 31 + character.name.charCodeAt(i)) >>> 0;
    const angle = hash % 360 * Math.PI / 180;
    const step = distance + 10 + position * 4;
    const spread = { x: character.x + Math.cos(angle) * step, y: character.y + Math.sin(angle) * step };
    lastSeparationAt = ports.now(); separationMs = stepWindowMs(character, spread, character.speed);
    await ports.movement().step(spread, "spread").sent;
    return true;
  }
  function defensiveFormationMove() {
    if (!ports.grouped()) return false;
    const character = ports.character(), entities = host.parent.entities || {};
    const threat = Object.keys(entities).map(function (id) { return entities[id]; })
      .filter(function (enemy) { return enemy && enemy.visible && !enemy.dead && enemy.type === "monster" &&
        (!enemy.map || enemy.map === character.map) && (enemy.in == null || character.in == null || enemy.in === character.in) &&
        enemy.target === character.name; }).sort(function (a, b) { return ports.combatDistance(a) - ports.combatDistance(b); })[0];
    if (!threat) return false;
    // No attack target: only evade an attacker that can reach us shortly.
    const G = ports.G(), definition = G.monsters && G.monsters[threat.mtype] || {};
    if (ports.combatDistance(threat) > (Number(threat.range || definition.range) || DEFAULT_MONSTER_RANGE) +
        (Number(threat.speed) || 0) * 0.6 + 20) return false;
    ports.kiteIfNeeded(threat).catch(function (error: unknown) {
      ports.logEvent('navigation', 'Defensive kite rejected: ' + movementError(error).message, { threat: threat.id }, 'formation-kite:' + threat.id);
    });
    if (host.partyCombatPosition) host.partyCombatPosition.reason = "defending against " + threat.id;
    return true;
  }
  // A persistent same-map combat route. Each issued step still passes the
  // formation safety and healing gates; ordinary positioning cannot fight it.
  function recoverFormationCorner(reference: Value, priest: Value, selfPriest: boolean, members: Value[], step: number): Value {
    const character = ports.character();
    const approachRange = formationDesiredRange(reference, priest, selfPriest, members, step);
    let goal: Point = ports.combatApproachPoint(reference, approachRange);
    const regroupPriest = !selfPriest && character.ctype === "mage" && formationDistance(character, priest) > Number(priest.range) * 0.9;
    if (regroupPriest) goal = priest;
    const obstacles = formationFrame.enemies.filter(function (e: Value) { return e.id !== reference.id || !formationMelee(character); });
    let regroupGoals: Point[] = [];
    if (regroupPriest) {
      // An attacked priest can stand inside the selected monster's safety
      // radius. Regroup into healing coverage, not onto that unsafe center.
      const healingCoverage = safeHealingRange(priest);
      const regroupReach = Math.min(Number(character.range) - 3,
        Math.max(approachRange, formationMonsterSafety(reference) + 12));
      for (let regroupSide = 0; regroupSide < 16; regroupSide++) {
        const regroupPoint = terrainRecoveryPoint(reference, regroupReach, regroupSide * Math.PI / 8);
        if (!regroupPoint || formationDistance(formationBody(character, regroupPoint), priest) > healingCoverage ||
            !host.can_move({ map: character.map, x: regroupPoint.x, y: regroupPoint.y,
              going_x: regroupPoint.x, going_y: regroupPoint.y, base: character.base }) ||
            obstacles.some(function (enemy: Value) { return formationDistance(formationBody(character, regroupPoint), enemy) <= formationMonsterSafety(enemy); })) continue;
        regroupGoals.push(regroupPoint);
      }
      regroupGoals.sort(function (a, b) { return Math.hypot(a.x-character.x,a.y-character.y)-Math.hypot(b.x-character.x,b.y-character.y); });
      regroupGoals = regroupGoals.slice(0, 4);
      if (regroupGoals.length) goal = regroupGoals[0];
    }
    const identity = [reference.id, priest.name, character.map, character.in, ports.joinedEvent(), !!eventFacts().travellingEventName()].join(":");
    if (formationState.approachIdentity !== identity) {
      formationState.approachIdentity = identity; formationState.approachProgress = null; formationState.recovery = null;
    }
    const gap = Math.hypot(goal.x - character.x, goal.y - character.y), now = ports.now();
    let tracking = formationState.approachProgress;
    if (!tracking || tracking.target !== reference.id || gap < tracking.gap - 8) {
      tracking = formationState.approachProgress = { target: reference.id, gap: gap, at: now };
    }
    if (gap < 12) { formationState.recovery = null; return false; }
    // RF6 shared.js:16322: the corner detour starts once the approach's walking try stalls.
    if (!stepStalled(character.moving, tracking.at, now, ports.movement()) && !formationState.recovery && host.can_move_to(goal.x,goal.y)) return false;
    let recovery = formationState.recovery;
    const goalAnchor = regroupPriest ? priest : reference;
    if (!recovery || !recovery.targetPoint || recovery.target !== reference.id || recovery.regroupPriest !== regroupPriest ||
        Math.hypot(recovery.targetPoint.x-goalAnchor.x,recovery.targetPoint.y-goalAnchor.y)>12 ||
        regroupPriest && (!recovery.referencePoint || Math.hypot(recovery.referencePoint.x-reference.x,recovery.referencePoint.y-reference.y)>12) ||
        Math.abs(recovery.reach-approachRange)>8) {
      recovery = formationState.recovery = { target: reference.id, targetPoint: {x:goalAnchor.x,y:goalAnchor.y},
        referencePoint: {x:reference.x,y:reference.y},
        reach:approachRange,regroupPriest:regroupPriest,goal: { x: goal.x, y: goal.y }, point: null };
    }
    if (recovery.point && (Math.hypot(recovery.point.x - character.x, recovery.point.y - character.y) < 8 ||
        !host.can_move_to(recovery.point.x, recovery.point.y) || !formationSegmentSafe(character, recovery.point, obstacles))) recovery.point = null;
    // RF6 class B: a corner search that found no point searches again on the next movement tick.
    if (!recovery.point && !recovery.multi) {
      let goals: Point[] = [recovery.goal], best = Infinity;
      if (Math.hypot(recovery.goal.x-goal.x,recovery.goal.y-goal.y)>1) goals.push(goal);
      if (regroupPriest) goals = goals.concat(regroupGoals);
      if (!regroupPriest && !host.can_move_to(goal.x, goal.y)) {
        const sides: Point[] = [];
        for (let side = 0; side < 16; side++) {
          const radians = side * Math.PI / 8;
          const open = terrainRecoveryPoint(reference, approachRange, radians);
          if (!open) continue;
          if (host.can_move({ map: character.map, x: open.x, y: open.y,
              going_x: open.x, going_y: open.y, base: character.base })) sides.push(open);
        }
        sides.sort(function (a, b) { return Math.hypot(a.x-character.x,a.y-character.y)-Math.hypot(b.x-character.x,b.y-character.y); });
        goals = goals.concat(sides.slice(0, 4));
      }
      for (let goalIndex = 0; goalIndex < goals.length; goalIndex++) {
        const approach = goals[goalIndex];
        const distance = Math.hypot(approach.x-character.x,approach.y-character.y);
        if (distance < best && host.can_move_to(approach.x,approach.y) && formationSegmentSafe(character,approach,obstacles)) {
          recovery.point = { x: approach.x, y: approach.y }; recovery.goal = approach; best = distance;
        }
        for (let ring = 0; ring < 4; ring++) for (let angle = 0; angle < 16; angle++) {
          const radius = 80 * Math.pow(2, ring), radians = angle * Math.PI / 8;
          const point = { x: character.x + Math.cos(radians) * radius, y: character.y + Math.sin(radians) * radius };
          const score = radius + Math.hypot(approach.x - point.x, approach.y - point.y);
          if (score >= best || !host.can_move_to(point.x, point.y) || !host.can_move({ map: character.map, x: point.x, y: point.y,
              going_x: approach.x, going_y: approach.y, base: character.base }) ||
              !formationSegmentSafe(character, point, obstacles) || !formationSegmentSafe(point, approach, obstacles)) continue;
          recovery.point = point; recovery.goal = approach; best = score;
        }
        // Once selected, keep the same open side while it still has a safe
        // two-leg route. Reconsider alternatives only when that route fails.
        if (goalIndex === 0 && recovery.selected && recovery.point) break;
      }
      if (recovery.point) recovery.selected = true;
    }
    const routeClient=host.partyQueueClient && host.partyQueueClient.formation;
    if ((!recovery.point || recovery.multi) && routeClient && routeClient.approachPoint) {
      recovery.multi=true;
      let goals: Point[]=regroupPriest ? regroupGoals.slice() : [];
      if(!regroupPriest){
        // The preferred range circle can lie entirely inside walls or on the
        // far side of a narrow corridor. Consider nearer legal attack positions
        // too, while preserving the selected monster's clearance for casters.
        const minimum=Math.min(approachRange,formationMonsterSafety(reference)+12);
        let reaches=[approachRange,(approachRange+minimum)/2,minimum];
        reaches= reaches.filter(function(reach,index){return index===0 || Math.abs(reach-reaches[index-1])>1;});
        reaches.forEach(function(reach){for(let side=0;side<16;side++){
          const candidate=terrainRecoveryPoint(reference,reach,side*Math.PI/8);
          if(candidate)goals.push(candidate);
        }});
      }
      goals.unshift(goal);
      goals=goals.filter(function(point){return host.can_move({map:character.map,x:point.x,y:point.y,going_x:point.x,going_y:point.y,base:character.base}) && formationSegmentSafe(point,point,obstacles);});
      const coverageRange=safeHealingRange(priest), separates=maySeparate(reference,members,selfPriest);
      recovery.point=routeClient.approachPoint(identity+JSON.stringify([recovery.targetPoint,recovery.referencePoint,recovery.reach]),character,goals,function(from: Point,to: Point){
        // Admit live segments within the next-step coverage envelope. Future
        // nodes can exceed today's envelope because the healer moves too.
        if (Math.hypot(from.x-character.x,from.y-character.y)<6 && !separates &&
          !coveredStep(formationBody(character,to),members,priest,selfPriest,coverageRange)) return false;
        return host.can_move({map:character.map,x:from.x,y:from.y,going_x:to.x,going_y:to.y,base:character.base}) && formationSegmentSafe(from,to,obstacles);
      }) || null;
      if (routeClient.approachStatus() === 'arrived') { formationState.recovery = null; return false; }
    }
    if (recovery.point) {
      const dx = recovery.point.x - character.x, dy = recovery.point.y - character.y;
      const fraction = Math.min(1, step / Math.hypot(dx, dy));
      const next = { x: character.x + dx * fraction, y: character.y + dy * fraction };
      const held = priestSecondaryClearance(character, obstacles), moving = priestSecondaryClearance(next, obstacles);
      if (moving.risk <= held.risk && ports.safeCombatPoint(next, reference)) {
        return next;
      }
    }
    // Keep immediate defensive movement available, but don't oscillate merely
    // because the straight-line range objective is unreachable around a wall.
    const planning=routeClient && routeClient.approachStatus && routeClient.approachStatus()==='planning';
    if (formationFrame.attackers.length && !planning) return false;
    return {blocked:true,planning:planning,reason:host.can_move_to(goal.x, goal.y) ? "monster-blocked approach" : "terrain-blocked approach"};
  }
  // A24: a mage escort in a joined event whose formation approach is blocked takes the
  // event's own approach (events/character/combat.ts frankyTick) instead of holding
  // out of range, since terrainRecoveryContext refuses the route while an event runs. Only terrain
  // stops its step; when the event fights its adds the step takes the full check, so an add in
  // the way holds the mage while the party fights it.
  function eventApproach(reference: Value, desired: number | null): boolean {
    const character = ports.character(), joined = ports.joinedEvent();
    if (!joined) return false;
    const destination = ports.combatApproachPoint(reference, desired), adds = eventFacts().fightsAdds(String(joined));
    const step = Math.min(Math.hypot(destination.x - character.x, destination.y - character.y), stepLength(character.speed, 'approach'));
    for (const point of approachFan(character, destination, step)) {
      if (!host.can_move_to(point.x, point.y) || adds && !ports.safeCombatPoint(point, reference)) continue;
      ports.sendCombatMove(reference, point, "formation-approaching");
      host.partyCombatPosition.reason = "event approach around a blocked formation";
      return true;
    }
    return false;
  }
  function terrainRecoveryContext() {
    const g=ports.groupedCombat(),t=g && g.target,character=ports.character();
    return {key:g && g.key,target:t && JSON.stringify([t.server,t.map,t.in,t.id]),
      covered:!!(g && g.anchor && Math.hypot(character.x-g.anchor.x,character.y-g.anchor.y)<=Math.max(10,g.range-10)),
      allowed:!!(!ports.dungeonOwned() && t && t.state==='planned' && ports.grouped() && ports.fresh() && !ports.intent().cancelled && !character.rip &&
        t.map===character.map && t.in===character.in && t.server===ports.realm() && !ports.unfinishedFight() &&
        (!ports.convoyActive() || !!host.__partyFarmingEngagement) && !walk.groupWalk.travel && !walk.travelCombatActive() && !eventFacts().travellingEventName() && !ports.joinedEvent() && !ports.activeEvent() &&
        !occupied() && !ports.recoveryHolds() && !walk.currentTravelAttackers().length &&
        !(host.partyLootClient && host.partyLootClient.huntPending()))};
  }
  // Native route segments are additionally gated by live party healing coverage.
  function terrainRecoverySafe(point: Point | null, endpointOnly?: boolean, from?: Point) {
    if(!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))return false;
    const character=ports.character();
    const origin=from || (endpointOnly ? point : character);
    if(!host.can_move({map:character.map,x:origin.x,y:origin.y,going_x:point.x,going_y:point.y,base:character.base}))return false;
    const dx=point.x-origin.x,dy=point.y-origin.y,length=dx*dx+dy*dy;
    return Object.values(host.parent.entities || {}).every(function(e){
      if(!e || e.type!=='monster' || !e.visible || e.dead || e.hp===0 || e.map && e.map!==character.map || e.in!=null && e.in!==character.in)return true;
      const fraction=length ? Math.max(0,Math.min(1,((e.x-origin.x)*dx+(e.y-origin.y)*dy)/length)) : 0;
      const closest={x:origin.x+dx*fraction,y:origin.y+dy*fraction};
      const safety=formationMonsterSafety(e);
      const clearance=formationDistance(formationBody(character,closest),formationBody(e));
      if(endpointOnly)return clearance>safety;
      const before=formationDistance(formationBody(character,origin),formationBody(e));
      return clearance>=Math.min(before,safety)-0.01;
    });
  }
  function terrainRecoveryPoint(reference: Value, reach: number, angle: number) {
    const character=ports.character();
    const target=formationBody(reference),self=formationBody(character),dx=Math.cos(angle),dy=Math.sin(angle);
    if(![target.x,target.y,reach,angle].every(Number.isFinite) || reach<0)return null;
    // Reach and safety are native box-to-box gaps, not center radii. Native
    // distance also accounts for the asymmetric height above each entity's feet.
    let low=0,high=Math.max(1,reach+target.awidth+target.aheight+self.awidth+self.aheight);
    function gap(radius: number) {
      return formationDistance(formationBody(character,{x:target.x+dx*radius,y:target.y+dy*radius}),target);
    }
    let outerGap=gap(high);
    for(let expansion=0;expansion<8 && Number.isFinite(outerGap) && outerGap<reach;expansion++) {
      high*=2;outerGap=gap(high);
    }
    if(!Number.isFinite(outerGap) || outerGap<reach)return null;
    for(let step=0;step<24;step++) {
      const middle=(low+high)/2;
      const middleGap=gap(middle);
      if(!Number.isFinite(middleGap))return null;
      if(middleGap<reach)low=middle;else high=middle;
    }
    return {x:target.x+dx*high,y:target.y+dy*high};
  }
  function terrainRecoveryGoals(reference: Value, desired: number) {
    const goals: Point[]=[];
    if(!reference)return goals;
    const character=ports.character();
    // Coordinator encounter reports omit renderer hitboxes. Prefer the matching
    // visible native entity so edge-distance goals use the actual monster body.
    const local=reference.id!=null && host.get_entity(reference.id);
    if(local && local.visible && !local.dead && local.hp!==0 &&
        (!local.map || local.map===character.map) && (local.in==null || local.in===character.in))reference=local;
    const reach=Number(character.range),radius=Math.min(reach-1,Math.max(desired,formationMonsterSafety(reference)+12));
    if(!Number.isFinite(radius) || radius<0)return goals;
    for(let i=0;i<16;i++) {
      const p=terrainRecoveryPoint(reference,radius,i*Math.PI/8);
      if(p && terrainRecoverySafe(p,true))goals.push(p);
    }
    goals.sort(function(a,b){return Math.hypot(a.x-character.x,a.y-character.y)-Math.hypot(b.x-character.x,b.y-character.y);});
    return goals;
  }
  function proposeTerrainRecovery(reference: Value, desired: number) {
    const client=host.partyQueueClient && host.partyQueueClient.formation;
    if(!client || !terrainRecoveryContext().allowed)return;
    const goals=terrainRecoveryGoals(reference,desired);
    client.propose(terrainRecoveryContext().target,goals);
    host.partyCombatPosition.recoveryGoals=goals.length;
  }
  function terrainCoverageStep(point: Point) {
    const members=formationMembers(),priest=members.find(function(m){return m.ctype==='priest';}),character=ports.character();
    if(!priest)return false;
    return coveredStep(formationBody(character,point),members,priest,priest.name===character.name,safeHealingRange(priest));
  }
  function terrainApproachReady() {
    const g=ports.groupedCombat(),t=g && g.target,character=ports.character();
    if(!t || !ports.fresh() || !ports.covered())return false;
    const local=host.get_entity(t.id),seen=local && local.visible && !local.dead;
    if(!seen && !(g.observers||[]).some(function(o: Value){return o.server===ports.realm() && o.map===character.map && o.in===character.in && ports.movement().fresh(o.seenAt,ports.now()+ports.clockOffset());}))return false;
    const reference=seen?local:t;
    if(seen && host.is_in_range(reference))return true;
    const members=formationMembers(),priest=members.find(function(m){return m.ctype==='priest';});
    if(!priest)return false;
    const desired=formationDesiredRange(reference,priest,priest.name===character.name,members,Number(character.speed||40)*0.6);
    const goal=ports.combatApproachPoint(reference,desired);
    return host.can_move_to(goal.x,goal.y) && formationRecoverySafePoint(goal);
  }
  function terrainRecoveryFollowerTerminal(point: Point, goal: Point) {
    const members=formationMembers(),g=ports.groupedCombat(),r=g && g.formationRecovery,character=ports.character();
    const mover=r && members.find(function(m){return m.name===r.mover;});
    if(!mover)return false;
    const priest=members.find(function(m){return m.ctype==='priest';});
    if(!priest)return !g.priest && Math.hypot(point.x-goal.x,point.y-goal.y)<=40;
    const reach=safeHealingRange(priest);
    if(!Number.isFinite(reach)||reach<=0)return false;
    const centerReach=Math.max(10,(Number.isFinite(Number(g.range))?Number(g.range):reach)-10);
    const healer=formationBody(priest,priest.name===character.name?point:priest.name===mover.name?goal:undefined);
    return members.every(function(m){
      const body=formationBody(m,m.name===character.name?point:m.name===mover.name?goal:undefined);
      return formationDistance(body,healer)<=reach+0.01 && Math.hypot(body.x-healer.x,body.y-healer.y)<=centerReach+0.01;
    });
  }
  function terrainRecoveryFollowerGoals(goal: Point) {
    const members=formationMembers(),g=ports.groupedCombat(),r=g && g.formationRecovery,character=ports.character();
    const mover=r && members.find(function(m){return m.name===r.mover;});
    if(!mover||!g.target)return [];
    const priest=members.find(function(m){return m.ctype==='priest';});
    if(!priest && g.priest)return [];
    const reach=priest?safeHealingRange(priest):40;
    if(!Number.isFinite(reach)||reach<=0)return [];
    const centerReach=priest?Math.max(10,(Number.isFinite(Number(g.range))?Number(g.range):reach)-10):40;
    const goals=terrainRecoveryGoals(g.target,ports.desiredCombatRange());
    [Math.min(39,centerReach-1),centerReach-1].forEach(function(radius){
      for(let i=0;i<16;i++){
        goals.push({x:goal.x+Math.cos(i*Math.PI/8)*radius,y:goal.y+Math.sin(i*Math.PI/8)*radius});
      }
    });
    goals.push({x:character.x,y:character.y});
    return goals.filter(function(point){return terrainRecoveryFollowerTerminal(point,goal)&&terrainRecoverySafe(point,true);})
      .sort(function(a,b){return Math.hypot(a.x-character.x,a.y-character.y)-Math.hypot(b.x-character.x,b.y-character.y);});
  }
  function followTerrainRecovery() {
    const g=ports.groupedCombat(),r=g && g.formationRecovery,character=ports.character();
    const mover=r && formationMembers().find(function(m){return m.name===r.mover;});
    if(!mover || !g.target)return;
    const distance=Math.hypot(mover.x-character.x,mover.y-character.y);
    if(distance<=40 && terrainRecoveryFollowerTerminal({x:character.x,y:character.y},{x:mover.x,y:mover.y}) && terrainRecoverySafe({x:character.x,y:character.y},true)){holdFormation(g.target,'waiting for recovery leader to advance');return;}
    const client=host.partyQueueClient && host.partyQueueClient.formation;
    const waypoint=client && client.followPoint ? client.followPoint({x:mover.x,y:mover.y}) : mover;
    if(!waypoint){
      const followState=client && typeof client.report==='function' && client.report()?.followerRoute;
      holdFormation(g.target,followState==='arrived'?'waiting at a safe healing position for recovery leader':
        followState==='unreachable'?'no certified safe recovery follower route':'finding safe recovery follower route');return;
    }
    const heading=Math.atan2(waypoint.y-character.y,waypoint.x-character.x),length=Math.min(Number(character.speed||40)*0.25,Math.hypot(waypoint.x-character.x,waypoint.y-character.y));
    const offsets=[0,Math.PI/6,-Math.PI/6,Math.PI/3,-Math.PI/3,Math.PI/2,-Math.PI/2];
    for(let i=0;i<offsets.length;i++){
      const point={x:character.x+Math.cos(heading+offsets[i])*length,y:character.y+Math.sin(heading+offsets[i])*length};
      // An obstacle detour can temporarily increase distance to the priest.
      // The healer must also be able to round a wall when a fighter owns
      // recovery; otherwise the fighter waits for coverage that cannot advance.
      // Only the certified route direction may do this, during peaceful recovery;
      // every issued segment still checks live terrain and monster clearance.
      const detour=i===0 && client && client.followPoint && (mover.ctype==='priest' || character.ctype==='priest') &&
        terrainRecoveryContext().allowed && !host.can_move_to(mover.x,mover.y);
      if((terrainCoverageStep(point) || detour) && terrainRecoverySafe(point)){
        ports.sendCombatMove(g.target,point,'formation-regrouping');
        host.partyCombatPosition.reason=detour?'following safe detour to recovery leader':'following recovery leader within healing coverage';return;
      }
    }
    holdFormation(g.target,'recovery follower blocked by terrain, monsters or coverage');
  }
  // The formation recovery client's ports.
  function terrainRecoveryPorts() {
    return {
      now:function(){return ports.now()+ports.clockOffset();},self:function(){return ports.character();},context:terrainRecoveryContext,
      advance:function(){ports.movement().tick();},smart:function(){return ports.movement().state;},safe:terrainRecoverySafe,
      endpointSafe:function(point: Point){return terrainRecoverySafe(point,true);},
      followGoals:terrainRecoveryFollowerGoals,followTerminalValid:terrainRecoveryFollowerTerminal,
      segmentClear:function(from: Point,to: Point){return terrainRecoverySafe(to,false,from);},
      approachReady:terrainApproachReady,coveredStep:terrainCoverageStep,follow:followTerrainRecovery,stepSize:Math.max(1,Number(ports.character().speed||40)*0.25),
      release:function(){ports.resetCombatMovement();if(host.partyQueueClient)host.partyQueueClient.sight.reset();if(host.partyRoleRunner)host.partyRoleRunner.wake();},
      goals:function(){const g=ports.groupedCombat();return terrainRecoveryGoals(g && g.target,ports.desiredCombatRange());},
      start:function(goal: Point,driver: Value){ports.cancelGroupRoute();ports.cancelFarmApproach('terrain recovery');ports.resetCombatMovement();return ports.smartMove({map:ports.character().map,x:goal.x,y:goal.y}, undefined, {request:ports.recoveryRequest(),town:false,gate:driver});},
      // The stop goes out in the same call, so a route the client starts next is not stopped.
      stop:function(){
        const rejected=function(error: unknown){ports.logEvent('navigation','Formation recovery stop rejected: '+movementError(error).message,{},'formation-recovery-stop');};
        try{Promise.resolve(ports.stop(ports.recoveryRequest())).catch(rejected);}catch(error){rejected(error);}
      },
      hold:function(){ports.cancelGroupRoute();ports.cancelFarmApproach('terrain recovery pause');ports.resetCombatMovement();},
      position:function(r: Value,remaining: Value){host.partyCombatPosition={at:ports.now(),mode:'formation-path-'+r.phase,movementOwner:'formation-recovery',
        target:ports.groupedCombat().target.id,reason:r.reason || (r.mover===ports.character().name?'routing to combat position':'waiting for '+r.mover),
        recoveryId:r.id,mover:r.mover,attempt:r.attempt,destination:r.goal || r.goals[(r.attempt-1)%r.goals.length],remaining:remaining};},
      log:function(phase: string,r: Value){ports.logEvent('navigation','Formation recovery: '+phase,r,'formation-recovery:'+r.id+':'+phase+':'+r.attempt);},
      debug:function(){return !!host.partyFormationRecoveryDebug;},
      draw:function(goal: Point,points: Point[]){
        if(typeof host.draw_line!=='function')return [];
        const self=ports.character();
        const drawings=[host.draw_line(self.x,self.y,goal.x,goal.y,2,host.can_move_to(goal.x,goal.y)?0x55dd88:0xee5555)];
        let from: Point=self;points.forEach(function(p){drawings.push(host.draw_line!(from.x,from.y,p.x,p.y,2,0x55bbff));from=p;});
        if(typeof host.draw_circle==='function')drawings.push(host.draw_circle(goal.x,goal.y,8,2,0xffdd55));
        return drawings;
      }
    };
  }
  // The fight queue's client (runtime/characters/targeting/queue-client.ts) builds the member's recovery client through
  // `root.partyMovement.terrainRecoveryClient` on each install and ticks it.
  function terrainRecoveryClient() { return createFormationRecoveryClient(terrainRecoveryPorts()); }
  function formationRecoverySafePoint(point: Point) {
    const saved=formationFrame,character=ports.character(),entities=host.parent.entities || {};
    const enemies=Object.values(entities).filter(function(e){return e && e.type==='monster' && e.visible && !e.dead &&
      (!e.map || e.map===character.map) && (e.in==null || e.in===character.in);});
    formationFrame={self:formationBody(character),enemies:enemies,attackers:enemies.filter(function(e){return e.target===character.name;}),motions:new Map()};
    try {
      const members=formationMembers(), priest=members.find(function(m){return m.ctype==='priest';});
      const groupedCombat=ports.groupedCombat(), target=groupedCombat && groupedCombat.target;
      if(!priest)return ports.safeCombatPoint(point,target) && formationSegmentSafe(character,point,enemies);
      return formationStepSafe(point,target || {},priest,priest.name===character.name,members,safeHealingRange(priest));
    } finally {formationFrame=saved;}
  }
  return { formationState, formationPerformance, setFormationFrame, formationMembers, formationBody, formationMotion,
    holdFormation, formationMove, separateFromParty, defensiveFormationMove, recoverFormationCorner, terrainRecoveryPorts,
    terrainRecoveryClient, formationRecoverySafePoint };
}
// The recovery route search.
interface RouteNode extends RecoveryPoint {cost:number;rank:number;parent?:RouteNode}
// Kept bounds against a runaway search, the values of b9b5c91e runtime/combat/recovery-route.ts:11,
// :20 and :34. A tick expands at most ROUTE_TICK_EXPANSIONS nodes, the lattice reaches at most
// ROUTE_REACH past the farthest goal, and a search that expands ROUTE_SEARCH_EXPANSIONS nodes at
// both spacings ends and reports `recoveryRouteExpansions`, so a capped search reads apart from a
// proven dead end. A tick that stops on ROUTE_TICK_EXPANSIONS with nodes still open, and each node
// the reach drops, count under their caps (capReached), since both cut a search in normal play.
const ROUTE_TICK_EXPANSIONS=512, ROUTE_SEARCH_EXPANSIONS=16384, ROUTE_REACH=768;
/** Incremental multi-goal A*: every edge uses the caller's live collision/safety rule. */
export function recoveryRoute(origin:RecoveryPoint, destination:RecoveryPoint|RecoveryPoint[], clear:(a:RecoveryPoint,b:RecoveryPoint)=>boolean) {
  const start={x:origin.x,y:origin.y},goals=Array.isArray(destination)?destination:[destination];
  const open:RouteNode[]=[],costs=new Map<string,number>();
  let expanded=0,finished=false,spacing=16;
  const key=(p:RecoveryPoint)=>`${Math.round((p.x-start.x)/spacing)},${Math.round((p.y-start.y)/spacing)}`;
  const heuristic=(p:RecoveryPoint)=>{let best=Infinity;for(const goal of goals)best=Math.min(best,distance(p,goal));return best;};
  const limit=Math.max(...goals.map(g=>distance(start,g)),0)+ROUTE_REACH;
  function push(n:RouteNode){let i=open.length;open.push(n);while(i){const parent=(i-1)>>1;if(open[parent]!.rank<=n.rank)break;open[i]=open[parent]!;i=parent;}open[i]=n;}
  function pop(){const first=open[0]!,last=open.pop()!;if(open.length){let i=0;while(i*2+1<open.length){let child=i*2+1;if(child+1<open.length&&open[child+1]!.rank<open[child]!.rank)child++;if(open[child]!.rank>=last.rank)break;open[i]=open[child]!;i=child;}open[i]=last;}return first;}
  function reset(){expanded=0;open.length=0;costs.clear();costs.set(key(start),0);push({...start,cost:0,rank:heuristic(start)});}
  function path(node:RouteNode,goal:RecoveryPoint){const result:RecoveryPoint[]=[goal];let n:RouteNode|undefined=node;while(n?.parent){result.unshift({x:n.x,y:n.y});n=n.parent;}return result;}
  reset();
  return {tick():RecoveryPoint[]|null|undefined {
    if(finished||!goals.length)return null;
    // A 4 ms slice of the frame per tick; no appendix C row and no design signal (audit 6-32), so
    // b9b5c91e value kept.
    const deadline=performance.now()+4;
    let i=0,beyond=0;
    for(;i<ROUTE_TICK_EXPANSIONS&&open.length&&expanded<ROUTE_SEARCH_EXPANSIONS&&performance.now()<deadline;i++){
      const current=pop();if(current.cost>(costs.get(key(current))??Infinity))continue;expanded++;
      // Keep the origin-to-goal shortcut. Later nodes connect to nearby goal
      // vertices like lattice neighbors, and skip repeating long
      // native collision probes to every distant attack-circle endpoint.
      const nearby=goals.filter(goal=>!current.parent || distance(current,goal)<=spacing*Math.SQRT2);
      for(const goal of nearby.sort((a,b)=>distance(current,a)-distance(current,b)))if(clear(current,goal)){finished=true;return path(current,goal);}
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++){
        if(!x&&!y)continue;
        const next={x:current.x+x*spacing,y:current.y+y*spacing},cost=current.cost+distance(current,next);
        if(cost>=(costs.get(key(next))??Infinity))continue;
        if(distance(start,next)>limit){beyond++;continue;}
        if(!clear(current,next))continue;
        costs.set(key(next),cost);push({...next,cost,rank:cost+heuristic(next),parent:current});
      }
    }
    if(beyond)capReached('ROUTE_REACH','02',beyond);
    if(i>=ROUTE_TICK_EXPANSIONS&&open.length&&expanded<ROUTE_SEARCH_EXPANSIONS)capReached('ROUTE_TICK_EXPANSIONS','02');
    if(!open.length||expanded>=ROUTE_SEARCH_EXPANSIONS){
      if(spacing===16){spacing=8;reset();return;}
      finished=true;
      if(expanded>=ROUTE_SEARCH_EXPANSIONS)boundFired({bound:'recoveryRouteExpansions',owner:'02',state:{expanded,goals:goals.length}});
      return null;
    }
  }};
}

/** Retain a combat detour across ticks; return only a live-validated next segment. */
function createCombatApproachRoute(){
  let liveClear:(a:RecoveryPoint,b:RecoveryPoint)=>boolean=()=>false;
  // `failed` marks a search that found no route; RF6 class B: the next call, on the next movement
  // tick, searches again.
  let selected:{key:string;search:ReturnType<typeof recoveryRoute>;path?:RecoveryPoint[];endpoint?:RecoveryPoint;failed?:boolean}|undefined;
  return {next(key:string,self:RecoveryPoint,goals:RecoveryPoint[],clear:(a:RecoveryPoint,b:RecoveryPoint)=>boolean):RecoveryPoint|undefined{
    liveClear=clear;
    if(selected?.key!==key || selected.failed ||
        selected.path?.length===0 && selected.endpoint && distance(self,selected.endpoint)>=6)
      selected={key,search:recoveryRoute(self,goals,(a,b)=>liveClear(a,b))};
    if(!selected.path){const result=selected.search.tick();if(result===null){selected.failed=true;return;}if(!result)return;selected.path=result;selected.endpoint=result.at(-1);}
    while(selected.path.length&&distance(self,selected.path[0]!)<6)selected.path.shift();
    if(!selected.path.length)return;
    let next:RecoveryPoint|undefined,index=0;
    for(let i=0;i<selected.path.length;i++){const point=selected.path[i]!;if(!clear(self,point))break;next=point;index=i;}
    if(next && index)selected.path.splice(0,index);
    if(!next){selected=undefined;return;}
    return next;
  },status(){return selected?.failed?'unreachable':selected?.path?(selected.path.length?'routing':'arrived'):'planning';},reset(){selected=undefined;}};
}
function distance(a:RecoveryPoint,b:RecoveryPoint){return Math.hypot(a.x-b.x,a.y-b.y);}
// The member's recovery client.
interface Waypoint extends RecoveryPoint {map:string;town?:boolean;transport?:boolean}
interface NativeSmart {found:boolean;plot:Waypoint[];searching?:boolean}
// The detour journey's gate (runtime/protocol/records.ts `MovementOptions.gate`): the owner runs it in
// place of its own tick while this journey is live and drops it when the journey ends.
interface Driver {tick():void}
interface Drawing {destroy?():void}
// `drawn` is the content of the last debug drawing (RF6 class D: drawn again only when it changes).
interface Route {driver:Driver;goal:RecoveryPoint;checked:boolean;drawn?:string;remaining:number;issued?:Waypoint;search?:ReturnType<typeof recoveryRoute>}
interface RecoveryClientPorts {
  now():number;self():RecoveryPoint & {name:string;map:string;moving?:boolean;going_x?:number;going_y?:number};
  context():{allowed:boolean;key?:string;target?:string;covered?:boolean};
  smart():NativeSmart;safe(point:RecoveryPoint):boolean;
  // Runs the movement service's own tick for the detour journey.
  // terrainRecoveryPorts, the client's one builder, answers every port.
  advance():void;endpointSafe(this:void,point:RecoveryPoint):boolean;
  followGoals(this:void,goal:RecoveryPoint):RecoveryPoint[];followTerminalValid(this:void,point:RecoveryPoint,goal:RecoveryPoint):boolean;
  start(goal:RecoveryPoint,driver:Driver):unknown;stop():void;hold():void;
  segmentClear(this:void,from:RecoveryPoint,to:RecoveryPoint):boolean;
  approachReady():boolean; goals():RecoveryPoint[];
  coveredStep(point:RecoveryPoint):boolean; follow():void; stepSize:number;
  release():void;
  log(phase:string,details:object):void;position(control:FormationRecovery,remaining?:number):void;
  debug():boolean;draw(goal:RecoveryPoint,points:Waypoint[]):Drawing[]|undefined;
}
function routeKey(c:FormationRecovery|undefined):string {return JSON.stringify([c?.id,c?.phase,c?.attempt]);}
/** The native scheduler remains the only walker; the detour journey carries its own gate. */
function createFormationRecoveryClient(p:RecoveryClientPorts) {
  const approachRoute=createCombatApproachRoute();
  let control:FormationRecovery|undefined, proposal:FormationRecoveryReport|undefined;
  let outcome:FormationRecoveryReport|undefined, route:Route|null=null, seenId='', drawings:Drawing[]=[];
  let movementBlock:string|undefined;
  // A follower search that found no route stays `unreachable` until a report has carried it (`told`),
  // then searches again (RF6 class B: the next report carries the failure).
  let follower:{goal:RecoveryPoint;search:ReturnType<typeof recoveryRoute>;path?:RecoveryPoint[];terminal?:RecoveryPoint;failedAt?:number;told?:boolean}|undefined;
  function clearDrawings(){for(const d of drawings)d?.destroy?.();drawings=[];}
  function cancel(){
    follower=undefined;
    const old=route;route=null;movementBlock=undefined;clearDrawings();
    // The stop names formation recovery, so the owner refuses it once another request holds
    // the character (design section 8.1: a release by a holder that is not live is a no-op).
    if(old)p.stop();
  }
  function valid(){const c=p.context();return !!control && c.allowed && c.key===control.key && c.target===control.target;}
  function finish(reason?:string){
    if(!control)return;
    outcome={target:control.target,at:p.now(),ack:control.id,attempt:control.attempt,outcome:reason?'failed':'arrived',reason};
    cancel();p.log(reason?'failed':'arrived',{...control,reason});
  }
  function overlay(current:Route,s:NativeSmart){
    if(!p.debug()){clearDrawings();return;}
    const content=JSON.stringify([current.goal,s.plot]);
    if(current.drawn===content)return;
    current.drawn=content;clearDrawings();drawings=p.draw(current.goal,s.plot)||[];
  }
  function shortenSegment(s:NativeSmart,self:ReturnType<RecoveryClientPorts['self']>):void {
    const next=s.plot[0];
    if(next && !self.moving){
      const distance=Math.hypot(next.x-self.x,next.y-self.y);
      if(distance>p.stepSize)s.plot.unshift({...s.plot[0]!,map:self.map,x:self.x+(next.x-self.x)*p.stepSize/distance,y:self.y+(next.y-self.y)*p.stepSize/distance});
    }
  }
  function segmentReady(s:NativeSmart,self:ReturnType<RecoveryClientPorts['self']>):boolean {
    shortenSegment(s,self);
    const segment=self.moving?{map:self.map,x:Number(self.going_x),y:Number(self.going_y)}:s.plot[0];
    if(segment && !p.coveredStep(segment)){
      movementBlock='waiting for followers to preserve healing coverage';return false;
    }
    movementBlock=undefined;
    if(segment&&!p.safe(segment)){
      if(route && !self.moving){
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
    overlay(current,s);p.advance();
  }
  function walk(){
    if(!route)return;
    if(!valid()){cancel();return;}
    try {step(route);} catch(error){finish(movementError(error).message);}
  }
  function start(){
    if(!control)return;
    const goal=control.goal || control.goals[(control.attempt-1)%control.goals.length]!;
    route={driver:{tick:walk},goal,checked:false,remaining:Infinity};
    const owned=route;
    // A request that replaces the detour rejects its promise, which finishes the attempt.
    try {
      const promise=p.start(goal,owned.driver);
      p.log('routing',{...control,destination:goal});
      Promise.resolve(promise).then(()=>{
        if(route!==owned)return;
        finish(Math.hypot(p.self().x-owned.goal.x,p.self().y-owned.goal.y)<=12?undefined:'route ended before the recovery position');
      }).catch((error)=>{if(route===owned)finish(movementError(error).message);});
    } catch(error){finish(movementError(error).message);}
  }
  function accept(next:FormationRecovery|undefined){
    if(routeKey(control)!==routeKey(next))cancel();
    if(control && !next){proposal=undefined;outcome=undefined;p.release();}
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
      approachReady:p.approachReady(),goals:control!.phase==='retry'?p.goals():undefined,remaining:route?.remaining,
      coverageBlocked:movementBlock==='waiting for followers to preserve healing coverage',
      followerRoute:control!.mover!==p.self().name?followerRoute():undefined};
  }
  function plan(current:Route,s:NativeSmart):void {
    // Every alternative is part of this coordinator-owned goal set. Searching
    // them together avoids exhausting an attempt on a disconnected first goal.
    const goals=[current.goal,...(control?.goals || [])].filter((goal,index,all)=>
      all.findIndex(other=>other.x===goal.x && other.y===goal.y)===index);
    current.search??=recoveryRoute(p.self(),goals,p.segmentClear);
    const points=current.search.tick();
    if(points===null){finish('no safe same-map route to recovery position');return;}
    if(points){current.goal=points.at(-1)!;s.plot=points.map(point=>({...point,map:p.self().map}));s.searching=false;s.found=true;}
  }
  function report():FormationRecoveryReport|undefined {
    if(valid())return activeReport();
    if(proposal && p.context().allowed && proposal.target===p.context().target)return {...proposal,at:p.now()};
  }
  function position():void {
    p.position({...control!,goal:route?.goal || control!.goal,reason:movementBlock || control!.reason},route?.remaining);
  }
  function movement():boolean {
    if(!valid())return false;
    if(control!.mover!==p.self().name && control!.phase!=='pausing' && control!.phase!=='failed'){
      p.follow();return true;
    }
    if(control!.phase==='regrouping' && p.self().name!==control!.mover && !p.context().covered)return false;
    position();
    return true;
  }
  function followerRoute():FormationRecoveryReport['followerRoute']{
    if(!follower)return;
    if(follower.failedAt!==undefined){follower.told=true;return 'unreachable';}
    return follower.path?(follower.path.length?'routing':'arrived'):'planning';
  }
  function followGoals(goal:RecoveryPoint):RecoveryPoint[]{
    return p.followGoals(goal).filter(point=>terminalValid(point,goal)&&p.endpointSafe(point));
  }
  function terminalValid(point:RecoveryPoint,goal:RecoveryPoint):boolean{
    return p.followTerminalValid(point,goal);
  }
  function followerInvalid(goal:RecoveryPoint):boolean{
    if(!follower)return true;
    if(follower.failedAt!==undefined&&follower.told)return true;
    const terminal=follower.terminal;
    if(!terminal)return Math.hypot(goal.x-follower.goal.x,goal.y-follower.goal.y)>40;
    return !terminalValid(terminal,goal)||!p.endpointSafe(terminal);
  }
  function followerPathReady(goal:RecoveryPoint):boolean{
    if(follower!.failedAt!==undefined)return false;
    if(!follower!.path){
      const result=follower!.search.tick();
      if(result===null){follower!.failedAt=p.now();return false;}
      follower!.path=result;follower!.terminal=result?.at(-1);
    }
    if(followerInvalid(goal)){follower=undefined;return false;}
    return !!follower!.path;
  }
  function followPoint(goal:RecoveryPoint):RecoveryPoint|undefined {
    const self=p.self();
    if(followerInvalid(goal)){
      const goals=followGoals(goal);
      follower={goal:{...goal},search:recoveryRoute(self,goals,p.segmentClear)};
    }
    if(!followerPathReady(goal))return;
    while(follower!.path?.length && Math.hypot(follower!.path[0]!.x-self.x,follower!.path[0]!.y-self.y)<6)follower!.path.shift();
    return follower!.path?.[0];
  }
  return {accept,tick,report,movement,blocks:()=>valid(),
    followPoint,
    approachPoint:approachRoute.next,
    approachStatus:approachRoute.status,
    propose(target:string,goals:RecoveryPoint[]){if(!control && goals.length && p.context().allowed)proposal={target,goals,at:p.now()};},
    stop(){approachRoute.reset();cancel();control=undefined;proposal=undefined;outcome=undefined;}};
}
