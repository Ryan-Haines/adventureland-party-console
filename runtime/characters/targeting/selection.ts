// The character's selection (V1.1 selection.ts): the selected target's state.
import type { Target } from '../turns/api.ts';
import type { SkillsAllowsAsk } from '../../hooks/registry.ts';
import type { TargetingMap, TargetingPorts, TargetingState } from './install.ts';
import { createEntityRefresh } from './queue-client.ts';
import { partyHooks } from '../../hooks/index.ts';
import { eventKey } from '../../events/api.ts';
import { MONSTER_PRIORITY, pick } from './saved-fields.ts';
import { nearerFirst } from './rules.ts';
import type { ScopeHandle } from '../../lifecycle/api.ts';

// The selection's finders and its published state (V1.1 selection.ts), moved whole from
// shared.js. Each reads the facts of other owners through `p`, the owners' doors shared.js hands
// in (`targetingPorts()`), and the targeting owner's own state through `s`.
export function createSelection(t: TargetingMap, p: TargetingPorts, s: TargetingState) {
  // The leader's notices on its own lock target, on the coordinator's clock, for the queue to
  // retire the lock as a lost target.
  function targetingUnreachableReport() {
    var retire = p.root.__partyTargeting && p.root.__partyTargeting.retire;
    return retire && retire.report ? retire.report().map(function (e: any) {
      return Object.assign({}, e, { at: e.at + p.walkState.clockOffset }, e.until ? { until: e.until + p.walkState.clockOffset } : {});
    }) : [];
    }
  function targetRejectionReason(target: any) {
      if (!target) return "selected monster not visible";
      if (!t.leaderLockAllows(target)) return "waiting for fresh leader target";
      if (t.isExternallyClaimedMonster(target)) return "monster claimed outside party";
      return "target outside allowed combat selection";
    }
  function engagedMonster() {
    var current = s.combatTargetId && get_entity(s.combatTargetId);
    if (current && !current.dead && t.isAllowedTarget(current)) return current;
    s.combatTargetId = null;
    var attackers = Object.keys(parent.entities || {}).map(function (id: any) {
      return parent.entities[id];
    }).filter(function (entity: any) {
      return entity && entity.type === "monster" && !entity.dead && entity.target === character.name && t.isAllowedTarget(entity);
    });
    attackers.sort(nearerFirst);
    if (attackers[0]) s.combatTargetId = attackers[0].id;
    return attackers[0] || null;
    }
  function visibleFocusedMonsterWithinRadius() {
    var allTypes = t.view().monsterFocusNow.indexOf("all") >= 0;
    var candidates = Object.keys(parent.entities || {}).map(function (id: any) { return parent.entities[id]; })
      .filter(function (entity: any) {
        return entity && entity.type === "monster" && entity.visible && !entity.dead &&
          (allTypes || t.view().monsterFocusNow.indexOf(entity.mtype) >= 0) && t.isAllowedTarget(entity);
      }).sort(function (a: any, b: any) {
        return Math.hypot(Number(a.x) - character.x, Number(a.y) - character.y) -
          Math.hypot(Number(b.x) - character.x, Number(b.y) - character.y);
      });
    return p.hunting.farm.select(candidates)[0] || null;
    }
  function getLeaderTarget() {
      if (p.walkState.departing || p.bag.fact('bankQueued')) return t.engagedMonster();
      if (p.walks.groupedFollower()) return t.getGroupedTarget();
      if (p.walks.groupWalk.travel) {
        var threatened = s.partyThreats.map(function (threat: any) { return get_entity(threat.id); })
          .filter(function (target: any) { return target && !target.dead && !t.isExternallyClaimedMonster(target); });
        threatened.sort(nearerFirst);
        if (threatened.length) return threatened[0];
      }
      if (!s.leaderTarget) return null;
      var target = get_entity(s.leaderTarget.id);
      // Following the leader is an explicit targeting mode. Personal focus only
      // controls autonomous acquisition and must not veto the leader's target.
      return target && !target.dead && !t.isExternallyClaimedMonster(target) ? target : null;
    }
  function getNearestFocusedMonster(options: any) {
      options = options || {};
      var focusTypes = options.monsterType ? [options.monsterType] : t.view().monsterFocusNow;
      var allTypes = focusTypes.indexOf("all") >= 0;
      var candidates = Object.keys(parent.entities || {}).map(function (id: any) {
        return parent.entities[id];
      }).filter(function (target: any) {
        if (!target || target.type !== "monster" || target.dead || !target.visible) return false;
        if (t.isKnownDead(target.id)) return false;
        if (target.mtype === "fieldgen0" || target.mtype === "tinyp") return false;
        if (t.isExternallyClaimedMonster(target)) return false;
        if (!allTypes && focusTypes.indexOf(target.mtype) < 0) return false;
        return !(s.setAside[target.id] > Date.now());
      });
      if (options.excludePartyTargets) {
        var occupiedTargets: any = {};
        s.partyTargets.forEach(function (target: any) {
          if (target && target.id && target.id !== s.combatTargetId) occupiedTargets[target.id] = true;
        });
        candidates = candidates.filter(function (target: any) { return !occupiedTargets[target.id]; });
      }
      candidates=p.hunting.farm.select(candidates);
      function scatterChoice(list: any) {
        if (!options.excludePartyTargets || list.length < 2) return list[0] || null;
        // Every party member sees the same stable ordering while assembled,
        // then selects a different rank. This avoids the first-tick race where
        // target telemetry has not yet announced anybody's selection.
        list.sort(function (a: any, b: any) {
          return String(a.id).localeCompare(String(b.id)) || Number(a.x) - Number(b.x) || Number(a.y) - Number(b.y);
        });
        var scatterMembers = s.partyPositions.filter(function (member: any) {
          return member && !member.rip && member.ctype !== "merchant" && member.map === character.map;
        }).map(function (member: any) { return member.name; });
        if (scatterMembers.indexOf(character.name) < 0) scatterMembers.push(character.name);
        scatterMembers.sort();
        var rank = Math.max(0, scatterMembers.indexOf(character.name));
        return list[rank % list.length];
      }
      // Priority is absolute between selected monster types. Apply the
      // contested/nearest rules only within the highest-priority tier.
      if (candidates.length) {
        var highestPriority = candidates.reduce(function (highest: any, target: any) {
          return Math.max(highest, t.monsterPriority(target));
        }, -Infinity);
        candidates = candidates.filter(function (target: any) {
          return t.monsterPriority(target) === highestPriority;
        });
      }
      candidates.sort(nearerFirst);
      // An add-on's order goes before distance, inside the top priority only.
      var targetingHooks = p.root.__partyHooks && p.root.__partyHooks.targeting;
      if (candidates.length > 1 && targetingHooks && targetingHooks.orders()) {
        var v = t.view();
        candidates = targetingHooks.prefers({ candidates: candidates, character: v.character, entities: v.entities, party: v.party }).slice();
      }
      if (candidates.length) return options.excludePartyTargets ? scatterChoice(candidates) : candidates[0];
      // Outside the configured local decision radius, retain the game's path-
      // checked nearest lookup so a sparse spawn can still be approached.
      var typeOptions = allTypes ? [null] : focusTypes.slice().sort(function (a: any, b: any) {
        var ap = Number.isFinite(Number(s.monsterPriorities[a])) ? Number(s.monsterPriorities[a]) : MONSTER_PRIORITY.unset;
        var bp = Number.isFinite(Number(s.monsterPriorities[b])) ? Number(s.monsterPriorities[b]) : MONSTER_PRIORITY.unset;
        return bp - ap;
      });
      var distant = typeOptions.map(function (type: any) {
        var query: any = { path_check: true, no_target: true };
        if (type) query.type = type;
        return get_nearest_monster(query);
      }).filter(function (target: any) { return target && !t.isExternallyClaimedMonster(target); }).sort(function (a: any, b: any) {
        return t.monsterPriority(b) - t.monsterPriority(a) || nearerFirst(a, b);
      });
      return distant.find(function (target: any) { return target.mtype !== "fieldgen0" && target.mtype !== "tinyp" &&
        (p.hunting.facts.focus.contains(target, t.view().targetScope) || p.hunting.facts.focus.inRadius(target)) && !(s.setAside[target.id]>Date.now()); }) || null;
    }
  function getPreferredTarget() {
      if (t.view().rareTarget) return t.view().rareTarget;
      if (p.walkState.townTraveling || p.walkState.townActive) return null;
      var current = t.engagedMonster();
      if (current && t.isAllowedTarget(current)) return current;
      if (p.walkState.departing || p.bag.fact('bankQueued')) return null;
      var interruptedTarget = s.scatterBreakTarget && get_entity(s.scatterBreakTarget.id);
      if (interruptedTarget && !interruptedTarget.dead && !t.isExternallyClaimedMonster(interruptedTarget)) return interruptedTarget;
      if (p.walks.groupWalk.travel) {
        var convoyTargets = s.partyThreats.map(function (threat: any) { return get_entity(threat.id); })
          .filter(function (target: any) { return target && !target.dead && !t.isExternallyClaimedMonster(target); });
        convoyTargets.sort(nearerFirst);
        // Passive monsters never enter partyThreats. convoyThreatActive()
        // deliberately yields route ownership for a visible configured target,
        // so the selector must be able to acquire that same target or the
        // character deadlocks in `convoy-combat` with `no-target`.
        return convoyTargets[0] || t.getNearestFocusedMonster();
      }
      var defenders = s.partyThreats.map(function (threat: any) {
        return get_entity(threat.id);
      }).filter(function (target: any) { return target && !target.dead && !t.isExternallyClaimedMonster(target); });
      defenders.sort(function (a: any, b: any) {
        var adx = a.x - character.x, ady = a.y - character.y;
        var bdx = b.x - character.x, bdy = b.y - character.y;
        return t.monsterPriority(b) - t.monsterPriority(a) ||
          adx * adx + ady * ady - (bdx * bdx + bdy * bdy);
      });
      if (defenders.length) return defenders[0];
      return t.getNearestFocusedMonster();
    }
  function getScatterTarget() {
      if (p.walkState.townTraveling || p.walkState.townActive) return null;
      var current = t.engagedMonster();
      if (current && t.isAllowedTarget(current)) return current;
      if (p.walkState.departing || p.bag.fact('bankQueued')) return null;
      // Scatter is scoped to one learned monster type, but target priority is
      // stronger than that scope. If a selected higher-priority type appears,
      // acquire it so the coordinator can return the whole party to default
      // mode and converge after each member finishes its current target.
      var priorityCandidate = t.getNearestFocusedMonster({ excludePartyTargets: true });
      var scatterTypePriority = t.monsterPriority({ mtype: t.view().partyFarmingMonsterTypeNow });
      if (priorityCandidate && t.monsterPriority(priorityCandidate) > scatterTypePriority)
        return priorityCandidate;
      // In scatter mode only defend the character under attack;
      // converging on another member's target defeats the purpose of fanning out.
      var ownAttacker = Object.keys(parent.entities || {}).map(function (id: any) {
        return parent.entities[id];
      }).filter(function (target: any) {
        return target && target.type === "monster" && target.visible && !target.dead &&
          target.target === character.name && t.isAllowedTarget(target);
      }).sort(function (a: any, b: any) {
        return t.monsterPriority(b) - t.monsterPriority(a) ||
          nearerFirst(a, b);
      })[0];
      return ownAttacker || t.getNearestFocusedMonster({ excludePartyTargets: true,
        monsterType: t.view().partyFarmingMonsterTypeNow || null });
    }
  function getCloserHuntTarget(current: any) {
      if (!t.view().huntCombatTargetNow || !current || current.mtype!==t.view().huntCombatTargetNow || t.view().groupedFarming ||
          t.view().activeCombatEvent || t.view().joinedEventNow || t.view().travelCombatActive || t.isAttackingPartyMember(current)) return null;
      var distance = function(t: any) { return Math.hypot(t.x-character.x,t.y-character.y); };
      var targets = Object.values(parent.entities || {}).filter(function(tgt: any) {
        return tgt && tgt.type==='monster' && tgt.visible && !tgt.dead && tgt.hp>0 && tgt.mtype===t.view().huntCombatTargetNow &&
          tgt.id!==current.id && distance(tgt)<distance(current) && distance(tgt)<=p.hunting.farm.radius() &&
          (!tgt.map || tgt.map===character.map) && (tgt.in===undefined || tgt.in===character.in) && t.isAllowedTarget(tgt) &&
          (t.view().farmingModeNow!=='scatter' || !s.partyTargets.some(function(p: any){return p.id===tgt.id;}));
      });
      targets.sort(function(a: any,b: any){return distance(a)-distance(b);});
      return targets[0] || null;
    }
  function getPriorityEventTarget() {
      // K1's `priority` column names the events whose target a joined member takes first.
      return eventKey(t.view().joinedEventNow)?.priority ? t.nearestEventTarget() : null;
    }
  function getGroupedTarget() {
      if (!t.view().groupedFarming && t.view().rareTarget) return t.view().rareTarget;
      var lock = t.currentQueue() ? s.groupedCombat.target : s.leaderCombatSelection;
      var target = lock && lock.id && get_entity(lock.id);
      if (target && target.visible && !target.dead && t.isAllowedTarget(target) &&
          (!t.view().unfinishedFight || is_in_range(target))) return target;
      return t.groupedDefensiveTarget() || (target && target.visible && !target.dead && t.isAllowedTarget(target) ? target : null);
    }
  function hasScatterBreakTarget() {
      var target = s.scatterBreakTarget && get_entity(s.scatterBreakTarget.id);
      return !!(target && !target.dead && !t.isExternallyClaimedMonster(target));
    }
  function getScatterBreakTarget() {
      var target = s.scatterBreakTarget && get_entity(s.scatterBreakTarget.id);
      return target && !target.dead && !t.isExternallyClaimedMonster(target) ? target : null;
    }
  function setCombatTarget(target: any) {
      t.publishCombatSelection(target, false);
      s.combatTargetId = target && target.id || null;
      // Melee classes retain a visible selection while the shared safety rule blocks attacks
      // or the equipment controller switches to a bow. The target call is the targeting
      // owner's, which asks the call budget first.
      if (target && target.mtype === "porcupine" &&
          character.target !== target.id && s.targetingChangeTarget) s.targetingChangeTarget(target);
      if (target && target.mtype) {
        p.hunting.farm.noteType(target.mtype);
        p.root.__partyLastFarmingMonsterType = target.mtype;
      }
    }
  function publishCombatSelection(target: any, clear: any) {
    if (character.name !== (t.currentQueue() ? s.groupedCombat.targetLeader : p.tasks.membership.leader())) return;
    if (t.view().unfinishedFight) return; // Only coordinator death evidence releases a fight.
    if (!target && !clear) return; // Missing from view is not a new selection.
    var id = target && target.id || null, map = target ? character.map : null;
    if (s.combatSelection.id !== id || s.combatSelection.map !== map) {
      s.combatSelection = { id: id, map: map, revision: s.combatSelection.revision + 1 };
    }
    }
  function sharedTargetId(){return t.view().groupedFarming && s.groupedCombat && s.groupedCombat.target && s.groupedCombat.target.id || null;}
  function combatTargetRevision() {
      if (t.view().dungeonOwned) return "dungeon:" + ((character as any).cave && (character as any).cave.run || character.in) + ":" + s.combatTargetId;
      if (t.currentQueue()) return s.groupedCombat.selection;
      var lock = p.walks.groupedFollower() ? s.leaderCombatSelection : s.combatSelection;
      return lock ? String(lock.runtimeId || p.walkState.runtimeId) + ":" + lock.revision : null;
    }
  function noteAttack(target: any) {
      if (t.isExternallyClaimedMonster(target)) s.combatTargetId = null;
      s.lastAttackAt = Date.now();
      s.lastAttackTarget = target && target.id || null;
      var timing=p.root.__partyQueueTiming;
      if(timing && target && timing.target===target.id && !timing.firstAttackAt){timing.firstAttackAt=Date.now();timing.deathToAttackMs=timing.deathAt ? Date.now()-timing.deathAt : null;}
    }
  // S6 and S9's class role choices, moved from runtime/characters/roles/default.ts and
  // turns/classes/warrior.ts and merchant.ts: the merchant fights event monsters only, the warrior pulls
  // what attacks the party, and every other class takes the default choice.
  function defaultClassTarget() {
    const scatterBreak = t.getScatterBreakTarget();
    if (t.hasScatterBreakTarget()) {
      const currentTarget = t.engagedMonster();
      if (currentTarget) return currentTarget;
      if (scatterBreak) return scatterBreak;
    }
    const eventTarget = t.nearestEventTarget();
    if (eventTarget) return eventTarget;
    if (t.view().getFarmingMode === "scatter") return t.getScatterTarget();
    return p.tasks.holds.shouldFollowLeader() ? t.getLeaderTarget() || t.engagedMonster() : t.getPreferredTarget();
  }
  function warriorPartyTarget() {
    return t.nearestEventTarget() || t.getNearestPartyAttacker() || t.getNearestPartyTarget() ||
      (p.tasks.holds.shouldFollowLeader() ? t.getLeaderTarget() || t.engagedMonster() : t.getPreferredTarget());
  }
  function warriorClassTarget() {
    const scatterBreak = t.getScatterBreakTarget();
    if (t.hasScatterBreakTarget()) {
      const currentTarget = t.engagedMonster();
      if (currentTarget || scatterBreak) return currentTarget || scatterBreak;
    }
    if (t.view().getFarmingMode === "scatter") return t.nearestEventTarget() || t.getScatterTarget();
    return warriorPartyTarget();
  }
  function classTarget() {
    if (character.ctype === "merchant") return t.nearestEventTarget();
    return character.ctype === "warrior" ? warriorClassTarget() : defaultClassTarget();
  }
  return { classTarget, targetingUnreachableReport, targetRejectionReason, engagedMonster, visibleFocusedMonsterWithinRadius, getLeaderTarget, getNearestFocusedMonster, getPreferredTarget, getScatterTarget, getCloserHuntTarget, getPriorityEventTarget, getGroupedTarget, hasScatterBreakTarget, getScatterBreakTarget, setCombatTarget, publishCombatSelection, sharedTargetId, combatTargetRevision, noteAttack };
}

// What the role runner hands the selection pass: the turns owner's the spend table ask and its attack family's
// flight target, the class role, the realm, the retire's pass, the overkill skip and the bow swap.
export interface SelectionDeps {
  root: any;
  allows(ask: SkillsAllowsAsk): boolean;
  // The other installs the runner resets with the selection (the turns executor and the queue client).
  reset(): void;
  retire(): { pass(): void } | null;
  // The overkill skip (3.7) of the installed owner, read in both selection checks.
  covers(target: Target): boolean;
  equipment(): { tick(target: unknown, damageType: unknown, range: number, enabled: boolean): void } | null;
  notify(hook: 'targeting.changed' | 'targeting.passed', payload: Record<string, unknown>): void;
  follow(ask: { character: string }): Promise<unknown>;
  errorReason(error: unknown): unknown;
}
// The selection pass (V1.4: table S's rows in today's order, the keep check and the target timer),
// moved from the role runner (runner.ts:84-85, :179-305, :502-505). The runner keeps its install line
// and binds each name it hands the turns owner and the movement tick to this pass.
export function createSelectionPass(t: TargetingMap, p: TargetingPorts, d: SelectionDeps) {
  // The attack family's flight target (`skills.ready`): selection keeps a started target and Cave
  // recovery waits for one.
  const engaged = (): string | null => (partyHooks().turns.ready('attack') as { target?: string | null } | undefined)?.target ?? null;
  let selecting = false, active = true, generation = 0;
  // The target timer, on targeting's run scope handle `act`, so table P holds it.
  let act: ScopeHandle | null = null, timer: number | null = null;
  let selectedTarget: string | null = null;
  let invalidated = true;
  // The selected target the rejection rule last re-picked, until a read accepts a target.
  let repicked: string | null = null;
  // A confirmed dead id stays known while the client can still show it (V3.1 #11, N3).
  // It lives in targeting's state; each runner install starts it empty.
  const killed: Map<string, number> = t.state.killed;
  killed.clear();
  const entityRefresh = createEntityRefresh({
    now: () => Date.now(),
    request: () => {
      const host = parent as unknown as { socket?: { connected: boolean; emit(event: string, data: object): void } };
      // The snapshot request asks the call budget's `job` band; a refused one waits for the next
      // gap, as a request with no socket does.
      if (!host.socket?.connected || partyHooks().calls.band({ band: 'job', method: 'send_updates' }) !== 'send') return false;
      host.socket.emit('send_updates', {});
      return true;
    },
    report: diagnostic => { d.root.partyCombatState.entityRefresh = diagnostic; },
  });
  function targetRejection(target: Target | null | undefined): string | null {
    if (!target || !target.visible) return "selected monster not visible";
    if (target.dead || target.rip) return "selected monster died";
    if (target.map && target.map !== character.map) return "selected monster on another map";
    if (!t.isAllowedTarget(target)) return t.targetRejectionReason(target) ?? "target rejected";
    if (d.covers(target)) return "the character's own hit in flight covers its HP";
    return null;
  }
  function eligibleSelection(target: Target | null): Target | null {
    return target && target.visible && !target.dead && t.isAllowedTarget(target) && !d.covers(target) ? target : null;
  }
  function reportError(error: unknown) {
    const reason = d.errorReason(error);
    if (reason !== "cooldown") {
      d.root.partyCombatState.error = String(reason);
      d.root.partyCombatState.errorAt = Date.now();
    }
  }
  // The passing target: the spend table's passing column lets a passing attack go. During Franky no passing target
  // is taken.
  function passingTarget(): Target | null {
    if (!d.allows({ rank: 'damage', passing: true }) || t.view().frankyCombatActive) return null;
    const target = t.passingTarget() || null;
    return target && t.consoleDrainAllows(target) ? target : null;
  }
  function attackTarget(): Target | null {
    const current = currentTarget(), passing = passingTarget();
    if (!current) return passing;
    if (!passing) return current;
    return t.monsterPriority(passing) > t.monsterPriority(current) ? passing : current;
  }
  function currentTarget(): Target | null {
    if (t.view().returnCombatActive) return d.allows({ rank: 'damage' }) ? t.returnDefenseTarget() || null : null;
    let reason: string | null = null;
    const target = selectedTarget ? get_entity(selectedTarget) as unknown as Target | null : null;
    if (!d.allows({ rank: 'damage' })) reason = "combat paused by movement or activity owner";
    else if (!selectedTarget) reason = "no selected target";
    else reason = killed.has(selectedTarget) ? "confirmed dead" : targetRejection(target);
    if (d.root.partyCombatState) {
      d.root.partyCombatState.targetRejection = reason;
      d.root.partyCombatState.selectedTarget = selectedTarget || null;
    }
    // A selected target the rejection rule refuses is re-picked at once, as an invalidation is, in
    // place of waiting for the target timer. A re-pick that selects the same refused target again
    // waits for the timer: the selection runs inside the read, so a read in the selection's own
    // notices would re-pick it on every microtask and the page would never run another task.
    const refused = !!selectedTarget && reason !== null && reason !== "combat paused by movement or activity owner";
    if (!reason) repicked = null;
    if (refused && !invalidated && repicked !== selectedTarget) { repicked = selectedTarget; invalidated = true; void selectTarget(); }
    return reason ? null : target || null;
  }
  // S1, the Manual hand: with Combat on, a character on Manual fights the target the player picked
  // in the game client first, and its own pick only while that pick is in range: the console never
  // moves it there (movement holds a character on Manual).
  function manualTarget(): Target | null {
    const own = character.target ? get_entity(character.target) as unknown as Target | null : null;
    if (own && own.type === "monster" && !own.dead) return own;
    // Its own pick: the party's grouped target when there is one, else its role's own choice
    // (a character on Manual is no member of the grouped pull, so it often has none).
    const pick = priorityEventTarget() || (t.view().groupedFarming ? t.getGroupedTarget() : null) || t.classTarget();
    return pick && is_in_range(pick as never) ? pick : null;
  }
  // The drain row: a monster the drain allows (gates.ts `consoleDrainAllows`: listed, or attacking
  // the party), live, visible, on this map and instance, not known dead, and not another party's
  // unless it attacks ours; the party's attackers first, then the nearest.
  function drainTarget(): Target | null {
    const entities: any[] = Object.values(t.view().entities as Record<string, any>);
    const live = entities.filter(e => t.drainTargetValid(e) && (!t.isExternallyClaimedMonster(e) || t.isAttackingPartyMember(e)));
    const far = (e: any) => Math.hypot(e.x - character.x, e.y - character.y);
    live.sort((a, b) => Number(t.isAttackingPartyMember(b)) - Number(t.isAttackingPartyMember(a)) || far(a) - far(b));
    return live[0] ?? null;
  }
  const sourceFacts = { manual: manualTarget, drain: drainTarget };
  // The S2 row's target, read by the keep check.
  function priorityEventTarget(): Target | null {
    return t.exclusiveCombat() ? null : t.getPriorityEventTarget() || null;
  }
  // A pass's publish, in two halves. `settle` writes the selection under the pass's view: `exclusive`
  // is S's exclusive column as the pass read it, and `row` the S or K row that supplied the target.
  // `announce` runs once the view is closed, so each listener reads facts of its own.
  interface Settled { from: string | null; to: string | null; row: string | null; follow: boolean }
  function settle(target: Target | null, exclusive: boolean, row: string | null): Settled {
    const from = selectedTarget;
    selectedTarget = target?.id || (!exclusive && t.sharedTargetId()) || null;
    t.setCombatTarget(target);
    // Under Follows me a member with no target follows the character on Manual, grouped or not;
    // movement's follow decides the distance (movement/rules.ts FOLLOW_DISTANCE).
    const follow = !target && !exclusive && t.view().getFarmingMode !== "scatter" && (!t.view().groupedFarming || !!p.tasks.holds.followsManual());
    return { from, to: selectedTarget, row, follow };
  }
  async function announce(s: Settled): Promise<void> {
    // (C-S1; payload): the published selection runs a turns pass.
    d.notify('targeting.changed', { character: character.name, from: s.from, to: s.to, row: s.row, by: 'core:targeting' });
    // Every pass's publish tells its end, the change or not.
    d.notify('targeting.passed', { character: character.name, target: s.to, row: s.row, by: 'core:targeting' });
    if (s.follow) await d.follow({ character: character.name });
  }
  // The retire: an unreachable target leaves the selection with no killed-list entry, and a
  // pass picks again.
  function dropTarget(id: string): void {
    if (selectedTarget !== id) return;
    selectedTarget = null;
    invalidated = true;
    void selectTarget();
  }
  async function selectTarget(): Promise<void> {
    d.retire()?.pass();
    if (selecting || !active) return;
    if (!d.allows({ rank: 'damage' })) {
      selectedTarget = null;
      t.setCombatTarget(null);
      t.publishCombatSelection(null, true);
      return;
    }
    // One view holds the pass's facts from the keep check to the publish's write.
    const step = t.withView((): { settled?: Settled; closer?: boolean; epoch?: number } | null => {
      const current = currentTarget();
      // K2: a draining console keeps the current target.
      if (t.view().drain && current) return null;
      const exclusive = t.exclusiveCombat();
      // K1: the closer Hunt target.
      const closer = !exclusive && current && engaged() !== current.id && t.getCloserHuntTarget(current);
      if (closer) {
        p.walks.resetCombatMovement();
        return { closer: true, settled: settle(closer, exclusive, 'K1') };
      }
      // The keep check: a selection is kept while the row that supplied it would supply it again.
      if (!t.view().returnCombatActive && !invalidated && current) {
        const priorityEvent = priorityEventTarget();
        const rare = t.view().dungeonOwned ? null : t.view().rareTarget;
        // During Franky the nominating row is the event target, so a changed event target re-picks.
        const franky = !t.view().dungeonOwned && !!t.view().frankyCombatActive;
        const nominated = t.view().dungeonOwned ? t.getDungeonTarget() : franky ? t.nearestEventTarget() : t.view().groupedFarming ? t.getGroupedTarget() : null;
        if ((!priorityEvent || priorityEvent.id === selectedTarget) && (!rare || rare.id === selectedTarget) && (!(t.view().dungeonOwned || franky || t.view().groupedFarming) || nominated?.id === selectedTarget)) return null;
      }
      invalidated = false;
      selecting = true;
      const epoch = generation;
      try {
        // An add-on's `targeting.candidates` answer is asked inside the eligibility check, one
        // monster per ask, so every finder skips what an add-on refuses.
        const { target: selected, row } = t.sourceTarget(sourceFacts);
        if (!(active && epoch === generation) || !d.allows({ rank: 'damage' })) return { epoch };
        const target = selected && !killed.has(selected.id) ? eligibleSelection(selected) : null;
        return { epoch, settled: settle(target, exclusive, row) };
      } catch (error) {
        reportError(error);
        return { epoch };
      }
    });
    if (!step) return;
    // Both branches announce inside the try, so a throw from the follow or a `targeting.changed`
    // listener reaches reportError. The closer Hunt branch never set `selecting`, so it skips the reset.
    try {
      if (step.settled) await announce(step.settled);
    } catch (error) {
      reportError(error);
    } finally {
      if (!step.closer && step.epoch === generation) { selecting = false; if (invalidated && active) void selectTarget(); }
    }
  }
  function equipmentTick() {
    const actor = character as typeof character & { damage_type?: string };
    d.equipment()?.tick(t.equipmentTarget(), actor.damage_type, Number(character.range), d.allows({ rank: 'damage' }));
  }
  // The target timer's pass (W3 `targetPassMs`): a confirmed dead id leaves the killed list once the
  // client no longer shows it, then a selection runs.
  function timerPass() {
    const entities = (parent as unknown as { entities?: Record<string, unknown> }).entities ?? {};
    for (const id of [...killed.keys()]) if (!entities[id]) killed.delete(id);
    void selectTarget();
  }
  return {
    selectTarget, currentTarget, attackTarget, passingTarget, dropTarget, equipmentTick, reportError,
    selected: () => selectedTarget,
    // `targeting.target`'s "a selection is due".
    due: () => active && d.allows({ rank: 'damage' }) && (selecting || invalidated),
    epoch: () => generation,
    refresh: () => entityRefresh.tick({ enabled: d.allows({ rank: 'damage' }), context: JSON.stringify([character.map, character.in]),
      target: selectedTarget, retainedTarget: t.sharedTargetId() || null, accepted: d.root.partyCombatState.attackTiming?.accepted || 0 }),
    // A selected target the rejection rule refuses is re-picked by `currentTarget` itself.
    reselect: currentTarget,
    hasStartedTarget: (id: string) => engaged() === id,
    engagedTargetId: engaged,
    isKnownDead: t.isKnownDead,
    invalidateTarget(id?: string) {
      if (id) killed.set(id, Date.now());
      if (!id || id === selectedTarget) { invalidated = true; void selectTarget(); }
    },
    wake() { void selectTarget(); },
    advanceTarget() { generation++; selectedTarget = null; invalidated = true; selecting = false; },
    resetTargeting() { generation++; selectedTarget = null; invalidated = true; selecting = false; d.reset(); },
    // A death ends the selection's generation (the respawn timer's reset).
    respawned() { generation += 1; selectedTarget = null; selecting = false; },
    start(handle: ScopeHandle) {
      active = true; act = handle;
      timer = act.setInterval(timerPass, pick('targetPassMs'));
    },
    stop() { active = false; generation += 1; selectedTarget = null; act?.clearInterval(timer); act = null; timer = null; },
  };
}
export type SelectionPass = ReturnType<typeof createSelectionPass>;
