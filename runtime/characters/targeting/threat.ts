// The threat facts (V1.1 threat.ts): who attacks the party, the return defence and the travel
// departure's engaged target.
import { nearerFirst } from './rules.ts';
import { eventFacts } from '../../events/api.ts';
import type { TargetingMap, TargetingPorts, TargetingState } from './install.ts';

// Moved whole from shared.js.
export function createThreat(t: TargetingMap, p: TargetingPorts, s: TargetingState) {
  // departureTargetEngaged's death index, one entry per tombstone list.
  const indexes = new WeakMap<object, { length: number; context: string; ids: Set<string> }>();
  function isCurrentPartyTarget(target: any) {
    if ((character as any).cave) return t.dungeonTargetAllowed(target);
    if (!target || !target.id) return false;
    if (s.leaderTarget && s.leaderTarget.id === target.id) return true;
    return s.partyTargets.some(function (partyTarget: any) {
      return partyTarget && partyTarget.id === target.id;
    });
    }
  function isPartyThreat(target: any) {
    return target && !t.isPassingEncounter(target) && s.partyThreats.some(function (threat: any) { return threat.id === target.id; });
    }
  function isAttackingPartyMember(target: any) {
    var rule = target && p.hunting.rares.passive().rules[target.mtype];
    if (!target || target.type !== "monster" || t.isPassingEncounter(target) &&
        (rule && rule.enabled && rule.keepMoving || !t.returnDepartureDefense() &&
        !(p.walks.groupWalk.travel && p.walks.groupWalk.travel.continuousReturn === 1))) return false;
    target = get_entity(target.id) || target;
    if (target.target === character.name) return true;
    if (!target.target || t.view().currentPartyList.indexOf(target.target) < 0)
      return false;
    return ((character as any).cave ? p.hunting.cave.partyMembers() : s.partyPositions).some(function (member: any) {
      return member && eventFacts().sameTeam(member) && member.name === target.target && member.map === character.map;
    });
    }
  function getNearestPartyAttacker() {
    var attackers = Object.keys(parent.entities || {}).map(function (id: any) {
      return parent.entities[id];
    }).filter(function (entity: any) {
      return entity && entity.type === "monster" && entity.visible && !entity.dead &&
        t.isAttackingPartyMember(entity) && t.isAllowedTarget(entity);
    });
    attackers.sort(nearerFirst);
    return attackers[0] || null;
    }
  function getNearestPartyTarget() {
    var targets = s.partyTargets.map(function (target: any) {
      return target && get_entity(target.id);
    }).filter(function (target: any) {
      return target && target.type === "monster" && target.visible && !target.dead && t.isAllowedTarget(target);
    });
    targets.sort(nearerFirst);
    return targets[0] || null;
    }
  function returnDepartureDefense() {
    var c=p.walks.groupWalk.travel;
    return !!(c && c.purpose==='monster-hunt' && c.nonPreemptible && !c.returnWalking &&
      (c.phase!=='travelling' || p.movement.transition()==='town'));
    }
  function returnCombatActive() {
    if(character.rip || p.walkState.intent.cancelled || t.escaping() || p.tasks.assignment.combatRecoveryHolds())return false;
    return !!(p.walks.groupWalk.travel && p.walks.groupWalk.travel.continuousReturn === 1 || eventFacts().recovering());
    }
  // A live monster on this map and instance; the return defence and the Town interrupt both ask it.
  function liveHere(e: any) {
    return !!(e && e.type==='monster' && e.visible!==false && !e.dead && e.hp>0 && (!e.map || e.map===character.map) && (e.in==null || e.in===character.in));
    }
  function returnAttacker(target: any) {
    return liveHere(target) && t.isAttackingPartyMember(target);
    }
  function returnDefenseTarget() {
    var targets=Object.values(parent.entities||{}).filter(t.returnAttacker);
    targets.sort(function(a: any,b: any){return Number(is_in_range(b))-Number(is_in_range(a)) || String(a.id).localeCompare(String(b.id));});
    return targets[0] || null;
    }
  function cancelReturnTownUnderAttack() {
    var c=p.walks.groupWalk.travel;
    if(!c || c.continuousReturn!==1 || !c.townAttempt || c.townAttempt.state!=='casting')return;
    // Passing retaliation never stops walking, but still interrupts a Town cast.
    if(!Object.values(parent.entities||{}).some(function(e: any){return liveHere(e) && t.view().currentPartyList.indexOf(e.target)>=0;}))return;
    c.townAttempt.state='interrupted';
    c.fail('Town interrupted by party attacker; continuing home on foot');
    }
  function departureTargetEngaged(target: any) {
    if(!target || !target.visible || target.dead || target.hp === 0 || t.isKnownDead(target.id))return false;
    // Check ownership before scanning retained deaths for neutral farm monsters.
    var defense=typeof p.hunting.hunt.defense==='function' && p.hunting.hunt.defense() && (p.walks.groupWalk.travel?.defenseTargets||[]).some(function(tgt: any){return t.passingKey(tgt)===t.passingKey(target);});
    var attacking=t.isAttackingPartyMember(target);
    if(!defense) delete s.captures[t.passingKey(target)];
    if(!defense && !attacking)return false;
    // A captured target that does not attack the party stays engaged until a Hunt travel control of
    // the current convoy arrives after the capture and no longer lists it (committed or primary); the
    // reply's own convoy and order decide, with no time window.
    if(defense && !attacking){
      var key=t.passingKey(target), capturedAt=s.captures[key] || (s.captures[key]=Date.now());
      var control=typeof p.hunting.hunt.control==='function' && p.hunting.hunt.control();
      if(control && s.huntControlSeenAt>=capturedAt && !(control.committed||[]).concat(control.primary?[control.primary]:[]).some(function(tgt: any){return t.passingKey(tgt)===key;}))return false;
    }
    var deaths = s.groupedCombat && s.groupedCombat.deaths || [];
    // departureTargetEngaged runs for every visible monster that attacks the
    // party on each travel and target check, and the list holds up to 512
    // tombstones (coordinator/targeting/queue.ts), so it indexes the ids that apply
    // here once per list. The coordinator replaces the list or appends to it.
    // A new list, a new length or another realm, map or instance rebuilds the
    // index.
    var instance = String(character.in==null?character.map:character.in), realm = t.view().reunionRealm;
    var context = realm + '|' + character.map + '|' + instance;
    let index = indexes.get(deaths);
    if(!index || index.length !== deaths.length || index.context !== context){
      const ids = new Set<string>();
      deaths.forEach(function(d: any){
        if(d.map===character.map && String(d.in==null?d.map:d.in)===instance && d.server===realm)ids.add(String(d.id));
      });
      const built = {length:deaths.length,context:context,ids:ids};
      indexes.set(deaths,built);
      index = built;
    }
    if(index.ids.has(String(target.id)))return false;
    return true;
    }
  function departureCombatPending() {
    return Object.values(parent.entities||{}).some(function(e: any){return e && e.type==='monster' && t.departureTargetEngaged(e);});
    }
  function defendPartyHit(data: any) {
    // Continuous Hunt returns keep navigation ownership, including under fire.
    if (p.walks.groupWalk.travel && p.walks.groupWalk.travel.continuousReturn === 1) return;
    if(data && t.view().currentPartyList.indexOf(String(data.id))>=0) {
      var aggressor=get_entity(data.hid || data.actor);
      // Native explosion hits can strike a passing party while the monster is
      // fighting another player. Such a splash cannot nominate that player's
      // fight or repeatedly replace our owned route with defense/loot holds.
      // Direct and unknown-target hits retain the conservative safety path.
      var victim=aggressor && aggressor.target && get_entity(aggressor.target);
      var collateral=data.splash===true || data.unintentional===true &&
        Array.isArray(data.stacked) && data.stacked.indexOf(String(data.id))>=0;
      if(collateral && victim && victim.type==='character' && !victim.npc &&
        t.view().currentPartyList.indexOf(String((aggressor as any).target))<0)return;
      var passingRule=aggressor && p.hunting.rares.passive().rules[(aggressor as any).mtype];
      if(aggressor && aggressor.type==='monster' && (!t.isPassingEncounter(aggressor) || t.returnDepartureDefense() && !(passingRule && passingRule.enabled && passingRule.keepMoving)) && !t.view().joinedEventNow && !t.view().eventTargetTypesNow.length) {
        p.root.__partyDefensiveHit={target:t.groupedEntityReport(aggressor),at:Date.now()};
        p.walks.interruptConvoyForDefense(null, null, aggressor);
        if(s.queueClient)s.queueClient.evidence(aggressor,'engaged');
      }
    }
    }
  function isLeader() { return (p.tasks.membership.leader() || character.name) === character.name; }
  // The turns owner's return defence row (the turns owner's H-row `returnCombat`): during the return
  // defence, the Town cast under attack is cancelled, and the row reads whether the character still
  // channels Town; otherwise null (moved from shared.js `turnsPorts`).
  function returnCombatTurn() {
    return t.view().returnCombatActive ? (t.cancelReturnTownUnderAttack(), !!(character.c && (character.c as any).town)) : null;
  }
  return { returnCombatTurn, isCurrentPartyTarget, isPartyThreat, isAttackingPartyMember, getNearestPartyAttacker, getNearestPartyTarget, returnDepartureDefense, returnCombatActive, returnAttacker, returnDefenseTarget, cancelReturnTownUnderAttack, departureTargetEngaged, departureCombatPending, defendPartyHit, isLeader };
}
