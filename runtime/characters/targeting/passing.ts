// The passing column (S5's passing half): which walks a passing monster may interrupt, the passive hunting stop rule
// during travel. A passing monster interrupts farming and Hunt travel; a trip the player started by hand finishes. A
// rare encounter asks the task table instead (01 design 2.1 rare row). The tiers and answers are movement-rules.ts's
// passive column on bcb14c7c (159-161), moved here unchanged. The coordinator asks it as `targeting.passing`, answered
// by `core:targeting` (runtime/coordinator/targeting/install.ts); shared.js's passing encounter reads it in the module
// (install.ts). The passive hunting stop rule (`passiveStopRequired`) joined it from runtime/combat/passive-travel.ts.
// The column reads the encounter's cause (the user's answer to MOV-Q29, Reopened R4 RR14). A passive rule set to "stop"
// is answered by the tier alone, so it stops the walk to Daisy and backup travel as it stops the other Hunt and farming
// walks. The `rare` cause also reads the Hunt walk's target, for an add-on that asks it; the core rare encounter asks
// nothing here, since The tasks owner's rare task ends the walk under way. Every other walk names a tier the column
// refuses: the Hunt turn-in, event, Town, escape and manual walks. Every coordinator walk is a group walk on the one
// walk machine (movement/coordinator/walk.ts), so passing attacks on any group walk wait for the leader's live travel
// signal (shared.js `passingTravelAllowed`).
import { eventFacts } from '../../events/api.ts';
import { handsCombatOver } from '../../movement/api/character.ts';
import { rareWalkKind } from '../../hunting/api.ts';
import type { PassingCause } from '../../hooks/registry.ts';
import type { Tier } from '../../protocol/ranks.ts';
import type { WalkView } from '../../protocol/records.ts';
import type { TargetingMap, TargetingPorts, TargetingState } from './install.ts';
import { pick } from './saved-fields.ts';
import { LIST_BOUNDS, nearerFirst, PASSING } from './rules.ts';
import { huntSwitchAllows, passiveStopRequired as stopRuleRequired } from './api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { scope } from '../../lifecycle/api.ts';
import { handsSend } from '../../merchant-hands/character/api.ts';

const INTERRUPTS: Partial<Record<Tier, true>> = { 'hunt-mission': true, farming: true };
// A walk saved before walks named their tier names none, and nothing interrupts it.
export function passingAllows(walk: WalkView | null | undefined, cause: PassingCause): boolean {
  const tier = walk?.requester?.tier;
  return !!tier && INTERRUPTS[tier] === true && (cause === 'passive' || walk!.purpose !== 'monster-hunt' || !!walk!.huntTarget);
}

// The passing encounter on the character and the travel stop reads, moved from
// shared.js (r15).
export function createPassing(t: TargetingMap, p: TargetingPorts, s: TargetingState) {
  // The field generator ask for one tinyp encounter: its key, when it began and whether the equip went out (C-23).
  let generatorAttempt: { key: string; at: number; sent: boolean } | null = null;
  // Passing encounters own attacks only, never navigation, kiting, or loot waits.
  function committedHuntEncounter(target: any) {
    // The coordinator supplies huntCombatTarget only after verified origin arrival.
    return !!(target && t.view().huntCombatTargetNow && target.mtype === t.view().huntCombatTargetNow &&
      !(typeof p.walkState.convoyActive !== 'undefined' && p.walkState.convoyActive) &&
      !(p.walks.groupWalk.travel) &&
      !(typeof p.walks.travelCombatActive === 'function' && t.view().travelCombatActive));
    }
  // isPassingEncounter passes the realm it already read, so a key costs no
  // second read of parent.server_region through the CODE facade.
  function passingKey(target: any, realm: any) {
    return JSON.stringify([target.server || (realm === undefined ? t.view().reunionRealm : realm), target.map || character.map,
      String(target.in == null ? character.in || character.map : target.in), String(target.id)]);
    }
  function passingEncounterReport() {
    var now = Date.now() + p.walkState.clockOffset;
    Object.keys(s.passingEncounters).forEach(function(key: any) {
      var entry = s.passingEncounters[key], e = get_entity(entry.id);
      if (entry.server !== t.view().reunionRealm || entry.map !== character.map || String(entry.in || entry.map) !== String(character.in || character.map) ||
          e && (e.dead || e.hp === 0) || typeof s.fightDeaths !== 'undefined' && s.fightDeaths.some(function(d: any){return t.passingKey(d)===key && d.at>=(entry.startedAt || entry.at);}) || t.committedHuntEncounter(entry) || now - entry.at > pick('passingMemoryMs')) delete s.passingEncounters[key];
      else if (e && e.visible && !entry.reserved) entry.at = now;
    });
    return Object.values(s.passingEncounters).slice(-LIST_BOUNDS.passing);
    }
  function isPassingEncounter(target: any) {
    if (!target) return false;
    if (t.passiveTravelInterruptible() && t.passiveStopRequired(target))return false;
    var rule=p.hunting.rares.passive().rules[target.mtype];
    if (t.committedHuntEncounter(target) || typeof p.hunting.hunt.defense === "function" && p.hunting.hunt.defense() && !(rule && rule.enabled && rule.keepMoving)) return false;
    var realm = t.view().reunionRealm, key = t.passingKey(target, realm), now = Date.now() + p.walkState.clockOffset;
    if (target.dead || target.hp === 0) return false;
    // Keep cache ownership inside this function: standalone runtime harnesses
    // install it without the surrounding script. Weak keys release replaced
    // coordinator lists; native deaths appended in place invalidate by length.
    var indexes = t.isPassingEncounter.indexes || (t.isPassingEncounter.indexes = new WeakMap());
    // isPassingEncounter runs for every visible monster on each combat and
    // travel check. It keeps the last context text
    // and serializes again only when the realm, map or instance changes.
    var place = t.isPassingEncounter.place, instance = String(character.in || character.map);
    if (!place || place.realm !== realm || place.map !== character.map || place.instance !== instance)
      place = t.isPassingEncounter.place = {realm:realm,map:character.map,instance:instance,
        context:JSON.stringify([realm, character.map, instance])};
    var context = place.context;
    function recent(list: any) {
      if (!list || !list.length) return false;
      var cached = indexes.get(list);
      if (!cached || cached.length !== list.length || cached.context !== context) {
        var latest = new Map();
        list.forEach(function(entry: any) {
          var at = Number(entry.at);
          if (Number.isNaN(at)) return;
          var identity = t.passingKey(entry);
          if (!latest.has(identity) || at > latest.get(identity)) latest.set(identity, at);
        });
        cached = {length:list.length,context:context,latest:latest};
        indexes.set(list,cached);
      }
      return now - cached.latest.get(key) < pick('passingMemoryMs');
    }
    if (recent(typeof s.fightDeaths !== 'undefined' ? s.fightDeaths : null) || recent(s.groupedCombat && s.groupedCombat.deaths)) return false;
    if (recent(s.peerPassingEncounters)) return true;
    return !!(s.passingEncounters[key] && now - s.passingEncounters[key].at < pick('passingMemoryMs')) ||
      recent(s.groupedCombat && s.groupedCombat.passingEncounters);
    }
  function passingTravelAllowed() {
    if (character.c && character.c.town || p.movement.transition()) return false;
    var convoy = p.walks.groupWalk.travel;
    var pending = t.view().huntPending;
    if (!convoy && character.moving) return true;
    // Passing attacks on a group walk wait for the leader's live travel signal (the passing
    // column's group-walk condition, `passingAllows` in this file).
    if (!pending && !convoy) return true;
    var signal = p.walks.groupWalk.signal;
    return !!(convoy && !convoy.cancelled && signal && (convoy.phase === 'travelling' && signal.phase === 'travel' ||
        character.moving && convoy.phase === 'assembling' && signal.phase === 'assemble') &&
      signal.id === convoy.id && Number(signal.epoch) === convoy.epoch && Number(signal.commandId) === convoy.commandId &&
      signal.runtimeId === p.walkState.runtimeId && !p.walks.convoySignalExpired(signal) &&
      convoy.navigationRevision === Number(p.walkState.intent.revision || 0));
    }
  // P4 `targeting.rule`: an enabled add-on may admit a passing attack below PASSING.lowHp; the spend table's
  // passing column still decides whether it goes.
  function lowHpLifted(): boolean {
    const hooks = p.root.__partyHooks?.targeting;
    return !!hooks?.rules() && hooks.admits({ row: 'passing', target: null, character: character.name, core: 'below the passing HP share' });
  }
  function passingTarget() {
    var walkingPassive = t.walkingPassiveTarget();
    if (walkingPassive) return walkingPassive;
    if(t.view().returnCombatActive)return null;
    var heldTarget=t.convoyHoldDefenseTarget();
    if(heldTarget)return heldTarget;
    if (!t.passingTravelAllowed()) return null;
    if(p.hunting.hunt.outbound()) {
      if(p.hunting.hunt.extraAggro()){p.walks.interruptConvoyForDefense();return null;}
      // The Hunt travel control holds until the coordinator's next reply replaces it or the Hunt walk
      // ends (`control()` binds it to the walk's id and epoch). The report freshness rule bounds a
      // coordinator that stops replying.
      var control=p.hunting.hunt.control();
      if(!control || control.reason || control.defending || !p.movement.fresh(p.root.__partyHuntTravelAt||0,Date.now()+p.walkState.clockOffset))return null;
    }
    var convoy = p.walks.groupWalk.travel;
    var hunting = convoy && convoy.purpose === 'monster-hunt' && convoy.huntTarget;
    var returning = convoy && (convoy.continuousReturn === 1 || hunting);
    if (character.rip || Number(character.max_hp)>0 && character.hp/character.max_hp<PASSING.lowHp && !lowHpLifted() || character.ctype === 'merchant' || p.walkState.intent.cancelled || t.escaping() || p.tasks.assignment.combatRecoveryHolds() ||
        p.walkState.townActive || p.bag.fact('banking') || p.bag.fact('stocking') || p.bag.fact('upgrading') || p.merchant.gathering.active() || p.walkState.forceTraveling || p.walkState.townTraveling || eventFacts().travellingEventName() || t.view().joinedEventNow || t.view().activeCombatEvent ||
        (t.view().rareActive && t.view().rareControlNow.kind !== "patrol") || !returning && t.view().unfinishedFight) return null;
    var candidates = Object.values(parent.entities || {}).filter(function(e: any) {
      if(t.passiveTravelInterruptible() && t.passiveStopRequired(e))return false;
      if(control && control.primary && t.passingKey(e)!==t.passingKey(control.primary))return false;
      var rule = e && p.hunting.rares.passive().rules[e.mtype];
      var defending = returning && e && (e.target === character.name || t.view().currentPartyList.indexOf(e.target) >= 0);
      return (control && control.primary || defending || hunting && e && e.mtype === hunting || rule && rule.enabled && rule.keepMoving && t.passiveLevelAllowed(e)) && !t.committedHuntEncounter(e) && e.type === 'monster' && e.visible && !e.dead && e.hp > 0 &&
        (!e.map || e.map === character.map) && e.mtype !== 'fieldgen0' && is_in_range(e) &&
        (returning || t.isPassingEncounter(e) || !(e.target === character.name || t.view().currentPartyList.indexOf(e.target) >= 0)) &&
        !t.isExternallyClaimedMonster(e) && (returning || !s.groupedCombat || !s.groupedCombat.target || s.groupedCombat.target.id !== e.id) &&
        !t.isKnownDead(e.id);
    });
    candidates.sort(function(a: any,b: any) {return Number(t.view().currentPartyList.indexOf(b.target)>=0)-Number(t.view().currentPartyList.indexOf(a.target)>=0) || t.monsterPriority(b)-t.monsterPriority(a) || Math.hypot(character.x-a.x,character.y-a.y)-Math.hypot(character.x-b.x,character.y-b.y) || String(a.id).localeCompare(String(b.id));});
    return candidates[0] || null;
    }
  function passiveLevelAllowed(target: any) {
    var rule=target && p.hunting.rares.passive().rules[target.mtype], cap=rule && rule.maxLevel;
    return cap==null || cap===-1 || Number.isFinite(target.level) && target.level<=cap;
    }
  function walkingPassiveTarget(reserveAhead: any) {
    var convoy = p.walks.groupWalk.travel;
    if (!(character.moving || convoy && convoy.phase === 'travelling') ||
        character.rip || character.ctype === 'merchant' || p.walkState.intent.cancelled ||
        t.view().drain || p.bag.fact('previewing') ||
        convoy && (convoy.cancelled || convoy.defensePaused || convoy.holdRequested || convoy.communication) ||
        !t.passingTravelAllowed()) return null;
    return Object.values(parent.entities || {}).filter(function(e: any) {
      var rule = e && p.hunting.rares.passive().rules[e.mtype];
      return rule && rule.enabled && rule.keepMoving && t.passiveLevelAllowed(e) && e.type === 'monster' && e.visible && !e.dead && e.hp > 0 &&
        (!e.map || e.map === character.map) && (e.in == null || e.in === character.in) &&
        e.mtype !== 'fieldgen0' && !t.committedHuntEncounter(e) &&
        (is_in_range(e) || reserveAhead && character.moving &&
          (e.x-character.x)*((character.going_x as number)-character.x)+(e.y-character.y)*((character.going_y as number)-character.y)>0 &&
          Math.hypot(e.x-character.x,e.y-character.y)<=Math.min(PASSING.reserveReach,Number(character.range)+Number(character.speed)*PASSING.reserveSpeed)) &&
        !t.isExternallyClaimedMonster(e) &&
        (t.isPassingEncounter(e) || t.view().currentPartyList.indexOf(e.target) < 0) &&
        !t.isKnownDead(e.id);
    }).sort(function(a: any,b: any) { return t.monsterPriority(b)-t.monsterPriority(a) ||
      // Complete an existing cohort reservation before starting another equal
      // priority handshake; neither reservation may change walking ownership.
      Number(t.isPassingEncounter(b))-Number(t.isPassingEncounter(a)) ||
      Math.hypot(character.x-a.x,character.y-a.y)-Math.hypot(character.x-b.x,character.y-b.y) || String(a.id).localeCompare(String(b.id)); })[0] || null;
    }
  function beginPassingAttack(target: any, admission: any, reserveOnly: any) {
    var previous = s.passingEncounters[t.passingKey(target)];
    var rule = p.hunting.rares.passive().rules[target.mtype];
    var entry = Object.assign(t.groupedEntityReport(target), {server:t.view().reunionRealm,at:Date.now()+p.walkState.clockOffset,startedAt:previous && previous.startedAt || Date.now()+p.walkState.clockOffset,admission:admission || previous && previous.admission,reserved:!!reserveOnly,keepMoving:!!(rule && rule.enabled && rule.keepMoving)});
    s.passingEncounters[t.passingKey(entry)] = entry;
    if (s.queueClient) s.queueClient.flush();
    if (reserveOnly) return;
    if (target.mtype !== 'tinyp' || !p.hunting.rares.passive().useFieldGenerators || p.hunting.rares.fields().length || Math.hypot(character.x-target.x,character.y-target.y)>=PASSING.generatorReach) return;
    var key = t.passingKey(entry);
    if (!generatorAttempt || generatorAttempt.key !== key) generatorAttempt={key:key,at:Date.now(),sent:false};
    var rank = t.view().currentPartyList.slice().sort().indexOf(character.name);
    if (generatorAttempt.sent || Date.now()-generatorAttempt.at<Math.max(0,rank)*PASSING.generatorStaggerMs) return;
    var slot = character.items.findIndex(function(item: any){return item && item.name==='fieldgen0';});
    if (slot<0) return;
    generatorAttempt.sent=true;
    // The generator's equip goes out through the call budget owner's hands door, which asks the `job` band; on "not now"
    // it waits a call window on the targeting owner's handle and asks again.
    void (async function () {
      let sent;
      while (!(sent = handsSend('job', 'equip', slot))) await scope('04', 'act').sleep(partyHooks().calls.window());
      await sent;
    })().catch(function(){generatorAttempt=null;});
    }
  function farmingTravelTarget(command: any) {
    var huntTravel = command && command.purpose === "monster-hunt" && command.combatHandoffAllowed === true && command.huntTarget;
    var farmTravel=command && handsCombatOver(command.purpose,command.combatHandoffAllowed) && command.combatHandoffAllowed===true;
    if (t.view().travelCombatActive && !huntTravel && !farmTravel) return null;
    if (command && rareWalkKind(command.purpose)) return null;
    var waypoint = command && command.location;
    if (!waypoint || command.combatHandoffAllowed === false || !huntTravel && !farmTravel && character.map !== waypoint.map) return null;
    if (huntTravel) return t.huntTravelTarget(command);
    var allTypes = t.view().monsterFocusNow.indexOf("all") >= 0;
    var candidates = Object.keys(parent.entities || {}).map(function (id: any) { return parent.entities[id]; })
      .filter(function (entity: any) {
        return entity && entity.type === "monster" && entity.visible && !entity.dead &&
          (entity.hp === undefined || entity.hp > 0) &&
          (!entity.map || entity.map === character.map) &&
          (entity.in === undefined || entity.in === character.in) &&
          (allTypes || t.view().monsterFocusNow.indexOf(entity.mtype) >= 0) &&
          t.isAllowedTarget(entity, farmTravel ? command : undefined) && p.hunting.facts.focus.contains(entity, waypoint) &&
          (!farmTravel || Math.hypot(entity.x-character.x,entity.y-character.y)<=p.hunting.farm.radius());
      });
    candidates.sort(function (a: any, b: any) {
      return t.monsterPriority(b) - t.monsterPriority(a) ||
        nearerFirst(a, b);
    });
    if (t.view().farmingModeNow === "scatter") {
      var unassigned = candidates.filter(function (entity: any) {
        return !s.partyTargets.some(function (claimed: any) { return claimed.id === entity.id && entity.id !== s.combatTargetId; });
      });
      if (unassigned.length) candidates = unassigned;
    }
    return candidates[0] || null;
    }
  function convoyThreatActive(command: any) { return !!t.farmingTravelTarget(command); }
  function huntTravelTarget(command: any) {
    if (command.combatHandoffAllowed === false || command.cause === "farming-conflict") return null;
    var paused=p.hunting.hunt.pause();
    if (paused) { p.hunting.hunt.log(command,null,paused); return null; }
    var candidates=Object.values(parent.entities || {}).filter(function(t: any){return t && t.type==="monster" && t.mtype===command.huntTarget;});
    candidates.sort(nearerFirst);
    if (t.view().farmingModeNow === "scatter") {
      var unassigned=candidates.filter(function(t: any){return !(s.partyTargets || []).some(function(p: any){return p.id===t.id && t.id!==s.combatTargetId;});});
      candidates=unassigned.concat(candidates.filter(function(t: any){return unassigned.indexOf(t)<0;}));
    }
    var nearestReason=null, selected=null;
    for (var i=0;i<candidates.length;i++) {
      var reason=p.hunting.hunt.rejection(candidates[i],command);
      if (i===0) nearestReason=reason;
      if (!reason) {selected=candidates[i];break;}
    }
    p.hunting.hunt.log(command,selected || candidates[0],selected ? "eligible candidate" : nearestReason || "no hunt monster observed");
    return selected;
    }
  function passiveStopRequired(target: any) {
    return !!target && stopRuleRequired(p.hunting.rares.passive(), target.mtype);
    }
  // Whether a passive stop or a second attacker may stop this walk: targeting's passing
  // column decides (`passingAllows` in this file), as on the coordinator
  // (runtime/coordinator/targeting/hunt-travel.ts, with api.ts).
  function passiveTravelInterruptible() {
    return !!p.walks.groupWalk.travel && passingAllows(p.walks.groupWalk.travel, 'passive');
    }
  function travelStopCandidates() {
    if(!t.passiveTravelInterruptible() || p.walks.groupWalk.travel?.defensePaused || p.walkState.intent.cancelled || t.escaping() || p.tasks.assignment.combatRecoveryHolds() || t.view().joinedEventNow)return [];
    return Object.values(parent.entities||{}).filter(function(e: any){return e && e.type==='monster' && e.visible && !e.dead && e.hp>0 &&
      t.passiveStopRequired(e) && huntSwitchAllows(p.walks.groupWalk.travel, p.hunting.rares.passive(), e.mtype) && !t.isExternallyClaimedMonster(e) && (!e.target || t.view().currentPartyList.indexOf(e.target)>=0) &&
      !t.isKnownDead(e.id);}).map(function(e: any){return Object.assign(t.groupedEntityReport(e),{target:e.target||null});});
    }
  function convoyHoldDefenseTarget() {
    var c=p.walks.groupWalk.travel;
    if(!c || !(c.holdRequested || c.communication || c.phase==='held' || c.phase==='communication-hold') ||
      character.rip || p.walkState.intent.cancelled || Number(c.navigationRevision)!==Number(p.walkState.intent.revision) || t.escaping() || p.tasks.assignment.combatRecoveryHolds())return null;
    return Object.values(parent.entities||{}).filter(function(e: any){
      return e && e.type==='monster' && e.visible && !e.dead && e.hp>0 &&
        (!e.map || e.map===character.map) && t.view().currentPartyList.indexOf(e.target)>=0 && is_in_range(e) && !t.isExternallyClaimedMonster(e);
    }).sort(function(a: any,b: any){return Number(b.target===character.name)-Number(a.target===character.name) || String(a.id).localeCompare(String(b.id));})[0] || null;
    }
  return { committedHuntEncounter, passingKey, passingEncounterReport, isPassingEncounter, passingTravelAllowed, passingTarget, passiveLevelAllowed, walkingPassiveTarget, beginPassingAttack, farmingTravelTarget, convoyThreatActive, huntTravelTarget, passiveStopRequired, passiveTravelInterruptible, travelStopCandidates, convoyHoldDefenseTarget };
}
