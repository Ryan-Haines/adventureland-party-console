// The event, Franky and Cave target finders, over the events owner's character facts (api.ts `eventFacts()`,
// E04-06a) and the Cave facts 07 answers (`farming.focus`, `cave.state`).
import { nearerFirst } from './rules.ts';
import type { TargetingMap, TargetingPorts, TargetingState } from './install.ts';
import { eventFacts } from '../../events/api.ts';

// Moved whole from shared.js.
export function createEvents(t: TargetingMap, p: TargetingPorts, s: TargetingState) {
  function dungeonTargetAllowed(target: any) {
    return !!target && target.type === 'monster' && target.visible !== false && !target.dead && target.hp > 0 &&
      (!target.map || target.map === character.map) && (target.in == null || target.in === character.in) &&
      !t.isKnownDead(target.id) &&
      (target.cave && (['enemy', 'predator'].includes(target.cave.side) ||
        ['duel_left', 'duel_right'].includes(target.cave.side) &&
          ((get_entity(target.target) as any)?.cave?.side === 'ally' || t.dungeonEncounterEnemy(target))) ||
       target.target === character.name || p.hunting.cave.partyNames().includes(target.target));
    }
  function getDungeonTarget() {
    if (!(character as any).cave || (character as any).cave.paused || !t.groupedFresh() || !s.groupedCombat.target) return null;
    var target = get_entity(s.groupedCombat.target.id);
    // A committed fight owns combat recovery even when terrain blocks its
    // direct bearing. Keep the stricter threat test for new travel handoffs.
    var committed = s.groupedCombat.caveScope === (character as any).cave.run + ':' + (character as any).cave.floor &&
      s.groupedCombat.committed === true && s.groupedCombat.target.state === 'engaged';
    return t.dungeonTargetAllowed(target) && (committed || t.dungeonCombatThreat(target)) ? target : null;
    }
  function dungeonCombatThreat(target: any) {
    if (!t.dungeonTargetAllowed(target)) return false;
    if (p.hunting.cave.partyNames().includes(target.target)) return true;
    if (t.dungeonEncounterEnemy(target) && distance(character,target) <= 400 && can_move_to(target.x,target.y)) return true;
    return distance(character, target) <= Math.max(80, Number(target.range || 0) + 25) && can_move_to(target.x, target.y);
    }
  function dungeonEncounterEnemy(target: any) {
    var choice = (character as any).cave?.choice, scene = choice?.scene || [];
    if (!choice?.resolved) return false;
    var actor = scene.find(function(a: any) { return String(a.id) === String(target.id); });
    return !!actor && (actor.side === 'enemy' || actor.side === 'predator' ||
      ['duel_left','duel_right'].includes(actor.side) && scene.some(function(a: any) { return a.side === 'ally'; }));
    }
  function frankyTargetAllowed(target: any) {
    if (eventFacts().fightsAdds("franky") && eventFacts().bossAdd("franky", target) && target.visible !== false && !target.dead && target.hp !== 0 &&
      (!target.map || target.map === character.map) && (target.in == null || target.in === character.in)) return true;
    return !!target && target.type === "monster" && (target.mtype === "franky" || t.frankyAttacker(target)) &&
      target.visible !== false && !target.dead && target.hp !== 0 &&
      (!target.map || target.map === character.map) && (target.in == null || target.in === character.in);
    }
  // 1.5 row 7: a spawn of Franky's that `event.targets()` names and that targets this
  // character is fought during Franky, before the boss.
  function frankyAttacker(target: any) {
    return !!target && target.target === character.name && eventFacts().attackers("franky").includes(target.mtype);
    }
  function nearestEventTarget() {
    var events = eventFacts(), travelling = events.travellingEventName();
    if (t.view().joinedEventNow && !events.selected(t.view().joinedEventNow) || travelling && !events.selected(travelling)) return null;
    if (t.view().frankyCombatActive) {
      var bosses = Object.values(parent.entities || {}).filter(t.frankyTargetAllowed);
      var attackers = bosses.filter(t.frankyAttacker);
      if (attackers.length) bosses = attackers;
      var retained = bosses.find(function (target: any) { return target.id === s.combatTargetId; });
      bosses.sort(function (a: any, b: any) {
        return nearerFirst(a, b) || String(a.id).localeCompare(String(b.id));
      });
      return retained || bosses[0] || null;
    }
    if (events.liveAbtesting()) return events.nearestOpponent();
    // Special/cooperative event bosses are not always returned by the normal
    // path-checked monster selector even when their live entity is visible.
    // Inspect the entity table directly and preserve eventTargetTypes order so
    // each event's declared monster priority is retained.
    var targets = Object.keys(parent.entities || {}).map(function (id: any) {
      return parent.entities[id];
    }).filter(function (entity: any) {
      return entity && entity.type === "monster" && entity.visible !== false && !entity.dead && entity.hp!==0 &&
        (!entity.map || entity.map===character.map) && (entity.in==null || entity.in===character.in) &&
        t.view().eventTypesHere.indexOf(entity.mtype) >= 0;
    });
    if (t.view().joinedEventNow === "mrgreen" || t.view().joinedEventNow === "mrpumpkin" || t.view().joinedEventNow === "horseman") {
      var boss = targets.find(function (entry: any) { return entry.mtype === t.view().joinedEventNow; });
      var sight = boss || events.freshSighting(t.view().joinedEventNow);
      var adds = targets.filter(function (entry: any) {
        // Horseman trash always takes priority, including a newly visible wave
        // while the boss is already selected. No guessed HP threshold is needed.
        if (t.view().joinedEventNow === "horseman") return entry.mtype === "jackowalker";
        return entry.mtype !== t.view().joinedEventNow && !t.isExternallyClaimedMonster(entry) &&
          (entry.master != null ? boss && String(entry.master) === String(boss.id) :
            sight && Math.hypot(entry.x - sight.x, entry.y - sight.y) <= 400);
      });
      if (adds.length) {
        var leaderReport = s.partyPositions.find(function (member: any) {
          return member.name === p.tasks.membership.leader() && member.server === t.view().reunionRealm && member.map === character.map &&
            member.in === character.in && p.movement.fresh(member.seenAt, Date.now() + p.walkState.clockOffset);
        });
        var leaderAdd = leaderReport && s.leaderTarget && adds.find(function (entry: any) { return entry.id === s.leaderTarget.id; });
        var retainedAdd = adds.find(function (entry: any) { return entry.id === s.combatTargetId; });
        adds.sort(function (a: any,b: any) { return String(a.id).localeCompare(String(b.id)); });
        return leaderAdd || retainedAdd || adds[0];
      }
    }
    // The map's area event is the events owner's K1 `targets.area` row (`event.targets()`).
    var gooBrawl = t.view().joinedEventNow === "goobrawl" || events.eventTargets().area === "goobrawl";
    if (gooBrawl) {
      // Farm whichever ordinary goo is nearest until Rainbow Goo appears.
      // As soon as it is visible, exclude every filler so the entire party
      // abandons its current goo and focuses the event boss.
      var rainbow = targets.filter(function (target: any) { return target.mtype === "rgoo"; });
      if (rainbow.length) {
        rainbow.sort(nearerFirst);
        return rainbow[0];
      }
      targets = targets.filter(function (target: any) { return target.mtype !== "rgoo"; });
      // Goo Brawl rewards piling onto live targets. Prefer the leader's target,
      // then whichever goo has the most party selections, instead of applying
      // ordinary uncontested/scatter behavior or changing to each tick's
      // nearest goo. This also retains a personal target before telemetry has
      // caught up, eliminating short back-and-forth closing moves.
      var leaderChoice = s.leaderTarget && targets.find(function (target: any) {
        return target.id === s.leaderTarget.id;
      });
      if (leaderChoice) return leaderChoice;
      var partyCounts: any = {};
      s.partyTargets.forEach(function (partyTarget: any) {
        if (partyTarget && partyTarget.id) partyCounts[partyTarget.id] = (partyCounts[partyTarget.id] || 0) + 1;
      });
      var partyChoices = targets.filter(function (target: any) { return partyCounts[target.id]; });
      partyChoices.sort(function (a: any, b: any) {
        return partyCounts[b.id] - partyCounts[a.id] || String(a.id).localeCompare(String(b.id));
      });
      if (partyChoices.length) return partyChoices[0];
      var current = s.combatTargetId && targets.find(function (target: any) { return target.id === s.combatTargetId; });
      if (current) return current;
      targets.sort(nearerFirst);
      return targets[0] || null;
    }
    targets.sort(function (a: any, b: any) {
      var typePriority = t.view().eventTargetTypesNow.indexOf(a.mtype) - t.view().eventTargetTypesNow.indexOf(b.mtype);
      return typePriority || nearerFirst(a, b);
    });
    return targets[0] || null;
    }
  return { dungeonTargetAllowed, getDungeonTarget, dungeonCombatThreat, dungeonEncounterEnemy, frankyTargetAllowed, frankyAttacker, nearestEventTarget };
}
