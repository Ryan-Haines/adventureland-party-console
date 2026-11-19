import type { Combatant, SkillWorld, SkillId, SkillDefinition, SkillDecision } from './types.ts';
import { incomingDps } from '../../survival/api.ts';
import { mpRefusal } from '../rules.ts';
import { handling, hitsAroundCaster } from './server.ts';

export function cost(w: SkillWorld, id: SkillId): number {
  const mp = id === 'heal' ? w.actor.mp_cost : w.skills[id]?.mp;
  return Math.ceil(Math.max(0, Number(mp) || 0) * (1 - Math.min(100, Math.max(0, w.actor.mp_reduction || 0)) / 100));
}
// The MP a decision's per-target list adds to its cost: Controlled Mana Burst spends each pair's MP
// on top of its `mp` (server.js:3447-3454). Any other argument adds nothing.
export function entriesMp(argument: unknown): number {
  return Array.isArray(argument) ? argument.reduce((sum: number, mp) => sum + Math.max(0, Number(mp) || 0), 0) : 0;
}
function equipment(w: SkillWorld, s: SkillDefinition): boolean {
  const main = w.actor.slots.mainhand, off = w.actor.slots.offhand;
  const allowed: string[] = s.wtype ? [s.wtype].flat() : [];
  const weapon = main ? w.item(main.name)?.wtype : undefined;
  if (allowed.length && !allowed.includes(weapon || '')) return false;
  if (!offhandMatches(w, s, off?.name)) return false;
  return slotsMatch(w, s);
}
function offhandMatches(w: SkillWorld, s: SkillDefinition, name?: string): boolean {
  return !s.offhand_type || !!name && w.item(name)?.type === s.offhand_type;
}
function slotsMatch(w: SkillWorld, s: SkillDefinition): boolean {
  return !s.slot || s.slot.some(([slot, name]) => {
    const item = w.actor.slots[slot];
    if (item?.name !== name) return false;
    return (item.charges || 0) >= (w.item(name)?.charge || 0);
  });
}
// A `monster` skill is a monster's own (game data design/skills.js "zap", "fireball", "stone"): it
// names no class, so the class gate below passes it, and the server answers a character's cast of
// it with success that does nothing.
export function unlocked(w: SkillWorld, id: SkillId): boolean {
  const s = w.skills[id];
  if (!s || s.type === 'passive' || s.type === 'monster' || s.consume) return false;
  if (s.class && !s.class.includes(w.actor.ctype)) return false;
  if (w.actor.level < (s.level || 0) || !equipment(w, s)) return false;
  return Object.entries(s.requirements || {}).every(([key, value]) =>
    Number(Reflect.get(w.actor, key)) >= Number(value));
}
// The class reserve's share of max MP: the paladin and the priest keep at least this share or their
// survival casts' cost, whichever is more; every other class but the warrior keeps the `other`
// share.
const RESERVE_SHARE = { paladin: .3, priest: .35, other: .2 };
export function reserve(w: SkillWorld): number {
  const availableCost = (id: SkillId) => unlocked(w, id) ? cost(w, id) : 0;
  const c = w.actor.ctype;
  if (c === 'paladin') return Math.max(w.actor.max_mp * RESERVE_SHARE.paladin, 2 * availableCost('selfheal') + availableCost('guardians_oath'));
  if (c === 'priest') return Math.max(w.actor.max_mp * RESERVE_SHARE.priest, 2 * cost(w, 'heal') + availableCost('partyheal'));
  if (c === 'warrior') return (w.context.leader === w.actor.name ? availableCost('taunt') : 0) +
    Math.max(availableCost('stomp'), availableCost('hardshell'));
  return w.actor.max_mp * RESERVE_SHARE.other;
}
// The urgent area cast (and upstream issues", v1.5.0's, the warrior's Cleave): a
// cast the server centres on the caster that hits two or more monsters, at Franky, or in Default or an
// event while two or more monsters attack party members (targeting's threat fact). Such a cast may
// spend below the class reserve, but never MP the character does not have. reads Cleave's row by
// the server's area (server.ts), so any such skill meets it.
export function unrestrictedArea(w: SkillWorld, d: SkillDecision): boolean {
  if (handling(d.skill).area !== 'caster' || d.targets.length < 2) return false;
  if (w.context.mode === 'event' && w.context.event === 'franky') return true;
  return (w.context.mode === 'grouped' || w.context.mode === 'event') && w.context.monsters.filter(t => !t.dead && t.hp > 0 && w.attacking(t)).length >= 2;
}
// Where the ranking offers a cast the server centres on the caster (damageChoices, row 8): one that
// deals damage needs two monsters in its area, as 1.5's warrior cleaved, since on one it spends its
// MP for the target's basic attack. It goes in Scatter, or under the urgent area cast's condition
// above. Outside both, the cast would pull the idle monsters beside the target. Every other area is
// offered in every mode.
export function areaOffered(w: SkillWorld, d: SkillDecision): boolean {
  if (handling(d.skill).area !== 'caster') return true;
  if (hitsAroundCaster(d.skill) && d.targets.length < 2) return false;
  return w.context.mode === 'scatter' || unrestrictedArea(w, d);
}
function targetBlock(w: SkillWorld, d: SkillDecision): string | null {
  const s = w.skills[d.skill]!;
  for (const target of d.targets) {
    if (!living(target)) return 'target dead';
    if (s.no_self && target.name === w.actor.name) return 'cannot target self';
    if (!w.range(target, d.skill)) return 'out of range';
    if (s.hostile && !hostileAllowed(w, d, target)) return 'unauthorized or immune target';
  }
  return !s.hostile || pullSafe(w, d.targets) ? null : 'unsafe combined pull';
}
const living = (target: SkillDecision['targets'][number]) => !target.dead && !target.rip && target.hp > 0;
function hostileAllowed(w: SkillWorld, d: SkillDecision, target: SkillDecision['targets'][number]): boolean {
  return w.allowed(target, d.skill) && (!target.immune || !!w.skills[d.skill]?.pierces_immunity);
}
// The scatter pull rule: a hostile cast on monsters no one fights pulls them onto this character,
// and goes only while its HP after `PULL_SECONDS` of the incoming damage, those monsters
// included, stays above `PULL_HP_FLOOR` of max HP. The engine's target check and the
// `skills.pullSafe` answer both ask it.
export const PULL_HP_FLOOR = .3, PULL_SECONDS = 2;
export function pullSafe(w: SkillWorld, targets: readonly Combatant[]): boolean {
  if (w.context.mode !== 'scatter') return true;
  const pulled = new Set(targets.filter(t => !t.target).map(t => t.id));
  if (!pulled.size) return true;
  const context = { ...w.context, monsters: w.context.monsters.map(m => pulled.has(m.id) ? { ...m, target: w.actor.name } : m) };
  return w.actor.hp - incomingDps({ ...w, context }, w.actor) * PULL_SECONDS > w.actor.max_hp * PULL_HP_FLOOR;
}
export function blocked(w: SkillWorld, d: SkillDecision, pending = 0): string | null {
  if (w.context.mode === 'blocked' || w.actor.rip) return 'combat activity blocked';
  if (!ownsAggro(w, d)) return 'leader owns aggro transfers';
  if (!unlocked(w, d.skill)) return 'level, equipment, or requirements';
  const s = w.skills[d.skill]!;
  if (w.cooldown(d.skill) || w.cooldown(s.share || d.skill)) return 'cooldown';
  return manaBlock(w, d, pending) || targetBlock(w, d);
}
// The member `targeting.aggroOwner` names owns Taunt, Absorb and Agitate, the leader when none
// answers.
function ownsAggro(w: SkillWorld, d: SkillDecision): boolean {
  return !['absorb', 'taunt', 'agitate'].includes(d.skill) || (w.aggroOwner ?? w.context.leader) === w.actor.name;
}
// The engine asks the MP table (rules.ts `mpRefusal`), the executor's one MP rule, before it proposes a cast.
function manaBlock(w: SkillWorld, d: SkillDecision, pending: number): string | null {
  return mpRefusal({ skill: d.skill, family: d.skill, category: d.category, cost: cost(w, d.skill) + entriesMp(d.argument), belowReserve: d.belowReserve }, w.actor.mp, 0, pending, () => reserve(w));
}
