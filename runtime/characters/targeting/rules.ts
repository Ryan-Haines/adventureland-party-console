// The targeting owner's rules (V1.1 rules.ts): tables A, M and S as rows, the group lock and
// the claims, the one place targeting decides which monster a character takes and whether it may hit
// it. Each row reads its facts from the pass's view (view.ts), so a fact is read once per pass.
import type { Target } from '../turns/api.ts';
import type { TargetingMap, TargetingPorts, TargetingState } from './install.ts';
import { MONSTER_PRIORITY, pick } from './saved-fields.ts';
import { eventFacts } from '../../events/api.ts';
import { hitsAroundCaster } from '../turns/api.ts';
import { handsCombatOver } from '../../movement/api/character.ts';
import { currentQueue as speaksQueue } from '../../protocol/reports.ts';
import type { TargetingView } from './view.ts';
import type { CandidatesView } from '../../hooks/registry.ts';

// One target's identity across the queue, its claims, deaths, snapshot, lost and unseen records and
// the successor grant: the coordinator's queue and the character's queue client both key a target by it.
export const targetIdentity=(t:{id:string;server?:string;map:string;in?:string|number})=>JSON.stringify([t.server,t.map,t.in,String(t.id)]);
// The finders' distance order, nearer to this character first; every nearest-target finder sorts by it.
export function nearerFirst(a: any, b: any): number {
  return Math.hypot(a.x - character.x, a.y - character.y) - Math.hypot(b.x - character.x, b.y - character.y);
}
// The rare types M's priority rows rank at 100 while a rare runs, written once.
export const RARE_TYPES = ["phoenix", "goldenbat", "cutebee", "hen", "rooster"];
// A Phoenix the patrol reports ranks between a running rare and tinyp, so a
// patrol sighting outranks every other rare and never a tinyp.
export const PHOENIX_CANDIDATE_PRIORITY = 100.5;
// V3.3's list bounds, at today's values, each named once. Each list rides on every queue report, so
// its bound keeps the report's size flat whatever the party meets.
export const LIST_BOUNDS = {
  // The queue client's evidence events and the evidence the queue returns.
  events: 256,
  // The admission's open proposals (passing-admission.ts:68).
  proposals: 128,
  // The passing encounters one report carries, merged or retained (passing.ts:46).
  passing: 128,
  // The queue's death tombstones (queue.ts:32).
  tombstones: 512,
  // The diagnostics traces, read on demand: the client's evidence trace and the queue's transitions.
  clientTrace: 32, queueTrace: 99,
} as const;
// The formation range evaluateGroup measures each member against (v1.5.0
// grouped.ts:64:84): the healer's range less an inset of `insetShare` of it, held between `insetMin`
// and `insetMax`, or `noHealer` with no healer. A recovering member counts as back within the range
// less `rejoinInset`, never under `rejoinInset`.
export const GROUP_RANGE = { insetShare: 0.1, insetMin: 8, insetMax: 20, noHealer: 150, rejoinInset: 10 } as const;
// The queue's depth: the target, its successor and one more (v1.5.0
// locked-pair.ts:12:22).
export const QUEUE_DEPTH = 3;
// A pursuit sample shows progress once the member moved `move` and closed `close` of its deficit,
// coverage or waypoint. Outside a Hunt a closer candidate must be `closer` nearer than the
// current target (pursuit.ts:86).
export const PURSUIT_PROGRESS = { move: 2, close: 8, closer: 8 } as const;
// The passing column's own numbers, from the earlier shared.js (:3474, :3510, :3527, :3531): no
// passing target below `lowHp` of max HP; a monster ahead counts reserved within `reserveReach`, or
// the character's range plus `reserveSpeed` times its speed when that is less; a field generator for
// a tinyp goes out within `generatorReach`, `generatorStaggerMs` apart per rank.
export const PASSING = { lowHp: 0.35, reserveReach: 400, reserveSpeed: 4, generatorReach: 200, generatorStaggerMs: 1000 } as const;
// Kept bounds against a game failure (numbers rule), each reporting through boundFired when it
// trips, at v1.5.0's values. The game refused a crab hit its own geometry allows
// (crab-range.ts): the next try waits `retryMs`, and the corrected range ends after `probeMs` so the
// game's own geometry is tried again. A failed weapon equip waits `swapRetryMs` before the next try
// (porcupine.ts).
export const GAME_BOUNDS = { crabRetryMs: 500, crabProbeMs: 30000, swapRetryMs: 2000 } as const;
// R1's engaged margin: a live target keeps this much past the farm area and the search radius
// (v1.5.0 shared.js isAllowedTarget and the retention boundary).
export const ENGAGED_MARGIN = 150;
// What table A's rows ask about one monster: the Hunt hand-off, the spend that asks and the pass's view.
// The add-on answers the grouped queue asks: the same `targeting.candidates` and `targeting.prefers`
// each character's selection asks (A21 and selection.ts), so the queue never nominates a target
// every member refuses.
export interface QueueHooks {
  narrows(): boolean; orders(): boolean;
  candidates<T>(view: CandidatesView<T>): readonly T[]; prefers<T>(view: CandidatesView<T>): readonly T[];
}
// The grouped queue's nominees (queue.ts `reconcileQueue`, G4), best first: the M priority, then
// inside one priority the order the add-ons prefer, then the distance from the leader, then the id.
// An add-on's refusal leaves a planned pull out of the queue. A fight the party is in is not a
// nominee, so no add-on drops a monster that attacks the party, and a preference never lifts a
// candidate above a higher priority.
export function queueNominees<T extends { id: string; priority?: number; score: number }>(candidates: readonly T[], hooks: QueueHooks,
  view: Omit<CandidatesView, 'candidates'>): T[] {
  const kept = hooks.narrows() ? hooks.candidates({ ...view, candidates }) : candidates;
  const ranked = [...kept].sort((a, b) => (b.priority ?? MONSTER_PRIORITY.unset) - (a.priority ?? MONSTER_PRIORITY.unset) || a.score - b.score || a.id.localeCompare(b.id));
  if (!hooks.orders()) return ranked;
  const level = (c: T) => c.priority ?? MONSTER_PRIORITY.unset, bands: T[][] = [];
  for (const c of ranked) if (bands.length && level(bands.at(-1)![0]!) === level(c)) bands.at(-1)!.push(c); else bands.push([c]);
  return bands.flatMap(band => band.length > 1 ? [...hooks.prefers({ ...view, candidates: band })] : band);
}
export interface AllowAsk { target: any; huntTravel: boolean; skill?: string; v: TargetingView }
export interface AllowRow { id: string; site: string; check(ask: AllowAsk): boolean | string | undefined }
export interface MembershipRow { id: string; site: string; holds(ask: AllowAsk): boolean }
export interface PriorityRow { id: string; site: string; priority(target: any, v: TargetingView): number | null }
// What the selection pass hands S: the Manual hand's pick and the drain row's choice, which read its own state.
export interface SourceFacts { manual(): Target | null; drain(): Target | null }
export interface SourceRow { id: string; site: string; exclusive?: boolean; next?: boolean; holds(v: TargetingView): boolean;
  supplies(f: SourceFacts, v: TargetingView): Target | null }

// Tables A, M and S, the group lock, the claims and M's priority, moved from shared.js.
export function createRules(t: TargetingMap, p: TargetingPorts, s: TargetingState) {
  // M's priority rows (today's `monsterPriority`): the first row that answers gives it, and
  // null passes to the next row.
  const priorityRows: PriorityRow[] = [
    { id: 'P1', site: 'the passive rule', priority: target => { const rule = p.hunting.rares.passive().rules[target.mtype]; return rule && rule.enabled ? rule.priority : null; } },
    { id: 'P2', site: 'tinyp', priority: target => target.mtype === "tinyp" ? 101 : null },
    { id: 'P3', site: 'a rare type while a rare runs or the monster is a passive rare candidate',
      priority: (target, v) => RARE_TYPES.indexOf(target.mtype) >= 0 && (p.hunting.facts.focus.rare.candidate(target) || v.rareActive) ? 100 : null },
    { id: 'P4', site: 'the saved priorities', priority: target => Number.isFinite(Number(s.monsterPriorities[target.mtype])) ? Number(s.monsterPriorities[target.mtype]) : null },
    { id: 'P5', site: 'every other monster', priority: () => MONSTER_PRIORITY.unset },
  ];
  // P5 answers every monster, so the first row that answers ends the loop.
  function monsterPriority(target: any) {
    if (!target) return MONSTER_PRIORITY.unset;
    const v = t.view();
    for (const row of priorityRows) {
      const priority = row.priority(target, v);
      if (priority === null) continue;
      // P4 `targeting.rule`: an enabled add-on may set P2, P3 or P5's value.
      const hooks = p.root.__partyHooks?.targeting;
      return hooks?.rules() ? hooks.priority({ row: row.id, target, character: character.name, core: priority }) : priority;
    }
  }
  // M's membership rows (today's final OR of `isAllowedTarget`): a monster that passed A28 is
  // allowed when one row holds.
  const membershipRows: MembershipRow[] = [
    { id: 'M1', site: 'a Hunt hand-off not set aside', holds: a => a.huntTravel && !(s.setAside[a.target.id] > Date.now()) },
    { id: 'M2', site: 'the current target', holds: a => a.target.id === s.combatTargetId },
    { id: 'M3', site: 'a convoy threat', holds: a => !!p.walks.groupWalk.travel && s.partyThreats.some((threat: any) => threat && threat.id === a.target.id) },
    { id: 'M4', site: 'a party threat', holds: a => !!t.isPartyThreat(a.target) },
    { id: 'M5', site: 'the scatter break target', holds: a => !!(s.scatterBreakTarget && a.target.id === s.scatterBreakTarget.id) },
    { id: 'M6', site: 'an event target type', holds: a => a.v.eventTypesHere.indexOf(a.target.mtype) >= 0 },
    { id: 'M7', site: 'the scatter type in scatter mode', holds: a => a.v.farmingModeNow === "scatter" && !!a.v.partyFarmingMonsterTypeNow && a.target.mtype === a.v.partyFarmingMonsterTypeNow },
    { id: 'M8', site: "the leader's target under Follow", holds: a => !!(p.tasks.membership.followLeader() && s.leaderTarget && a.target.id === s.leaderTarget.id) },
    { id: 'M9', site: 'focus all', holds: a => a.v.monsterFocusNow.indexOf("all") >= 0 },
    { id: 'M10', site: 'the focus types', holds: a => a.v.monsterFocusNow.indexOf(a.target.mtype) >= 0 },
  ];
  // Table A (today's `isAllowedTarget`), one row per check in today's order. A row's outcome:
  // true allows, false refuses with no reason, a string refuses with that reason, and undefined passes
  // to the next row.
  const allowRows: AllowRow[] = [
    { id: 'A1', site: 'the Graveyard exclusion', check: a => t.excludedGraveyardTarget(a.target) ? 'excluded Graveyard monster' : undefined },
    { id: 'A2', site: 'the drain gate', check: a => !t.consoleDrainAllows(a.target) ? 'waiting for safe console reload' : undefined },
    { id: 'A3', site: 'Cave', check: a => (character as any).cave || a.v.dungeonOwns ? !!t.dungeonTargetAllowed(a.target) : undefined },
    { id: 'A4', site: 'return defence', check: a => a.v.returnCombatActive ? !!t.returnAttacker(a.target) : undefined },
    // During Franky an area hit around the caster may hit the adds near it (the turns owner's
    // server table).
    { id: 'A5', site: 'Franky only', check: a => a.v.frankyCombatActive && !(a.skill && hitsAroundCaster(a.skill)) && !t.frankyTargetAllowed(a.target) ? "Franky attendance permits Franky and mummies targeting this character" : undefined },
    { id: 'A6', site: 'travel owns combat', check: a => a.v.travelCombatActive && !a.huntTravel && !t.departureTargetEngaged(a.target) ? "travel owns combat" : undefined },
    { id: 'A7', site: 'Hunt loot pending', check: a => a.v.huntPending && a.target && a.target.type === 'monster' && !t.isAttackingPartyMember(a.target) ? "hunt loot pending" : undefined },
    { id: 'A8', site: 'missing target', check: a => !a.target ? "missing target" : undefined },
    { id: 'A9', site: 'passive max level', check: a => p.hunting.rares.passive().rules[a.target.mtype]?.enabled && !t.passiveLevelAllowed(a.target) && !t.isAttackingPartyMember(a.target) &&
      !a.v.unfinishedFight && !a.v.eventTargetTypesNow.includes(a.target.mtype) && a.v.monsterFocusNow.indexOf(a.target.mtype) < 0 ? "passive max level" : undefined },
    { id: 'A10', site: 'passing owns it', check: a => t.isPassingEncounter(a.target) ? "passing attack owns this encounter" : undefined },
    { id: 'A11', site: 'death recovery', check: a => t.recoveryRefuses(a.target) ? "combat recovery owns target" : undefined },
    { id: 'A12', site: 'known dead', check: a => t.isKnownDead(a.target.id) ? "confirmed death" : undefined },
    { id: 'A13', site: 'Franky allows', check: a => a.v.frankyCombatActive ? true : undefined },
    { id: 'A14', site: 'field generator', check: a => a.target.mtype === "fieldgen0" ? "excluded monster" : undefined },
    // A drain target passes the group lock and the rows after it, unless another party claims it
    // and it does not attack ours.
    { id: 'A14d', site: 'the drain target', check: a => t.drainTargetValid(a.target) && (!t.isExternallyClaimedMonster(a.target) || t.isAttackingPartyMember(a.target)) ? true : undefined },
    // Acquisition nominates a new target; only actual combat requires the group selection lock.
    // An attack already pending or engaged must still finish before another hunt pull.
    { id: 'A15', site: 'unfinished fight on a Hunt hand-off', check: a => a.huntTravel && a.v.unfinishedFight ? "unfinished group fight" : undefined },
    // An area hit's victims pass the group lock (the turns owner's server table).
    { id: 'A16', site: 'the group lock', check: a => !a.huntTravel && !(a.skill && hitsAroundCaster(a.skill)) && !t.leaderLockAllows(a.target) ? "group target lock" : undefined },
    { id: 'A17', site: 'tinyp', check: a => a.target.mtype === "tinyp" && (!a.v.rareTarget || a.v.rareTarget.id !== a.target.id) ? "rare target policy" : undefined },
    { id: 'A18', site: 'the rare target', check: a => a.v.rareTarget && a.v.rareTarget.id === a.target.id ? true : undefined },
    { id: 'A19', site: 'a character', check: a => a.target.type === "character" ? !!eventFacts().validOpponent(a.target) : undefined },
    { id: 'A20', site: 'not a monster, or claimed elsewhere', check: a => a.target.type !== "monster" || t.isExternallyClaimedMonster(a.target) ? "external claim or invalid entity" : undefined },
    // An add-on's `targeting.candidates` answer, one monster per ask, so every finder skips what an
    // add-on refuses. The ask goes only while an enabled add-on answers it, since the finders ask once
    // per monster. Its view carries the character, the entities and the party.
    { id: 'A21', site: 'an add-on refuses', check: a => {
      const hooks = p.root.__partyHooks && p.root.__partyHooks.targeting;
      if (!hooks || !hooks.narrows()) return undefined;
      const v = a.v;
      return hooks.candidates({ candidates: [a.target], character: v.character, entities: v.entities, party: v.party,
        get nomination() { return v.groupedFarming ? t.getGroupedTarget() : null; },
        get event() { const active = v.activeCombatEvent; return v.joinedEventNow || active && active.name || null; } }).length ? undefined : "refused by an add-on";
    } },
    // Farming never pulls an October event boss outside its own event (docs/testing-october-events.md).
    // One attacking the party stays a defense target.
    { id: 'A22', site: 'an event boss outside its event', check: a => {
      const bossEvent = eventFacts().eventTargets().reservedBy(a.target.mtype);
      return bossEvent && a.v.joinedEventNow !== bossEvent && !t.isAttackingPartyMember(a.target) ? "event boss outside its event" : undefined;
    } },
    { id: 'A23', site: 'set aside on a Hunt hand-off', check: a => a.huntTravel && s.setAside[a.target.id] > Date.now() ? "failed approach cooldown" : undefined },
    { id: 'A24', site: 'passive rare', check: a => p.hunting.facts.focus.rare.candidate(a.target) ? true : undefined },
    { id: 'A25', site: 'attacks the party', check: a => t.isAttackingPartyMember(a.target) ? true : undefined },
    { id: 'A26', site: 'the farming engagement', check: a => {
      const engagement = p.root.__partyFarmingEngagement;
      if (!engagement || engagement.target.id !== a.target.id) return undefined;
      return p.hunting.facts.focus.contains(a.target, p.walkState.partyLocation) ? true : "farming engagement left selected area";
    } },
    // Farm boundaries govern new pulls. The exact unfinished target must stay eligible after it
    // wanders out, or the lock and selector deadlock.
    { id: 'A27', site: 'the unfinished target', check: a => a.v.unfinishedFight && s.groupedCombat.target && s.groupedCombat.target.id === a.target.id &&
      s.groupedCombat.target.map === character.map && s.groupedCombat.target.in === character.in && s.groupedCombat.target.server === a.v.reunionRealm ? true : undefined },
    // R1's engaged margin: the current target keeps ENGAGED_MARGIN past the farm area while its attack is live.
    { id: 'A28', site: 'outside the farm area', check: a => {
      const target = a.target, v = a.v;
      const nearbyHunt = target.mtype === v.huntCombatTargetNow && Math.hypot(target.x - character.x, target.y - character.y) <= p.hunting.farm.radius();
      if (a.huntTravel || nearbyHunt || v.eventArea || v.activeCombatEvent || v.joinedEventNow || t.isPartyThreat(target)) return undefined;
      const live = target.id === s.combatTargetId && target.id === s.lastAttackTarget && Date.now() - s.lastAttackAt < pick('attackStallMs');
      const inside = p.hunting.facts.focus.contains(target, v.targetScope, live ? ENGAGED_MARGIN : 0) || p.hunting.facts.focus.inRadius(target) ||
        t.queueRetentions().some((kept: any) => kept.id === target.id && kept.eligible);
      return !inside || s.setAside[target.id] > Date.now() ? false : undefined;
    } },
    { id: 'A29', site: 'membership', check: a => membershipRows.some(row => row.holds(a)) },
  ];
  // P4 `targeting.rule`: an enabled add-on lifts A1, A9, A14, A17 or A20's external claim. A20
  // stays for an entity that is not a monster.
  function lifted(row: string, a: AllowAsk, reason: string): boolean {
    const hooks = p.root.__partyHooks?.targeting;
    return !!hooks?.rules() && (row !== 'A20' || a.target?.type === 'monster') && hooks.admits({ row, target: a.target, character: character.name, core: reason });
  }
  // `skill` names the spend that asks. The diagnostic takes the refusing row's reason and id. A29 answers
  // every ask, so the loop always returns.
  function isAllowedTarget(target: any, huntTravelCommand: any, diagnostic: any, skill?: string) {
    const huntTravel = !!(huntTravelCommand && (huntTravelCommand.purpose === "monster-hunt" &&
      huntTravelCommand.combatHandoffAllowed === true && huntTravelCommand.huntTarget === (target && target.mtype) ||
      handsCombatOver(huntTravelCommand.purpose, huntTravelCommand.combatHandoffAllowed) && huntTravelCommand.combatHandoffAllowed === true));
    const ask: AllowAsk = { target, huntTravel, skill, v: t.view() };
    for (const row of allowRows) {
      const outcome = row.check(ask);
      if (outcome === undefined) continue;
      if (typeof outcome === 'string' && lifted(row.id, ask, outcome)) continue;
      if (typeof outcome === 'string') { if (diagnostic) { diagnostic.reason = outcome; diagnostic.row = row.id; } return false; }
      // A plain refusal names its row too, so `pullOnly` can tell A28 and A29 apart.
      if (outcome === false && diagnostic) diagnostic.row = row.id;
      return outcome;
    }
  }
  // Table S (today's `chooseTarget`, `priorityEventTarget`, `fallbackTarget` and `exclusiveCombat`),
  // in today's order: the first row that holds supplies the target. A row marked `next` passes to
  // the next row when it supplies none; every other row's answer stands.
  const sourceRows: SourceRow[] = [
    { id: 'S1', site: 'Manual', holds: v => v.handControl?.by === "manual", supplies: f => f.manual() },
    { id: 'S2', site: 'the priority event', next: true, holds: v => !exclusiveCombat(v), supplies: () => t.getPriorityEventTarget() || null },
    // During a safe console load the character fights the drain's targets to a finish.
    { id: 'S2d', site: 'the drain', next: true, holds: v => !!v.drain, supplies: f => f.drain() },
    { id: 'S3', site: 'Cave', exclusive: true, holds: v => !!v.dungeonOwned, supplies: () => t.getDungeonTarget() || null },
    { id: 'S4', site: 'return defence', exclusive: true, holds: v => !!v.returnCombatActive, supplies: () => t.returnDefenseTarget() || null },
    { id: 'S5', site: 'Franky', exclusive: true, holds: v => !!v.frankyCombatActive, supplies: () => t.nearestEventTarget() },
    { id: 'S6', site: 'merchant', holds: () => character.ctype === "merchant", supplies: () => t.classTarget() },
    { id: 'S7', site: 'grouped', holds: v => !!v.groupedFarming, supplies: () => t.getGroupedTarget() },
    { id: 'S8', site: 'rare', holds: v => !!v.rareTarget, supplies: (_f, v) => v.rareTarget },
    { id: 'S9', site: 'the class role', holds: () => true, supplies: () => t.classTarget() },
  ];
  // The rows that skip the priority event and the shared target fallback (S's `exclusive`).
  function exclusiveCombat(v: TargetingView = t.view()): boolean {
    return sourceRows.some(row => row.exclusive && row.holds(v));
  }
  // Runs S over the pass's view and names the row that supplied the target; the pass hands in the
  // Manual hand and the drain row's choice.
  function sourceTarget(f: SourceFacts): { target: Target | null; row: string | null } {
    const v = t.view();
    for (const row of sourceRows) {
      if (!row.holds(v)) continue;
      const target = row.supplies(f, v);
      if (target || !row.next) return { target: target || null, row: row.id };
    }
    return { target: null, row: null };
  }
  // The coordinator's group when it speaks QUEUE_PROTOCOL, else null; every character-side read of the
  // queue asks it.
  function currentQueue(): any {
    return speaksQueue(s.groupedCombat) ? s.groupedCombat : null;
  }
  function leaderLockAllows(target: any) {
    if(!t.view().groupedFarming)return true;
    return !!(target && currentQueue() && s.groupedCombat.target &&
      s.groupedCombat.target.id===target.id && s.groupedCombat.target.map===character.map &&
      s.groupedCombat.target.in===character.in && s.groupedCombat.target.server===t.view().reunionRealm);
    }
  function isExternallyClaimedMonster(target: any) {
    if (!target || target.type !== "monster") return false;
    // Re-read the server snapshot: the selected object may predate impact.
    target = get_entity(target.id) || target;
    var definition = G.monsters && (G.monsters as any)[target.mtype] || {};
    if (target.mtype === 'phoenix' && t.view().rareControlNow &&
        t.view().rareControlNow.allowPhoenixAssist && typeof p.hunting.rares.current === 'function' && p.hunting.rares.current()) return false;
    if (target.mtype !== 'phoenix' && (target.cooperative || definition.cooperative) || t.view().eventTypesHere.indexOf(target.mtype) >= 0)
      return false;
    if (!target.target || target.target === character.name) return false;
    return t.view().currentPartyList.indexOf(target.target) < 0;
    }
  function excludedGraveyardTarget(target: any) {
    return !!target && eventFacts().eventTargets().excluded(target.mtype) && !t.isAttackingPartyMember(target);
    }
  function graveyardAreaAttackAllowed(range: any) {
    return !Object.values(parent.entities || {}).some(function(target: any) {
      return target && target.type === 'monster' && !target.dead && target.visible !== false &&
        t.excludedGraveyardTarget(target) && distance(character,target) <= range;
    });
    }
  // A11, death recovery (the scope's one check, from scope.ts): while this character's assignment is
  // death recovery, every target is refused, a party attacker included, unless survival's verdict is
  // `finish` and the target is on the finishing list of `survival.recovery`, which the character's realm
  // answers for its own party.
  function recoveryRefuses(target: any) {
    if (t.view().assignedTierNow !== 'death-recovery') return false;
    if ((p.root.__partyHooks ? p.root.__partyHooks.survival.verdict({ character: character.name }) : undefined) !== 'finish') return true;
    const finishing = (p.root.__partyHooks ? p.root.__partyHooks.survival.recovery('')?.targets : undefined) ?? [];
    return !finishing.some((f: any) => f.id === target.id && f.map === character.map && f.in === character.in && f.server === t.view().reunionRealm);
  }
  // Survival's escape answer for this character. Targeting asks the hook bus only once it is installed.
  function escaping(): boolean {
    return !!(p.root.__partyHooks && p.root.__partyHooks.survival.escaping(character.name));
  }
  // `targeting.pullOnly` (the turns owner's one-shot exception): table A refuses the
  // monster only at the rows that decide a new pull, outside the farm area or with no membership
  // row, and it targets nobody. Every earlier row (another party's claim, an event boss outside
  // its event, a Hunt or event rule) still refuses it outright.
  function pullOnly(target: any, skill?: string): boolean {
    const diagnostic: { row?: string } = {};
    if (!target || target.target || isAllowedTarget(target, undefined, diagnostic, skill)) return false;
    return diagnostic.row === 'A28' || diagnostic.row === 'A29';
  }
  return { allowRows, membershipRows, priorityRows, sourceRows, exclusiveCombat, sourceTarget, recoveryRefuses, escaping, currentQueue, monsterPriority, isAllowedTarget, pullOnly, leaderLockAllows, isExternallyClaimedMonster, excludedGraveyardTarget, graveyardAreaAttackAllowed };
}
