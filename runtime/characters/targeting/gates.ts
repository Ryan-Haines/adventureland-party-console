// The attack-time gates (V1.1 gates.ts): the monster attack policy by damage type and the crab
// range hold.
import { eventFacts } from '../../events/api.ts';
import { boundFired } from '../../status/api.ts';
import { GAME_BOUNDS } from './rules.ts';
import { notAhead } from '../../protocol/reports.ts';
import { hitsAroundCaster } from '../turns/api.ts';
import type { TargetAnswer } from './api.ts';
import type { DamageType } from 'typed-adventureland';
import type { TargetingMap, TargetingPorts, TargetingState } from './install.ts';
import type { CallAnswer, CallQuestion } from '../../hooks/registry.ts';
import type { Target } from '../turns/api.ts';
import type { TargetingEntry } from './records.ts';

// The two reflect lists a character's attacks read. The defaults are v1.5.0's
// hand-kept monsters: slenderman, tiger and goblin for magic, porcupine for physical.
export interface ReflectLists { magic: readonly string[]; physical: readonly string[] }
export const defaultLists: ReflectLists = { magic: ["slenderman", "tiger", "goblin"], physical: ["porcupine"] };

function knownDamageType(value: unknown): DamageType | undefined {
  return value === "physical" || value === "magical" || value === "pure" ? value : undefined;
}

/** Native 15555 player serialization can omit damage_type (also absent from
 * upstream Character). The equipped weapon overrides the native class default;
 * a supplied native field remains authoritative. Review on upstream upgrades. */
export function effectiveAttackDamageType(
  actor: Pick<Character, "ctype" | "slots"> & { damage_type?: DamageType },
  data?: Pick<typeof G, "items" | "classes">,
): DamageType | undefined {
  const nativeType = knownDamageType(actor.damage_type);
  if (nativeType) return nativeType;
  const weapon = actor.slots?.mainhand;
  return knownDamageType(weapon && data?.items?.[weapon.name]?.damage_type) ||
    knownDamageType(data?.classes?.[actor.ctype]?.damage_type);
}

/** Server retaliation depends on damage type and range stat, not proximity. A monster on the
 * physical list gets the game's damage return rule for every `dreturn` monster: a physical or
 * untyped hit from a range below 75 (server.js:4358-4368). */
export function monsterAttackBlock(
  monster: string | undefined,
  damageType: string | undefined,
  range: number,
  lists: ReflectLists = defaultLists,
): string | null {
  const type = monster ?? "";
  if (lists.physical.includes(type) && damageType !== "magical" && damageType !== "pure" &&
      !(Number.isFinite(range) && range >= 75))
    return `${type.charAt(0).toUpperCase()}${type.slice(1)} damage return: physical attacks require range >= 75`;
  if (lists.magic.includes(type) && damageType !== "physical" && damageType !== "pure")
    return "Monster reflection: magical basic attacks disabled";
  return null;
}

export interface RangeSample {
  targetId: string; map: string; mtype: string; at: number; range: number;
  actor: { x: number; y: number; width: number; height: number };
  target: { x: number; y: number; width: number; height: number };
  expected: { width: number; height: number };
  nativeDistance: number; correctedDistance: number;
}
export interface RangeDiagnostic {
  active: boolean; expiresAt: number; reason: string;
  sample: RangeSample; rejection: unknown;
}
function mismatch(s: RangeSample): boolean {
  return s.mtype === "crab" &&
    [s.target.width, s.target.height, s.expected.width, s.expected.height,
      s.nativeDistance, s.correctedDistance].every(Number.isFinite) &&
    (s.target.width > s.expected.width + 1 || s.target.height > s.expected.height + 1);
}
export function createCrabRangeRecovery() {
  let diagnostic: RangeDiagnostic | null = null;
  let retryAt = 0;
  function reset(reason = "target changed"): void {
    retryAt = 0;
    if (diagnostic) { diagnostic.active = false; diagnostic.reason = reason; }
  }
  function distance(sample: RangeSample | null, now: number): number | null {
    if (!sample) return null;
    if (!diagnostic?.active) return null;
    if (sample.targetId !== diagnostic.sample.targetId || sample.map !== diagnostic.sample.map) return null;
    else if (now >= diagnostic.expiresAt) {
      boundFired({ bound: 'GAME_BOUNDS.crabProbeMs', owner: '04', state: { target: sample.targetId, map: sample.map, ms: GAME_BOUNDS.crabProbeMs } });
      reset("expired; probing native behavior");
    }
    else if (!mismatch(sample)) reset("native geometry agrees");
    return diagnostic.active ? sample.correctedDistance : null;
  }
  return {
    reset, distance,
    select(sample: RangeSample | null, now: number): void {
      if (diagnostic && (sample?.targetId !== diagnostic.sample.targetId || sample?.map !== diagnostic.sample.map)) reset();
      distance(sample, now);
    },
    diagnostic: () => diagnostic,
    blocked(sample: RangeSample | null, now: number): boolean {
      const corrected = distance(sample, now);
      return corrected !== null && (now < retryAt || corrected > sample!.range);
    },
    reject(sample: RangeSample, rejection: unknown, now: number): void {
      if (!mismatch(sample) || sample.nativeDistance > sample.range || sample.correctedDistance <= sample.range) return;
      if (!diagnostic?.active || now >= diagnostic.expiresAt) {
        diagnostic = { active: true, expiresAt: now + GAME_BOUNDS.crabProbeMs, reason: "crab geometry mismatch", sample, rejection };
      } else { diagnostic.sample = sample; diagnostic.rejection = rejection; }
      retryAt = now + GAME_BOUNDS.crabRetryMs;
      boundFired({ bound: 'GAME_BOUNDS.crabRetryMs', owner: '04', state: { target: sample.targetId, map: sample.map, distance: sample.correctedDistance, range: sample.range } });
    },
  };
}

// The attack-time gates' group readiness, the skill target gate, the crab range read and the drain
// gate, moved from shared.js.
export function createGates(t: TargetingMap, p: TargetingPorts, s: TargetingState) {
  function independentPullReady(target: any) {
    if(!s.groupedCombat.independentApproach || s.groupedCombat.target.state!=='planned')return true;
    var confirmation=s.groupedCombat.independentConfirmation,client=s.queueClient,proof=client && client.independent && client.independent.readiness();
    var now=Date.now()+p.walkState.clockOffset,valid=!!(confirmation && confirmation.selection===s.groupedCombat.selection && confirmation.target===String(target.id) &&
      now<confirmation.expiresAt && proof && proof.ready===true && proof.target===String(target.id) &&
      proof.selection===s.groupedCombat.selection && proof.confirmation===confirmation.id && t.independentPeersReady(confirmation,now));
    if(valid){s.pullRefreshKey=null;return true;}
    var refresh=JSON.stringify([s.groupedCombat.selection,confirmation && confirmation.id]);
    if(s.pullRefreshKey!==refresh && client && client.flush){s.pullRefreshKey=refresh;client.flush();}
    return false;
    }
  // A peer's readiness counts while it names the current confirmation: the peer's next report
  // withdraws it, and a new confirmation id replaces it. The confirmation's own `expiresAt` (one
  // report interval, movement's confirmIndependentApproach) and the snapshot's freshness bound both.
  function independentPeersReady(confirmation: any,now: any) {
    var members=s.groupedCombat.members,records=s.groupedCombat.independentReadiness || {};
    return !!(Array.isArray(members) && members.length && members.every(function(name: any){var record=records[name];return record && record.ready===true &&
      record.selection===confirmation.selection && record.target===confirmation.target && record.confirmation===confirmation.id &&
      record.at>=confirmation.startedAt && notAhead(record.at,now);}));
    }
  function groupedAttackAllowed(target: any) {
    if (!t.consoleDrainAllows(target)) return false;
    // G's group readiness lets a drain target through.
    if (drainTargetValid(target)) return true;
    if (t.view().dungeonOwned) return !!((character as any).cave && !(character as any).cave.paused && t.dungeonTargetAllowed(target) && t.groupedFresh() &&
      s.groupedCombat.target?.id === target.id && s.groupedCombat.committed);
    if(t.view().returnCombatActive)return t.returnAttacker(target);
    if(s.queueClient && s.queueClient.formation && s.queueClient.formation.blocks())return false;
    if (t.view().travelCombatActive && !t.departureTargetEngaged(target)) return false;
    if(t.view().huntPending && !t.departureTargetEngaged(target))return false;
    if(!t.view().groupedFarming)return true;
    if(!target || !t.currentQueue() || !s.groupedCombat.target || s.groupedCombat.target.id!==target.id)return false;
    if(s.groupedCombat.target.map!==character.map || s.groupedCombat.target.in!==character.in || s.groupedCombat.target.server!==t.view().reunionRealm)return false;
    if(s.groupedCombat.target.state==='engaged')return true;
    if(s.groupedCombat.pursuit && s.groupedCombat.pursuit.revoking)return false;
    if(!t.groupedFresh() || !s.groupedCombat.committed || !t.independentPullReady(target))return false;
    return !Object.values(parent.entities||{}).some(function(e: any){return e && e.visible && !e.dead && e.type==='monster' && e.id!==target.id && t.isAttackingPartyMember(e);}) || s.groupedCombat.target.state==='pending';
    }
  // `skill` names the spend that asks: a skill whose damage the server lands on every monster around the
  // caster (the turns owner's server table, `hitsAroundCaster`) skips only the group lock (table A's
  // A16); during Franky any live, visible monster on the character's map and instance that the drain
  // allows is one. Outside Franky each victim still passes the group's readiness or the committed
  // attacker test.
  function skillTargetAllowed(target: any, skill?: string) {
      if(t.view().returnCombatActive)return t.returnAttacker(target);
      if (!target || target.type !== "monster" || !t.isAllowedTarget(target, undefined, undefined, skill) || p.root.__partyHooks.skills.allows({ rank: "damage", occupied: true }) || eventFacts().liveAbtesting()) return false;
      if(t.view().dungeonOwned) return t.dungeonTargetAllowed(target);
      if(p.hunting.hunt.defense() && !t.isAttackingPartyMember(target) && !(p.walks.groupWalk.travel?.defenseTargets||[]).some(function(tgt: any){return t.passingKey(tgt)===t.passingKey(target);}))return false;
      if (t.view().frankyCombatActive) return skill && hitsAroundCaster(skill) ? areaVictim(target) : t.frankyTargetAllowed(target);
      if (target.target && !t.isAttackingPartyMember(target)) return false;
      if (t.groupedAttackAllowed(target)) return true;
      return t.view().groupedFarming && t.groupedFresh() && s.groupedCombat.committed &&
        t.isAttackingPartyMember(target) && (!t.view().travelCombatActive || p.hunting.hunt.defense());
    }
  function areaVictim(target: any) {
    return target.visible !== false && !target.dead && target.hp > 0 && (!target.map || target.map === character.map) &&
      (target.in == null || target.in === character.in) && t.consoleDrainAllows(target);
  }
  function describeAttackRange(target: any) {
      if (!target || target.mtype !== "crab" || typeof (globalThis as any).get_width !== "function" || typeof (globalThis as any).get_height !== "function") return null;
      // Game data carries the crab's box; with none there is no sample to correct.
      var dimensions = G.dimensions && (G.dimensions as any).crab;
      if (!dimensions) return null;
      var size = Number(G.monsters.crab.size) || 1;
      var expected: any = { width: Math.round(dimensions[0] * size), height: Math.round(dimensions[1] * size) };
      var actor: any = { x: character.x, y: character.y, width: (globalThis as any).get_width(character), height: (globalThis as any).get_height(character) };
      var box: any = { x: (globalThis as any).get_x(target), y: (globalThis as any).get_y(target), width: (globalThis as any).get_width(target), height: (globalThis as any).get_height(target) };
      var correctedTarget: any = { x: box.x, y: box.y, width: expected.width, height: expected.height };
      return { targetId: target.id, map: character.map, mtype: target.mtype, at: Date.now(), range: character.range,
        actor: actor, target: box, expected: expected, nativeDistance: distance(character, target),
        correctedDistance: distance(actor, correctedTarget) };
    }
  // The crab range recovery's corrected distance, which targeting adopts; movement's
  // approach reads it.
  function correctedCombatDistance(target: any) { return s.targetingCorrectedDistance ? s.targetingCorrectedDistance(target) : null; }
  function consoleDrainKey(target: any) {
    return [t.view().reunionRealm, character.map, character.in, target && target.id].join(':');
    }
  // The drain is the lifecycle owner's `lifecycle.drain(character)` answer; the Pause needs no term
  // here, since targeting runs only from `act` registrations, which table P holds.
  function consoleDrainAllows(target: any) {
    const drain = t.view().drain;
    return !drain || !!(target && (drain.targets[t.consoleDrainKey(target)] || t.isAttackingPartyMember(target)));
    }
  // A safe console load fights this target to a finish: the drain allows it (listed, or attacking
  // the party), and it is a live monster here that no pass has seen die.
  function drainTargetValid(target: any) {
    return !!(t.view().drain && target && target.type === 'monster' && target.visible && !target.dead && target.hp > 0 &&
      (!target.map || target.map === character.map) && (target.in == null || String(target.in) === String(character.in)) &&
      t.consoleDrainAllows(target) && !t.isKnownDead(String(target.id)));
  }
  function consoleDrainCombatActive() {
    return !!t.view().drain && Object.values(parent.entities || {}).some(drainTargetValid);
    }
  return { drainTargetValid, independentPullReady, independentPeersReady, groupedAttackAllowed, skillTargetAllowed, describeAttackRange, correctedCombatDistance, consoleDrainKey, consoleDrainAllows, consoleDrainCombatActive };
}

// The answers of `targeting.target` and `targeting.allows` (3.2, 3.4; G's rows in today's order),
// moved from answers.ts, which is gone.
// The skill world the skill gate reads: the skill runtime's, the same one its engine judges with.
export interface GateWorld {
  actor: { name: string; range: number };
  skills: Readonly<Record<string, { damage_type?: string; hostile?: boolean } | undefined>>;
}
export interface AnswerPorts {
  hooks: {
    targeting: { refuses(monster: unknown, skill: string): string | undefined };
    calls: { band(question: CallQuestion): CallAnswer };
  };
  // The role runner's selection (runner.ts `attackTarget`, `currentTarget`, `passingTarget`).
  attackTarget?(): Target | null;
  currentTarget?(): Target | null;
  passingTarget?(): Target | null;
  // A selection is due from the moment the target is lost until a selection finishes with no
  // invalidation pending, and never while targeting is inactive or combat is not allowed. The
  // selection pass's `due` answers it (selection.ts).
  due?(): boolean;
  // The porcupine bow swap holds the attack while it changes weapons.
  equipmentBusy?(): boolean;
  // This character's two reflect lists (reflect.ts).
  reflect(): ReflectLists;
  // The skill runtime's world, and its scatter pull check (the turns owner's damage model,
  // turns/skills/runtime.ts `pullSafe`), the last check of v1.5.0's `authorized`.
  world(): GateWorld | null;
  pullSafe(world: GateWorld, target: Target): boolean;
  // The module shared.js built at load (install.ts), whose checks the gates read.
  module: TargetingMap;
  // The targeting ring (records.ts), which keeps each `allows` refusal (3.12).
  record?(entry: TargetingEntry): void;
}
// What one G row asks: the target, the spend, the skill world G9 reads for G10 to G12, and A's
// refusing row that G1 hands the notice.
interface GateAsk { target?: Target; skill: string; world?: GateWorld | null; row?: string }
interface GateRow { id: string; site: string; check(ask: GateAsk): string | true | undefined }
// Each refusal is one ring entry until it changes: the same reason on the same target for the same
// skill writes nothing more, and an allow ends it. Targeting's skill target gate with the asking
// skill, as SharedCombat carries it (turns/role-types.ts).
export type SkillTargetAllowed = ReturnType<typeof createGates>['skillTargetAllowed'];
export function refusalRecorder(record: (entry: TargetingEntry) => void) {
  const last = new Map<string, string>();
  return (target: { id?: unknown } | undefined, skill: string, reason: string | undefined, row?: string, by = 'core:targeting'): void => {
    const key = reason ? `${String(target?.id)}|${reason}` : '';
    if (!reason) { last.delete(skill); return; }
    if (last.get(skill) === key) return;
    last.set(skill, key);
    record({ kind: 'refused', target: String(target?.id), skill, why: reason, ...(row ? { row } : {}), by });
  };
}
// The skills the return defence and Franky's boss-only fight refuse (v1.5.0's sets in
// skills/runtime.ts).
const returnExcluded = new Set<string>(['taunt', 'agitate', 'charge', 'dash', 'blink', 'scare', 'stomp', 'cleave', 'fanofknives']);
// Cleave left this set with: during Franky a Cleave may hit the adds near it. `frankySkillBlocked`
// lets any skill that `hitsAroundCaster` names through on the same terms.
const frankyExcluded = new Set<string>(['agitate', 'charge', 'dash', 'blink', 'scare', 'stomp', 'fanofknives']);
const hostile = (skill: string) => !!(G.skills as Record<string, { hostile?: boolean } | undefined>)[skill]?.hostile;

export function createAnswers(ports: AnswerPorts) {
  const m = ports.module;
  const refused = refusalRecorder(entry => ports.record?.(entry));
  const passing = (target: Target) => target.id !== ports.currentTarget?.()?.id && target.id === ports.passingTarget?.()?.id;
  function returnTargetBlocked(t: Target, id: string): boolean {
    return !!m.returnCombatActive() && (returnExcluded.has(id) || !m.returnAttacker(t));
  }
  // Area effects and movement skills cannot honor strict boss-only, hold-position combat.
  function frankySkillBlocked(id: string, targets: Target[]): boolean {
    if (!m.franky()) return false;
    // An area hit's victim during Franky is any monster its skill gate allows. A single-target skill
    // takes Franky or the add the basic attack takes (events.ts `frankyAttacker`).
    return frankyExcluded.has(id) || hostile(id) &&
      targets.some(t => t.type !== 'monster' || !hitsAroundCaster(id) && t.mtype !== 'franky' && !m.frankyAttacker(t) || !m.skillTargetAllowed(t, id));
  }
  // Table G, v1.5.0's `permitted`, `skillGate` and `authorized` as rows in today's
  // order. A row's outcome: a string refuses with that reason, true allows and ends the table, and
  // undefined passes to the next row. The basic attack reads G1 to G6.
  const attackRows: GateRow[] = [
    // G1 names A's refusing row for the refused notice.
    { id: 'G1', site: 'eligibility (A, or the passing check)', check: g => {
      const diagnostic: { reason?: string; row?: string } = {};
      const eligible = passing(g.target!) ? m.consoleDrainAllows(g.target) : m.isAllowedTarget(g.target, undefined, diagnostic);
      g.row = diagnostic.row;
      return eligible ? undefined : "target no longer eligible";
    } },
    { id: 'G2', site: 'the bow swap', check: () => ports.equipmentBusy?.() ? "weapon equipment change in progress" : undefined },
    { id: 'G3', site: "the game's is_disabled", check: () => {
      const client = parent as unknown as { is_disabled?: (actor: typeof character) => boolean };
      return client.is_disabled?.(character) ? "character disabled" : undefined;
    } },
    { id: 'G4', site: "the group's readiness", check: g => !passing(g.target!) && !m.groupedAttackAllowed(g.target) ? "waiting for group readiness and target commitment" : undefined },
    { id: 'G5', site: 'the reflect lists by the attack\'s damage type', check: g =>
      monsterAttackBlock(g.target!.mtype, effectiveAttackDamageType(character, typeof G === "undefined" ? undefined : G), Number(character.range), ports.reflect()) || undefined },
    { id: 'G6', site: 'the rare policy', check: g => !m.rareAttackAllowed(g.target, "attack") ? "Fairy deployment or attack policy" : undefined },
  ];
  // Every other spend reads G7 to G12: the return and Franky vetoes on the skill, then for a hostile
  // skill on a target the target's own rows, each refusing as one reason.
  const IMMUNE = 'unauthorized or immune target';
  const skillRows: GateRow[] = [
    { id: 'G7', site: 'the return defence veto', check: g => m.returnCombatActive() && returnExcluded.has(g.skill) ? 'Skill conflicts with return movement or attacker-only policy' : undefined },
    { id: 'G8', site: 'the Franky veto', check: g => frankySkillBlocked(g.skill, []) ? 'Skill conflicts with Franky-only combat' : !g.target || !hostile(g.skill) ? true : undefined },
    { id: 'G9', site: "the target's return and Franky vetoes", check: g => {
      g.world = ports.world();
      return !g.world || returnTargetBlocked(g.target!, g.skill) || frankySkillBlocked(g.skill, [g.target!]) ? IMMUNE : undefined;
    } },
    // Taunt excepted, as v1.5.0's `authorized`.
    { id: 'G10', site: "the reflect lists by the skill's own damage type", check: g =>
      g.skill !== 'taunt' && monsterAttackBlock(g.target!.mtype, g.world!.skills[g.skill]?.damage_type || 'physical', g.world!.actor.range, ports.reflect()) ? IMMUNE : undefined },
    { id: 'G11', site: 'eligibility (A with the skill) and the rare policy', check: g =>
      !m.skillTargetAllowed(g.target, g.skill) || m.rareAttackAllowed(g.target, g.skill) === false ? IMMUNE : undefined },
    { id: 'G12', site: "the turns owner's scatter pull check", check: g => ports.pullSafe(g.world!, g.target!) ? undefined : IMMUNE },
  ];
  // Runs one list of G rows; the refusal names its row, with A's row under G1.
  function gate(rows: GateRow[], ask: GateAsk): { reason?: string; row?: string } {
    for (const row of rows) {
      const outcome = row.check(ask);
      if (outcome === true) return {};
      if (typeof outcome === 'string') return { reason: outcome, row: ask.row ? `${row.id}/${ask.row}` : row.id };
    }
    return {};
  }
  return {
    // The role runner's target, its passing flag, and the grouped readiness and tinyp gates on
    // support casts (supportTick).
    target(): TargetAnswer | { due: true } | undefined {
      const target = ports.attackTarget?.(), due = !!ports.due?.();
      if (!target) return due ? { due } : undefined;
      const support = m.groupedAttackAllowed(target) && (target.mtype !== 'tinyp' || !!m.rareAttackAllowed(target, 'support'));
      return { target, passing: passing(target), support, due, range: m.describeAttackRange(target) ?? null, revision: m.combatTargetRevision() };
    },
    // One answer for every hostile spend: v1.5.0's gates, then an
    // add-on's refusal (`targeting.refuses`), which can only refuse.
    allows(monster: unknown, skill: string): string | undefined {
      const target = monster as Target | undefined;
      const found = skill === 'attack' ? target ? gate(attackRows, { target, skill }) : {} : gate(skillRows, { target, skill });
      // G13, an add-on's refusal (`targeting.refuses`), names its add-on (`<name>: <refusal>`).
      const addon = found.reason ? undefined : target ? ports.hooks.targeting.refuses(target, skill) : undefined;
      const reason = found.reason ?? addon;
      refused(target, skill, reason, addon ? 'G13' : found.row, addon ? addon.slice(0, addon.indexOf(':')) : 'core:targeting');
      return reason;
    },
    // Melee classes keep a porcupine selected while the safety rule blocks attacks or the bow swap
    // runs. The call asks the survival band first.
    changeTarget(target: Target): boolean {
      if (typeof change_target !== 'function') return false;
      if (ports.hooks.calls.band({ band: 'survival', method: 'target', data: { id: target.id } }) !== 'send') return false;
      change_target(target);
      return true;
    },
  };
}
export type Answers = ReturnType<typeof createAnswers>;
