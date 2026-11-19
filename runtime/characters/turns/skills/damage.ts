import type { Combatant, SkillId, SkillWorld } from './types.ts';
import { handling } from './server.ts';

// The damage one hit does, as node/server.js `commence_attack` and `complete_attack` compute it.
function rawDamage(w: SkillWorld, id: SkillId, target: Combatant, minimum: boolean): number {
  const s = w.skills[id], server = handling(id);
  if (server.noDamage) return 0;
  // Mana Burst turns the pool at the cast into damage (`attacker.mp * G.skills.burst.ratio`).
  if (server.pool) return Math.max(0, w.actor.mp) * (Number(Reflect.get(s ?? {}, 'ratio')) || 0);
  // Controlled Mana Burst's hit is its pair's MP times `ratio` (:3447-3454), so its damage here is
  // one MP's; the ranking sizes each pair from it.
  if (server.perTargetMp) return Number(Reflect.get(s ?? {}, 'ratio')) || 0;
  if (id === 'shield_slam') return shieldDamage(w);
  // Purify deals its `damage` plus `condition_damage` for each condition it strips (game data `purify`).
  if (id === 'purify') return (Number(s?.damage) || 0) + purifiable(w, target).length * (Number(s?.condition_damage) || 0);
  const roll = server.multiplier;
  return s?.damage ?? w.actor.attack * (roll ? minimum ? roll.low : roll.mean : s?.damage_multiplier ?? 1);
}
export function purifiable(w: SkillWorld, target: Combatant): string[] {
  return Object.keys(target.s).filter(id => {
    const c = w.condition(id);
    return target.s[id]?.citizens || (c?.buff || c?.debuff) && !c?.persistent;
  });
}
// Shield Slam's attack and armor terms read game data `shield_slam`; a field the data lacks adds
// nothing, so the ranking drops a cast it cannot price.
function shieldDamage(w: SkillWorld): number {
  const s = w.skills.shield_slam;
  return w.actor.attack * (Number(s?.damage_multiplier) || 0) +
    Math.min(Math.max(0, w.actor.armor), Number(s?.armor_cap) || 0) * (Number(s?.armor_multiplier) || 0);
}
const damageType = (w: SkillWorld, id: SkillId) => id === 'attack' ? w.actor.damage_type : w.skills[id]?.damage_type;
function mitigation(w: SkillWorld, id: SkillId, target: Combatant): number {
  const s = w.skills[id];
  const defense = damageType(w, id) === 'magical' ? Number(target.resistance) - Number(w.actor.rpiercing || 0) :
    Number(target.armor) - Number(w.actor.apiercing || 0) - Number(s?.apiercing || 0);
  return w.damageMultiplier(Number.isFinite(defense) ? defense : 0);
}
// `minimum` is the server's lowest roll: no crit, the low multiplier and 0.9 of the roll.
export function damage(w: SkillWorld, id: SkillId, target: Combatant, minimum = false): number {
  let result = rawDamage(w, id, target, minimum);
  // The server sets a pure hit back to the attack at the cast (:4217), so it has no roll, crit,
  // stack, defence or amplification.
  if (damageType(w, id) === 'pure') return Math.ceil(result);
  if (!minimum && procs(w, id)) result *= criticalMultiplier(w);
  result += stackDamage(w, target);
  result *= mitigation(w, id, target) * targetMultiplier(w, target);
  return minimum ? result * .9 : result;
}
// A certain kill (TRN-Q-DPS "The one-shot exception"): the lowest roll reaches the target's current
// HP and nothing on either side can make the hit miss (:3816-3906). The target's avoidance, its
// evasion against a physical hit, its reflection against a magical one, the attacker's miss and a
// `1hp` target each rule it out.
export function certainKill(w: SkillWorld, id: SkillId, target: Combatant, low = damage(w, id, target, true)): boolean {
  const type = damageType(w, id);
  if (read(target, 'avoidance') || read(w.actor, 'miss') || Reflect.get(target, '1hp')) return false;
  if (type === 'physical' && read(target, 'evasion')) return false;
  if (type === 'magical' && read(target, 'reflection') && !w.skills[id]?.no_reflection) return false;
  return low >= target.hp;
}
const read = (from: object, key: string) => Number(Reflect.get(from, key)) || 0;
// The server copies the attacker's crit, explosion and blast only onto a hit whose skill has
// `procs` (:3307-3309, :3533-3539); the basic attack has them (game data `attack`).
const procs = (w: SkillWorld, id: SkillId) => id === 'attack' || !!w.skills[id]?.procs;
// Splash (REVIEW-QUEUE TRN-Q-DPS DPS-6; server.js:3975-4013, :4224-4226): a procs hit with the
// attacker's `explosion` (physical) or `blast` (magical) also hits every other monster strictly
// inside `intensity / 3.6` of its target, for the target's hit times the victim's defence
// multiplier times `intensity / 100`. A pure hit has neither type, so it never splashes. `low` is
// that damage at the server's lowest roll, for the one-shot exception.
// One world's splash victims per skill and target: one rank (ranking.ts, which ranks on its own
// snapshot of the world) reads them for every hit, spot and position, so each is found once.
type Splash = { victim: Combatant; damage: number; low: number }[];
const splashes = new WeakMap<SkillWorld, Map<string, Splash>>();
export function splash(w: SkillWorld, id: SkillId, target: Combatant): Splash {
  const own = splashes.get(w) ?? new Map<string, Splash>(), key = id + '|' + target.id, kept = own.get(key);
  if (kept) return kept;
  const found = splashOf(w, id, target);
  own.set(key, found); splashes.set(w, own);
  return found;
}
function splashOf(w: SkillWorld, id: SkillId, target: Combatant): Splash {
  const type = damageType(w, id);
  const intensity = !procs(w, id) ? 0 : type === 'physical' ? read(w.actor, 'explosion') : type === 'magical' ? read(w.actor, 'blast') : 0;
  if (intensity <= 0) return [];
  const radius = intensity / 3.6, hit = damage(w, id, target), low = damage(w, id, target, true);
  return w.context.monsters.filter(m => m.id !== target.id && !m.dead && m.hp > 0 && Math.hypot(m.x - target.x, m.y - target.y) < radius)
    .map(victim => {
      const share = w.damageMultiplier(read(victim, type === 'physical' ? 'armor' : 'resistance')) * intensity / 100;
      return { victim, damage: hit * share, low: low * share };
    });
}
function stackDamage(w: SkillWorld, target: Combatant): number {
  // The rogue's stack adds one per stack up to game data `stack.max`.
  return w.actor.ctype === 'rogue' ? Math.min(Number(w.skills.stack?.max) || 0, (target.s.stack?.s || 0) + 1) : 0;
}
function targetMultiplier(w: SkillWorld, target: Combatant): number {
  const fortitude = Number(Reflect.get(target, 'for')) || 0;
  const amp = Number(Reflect.get(target, 'incdmgamp')) || 0;
  return w.damageMultiplier(fortitude * 5) * (1 + amp / 100);
}
function criticalMultiplier(w: SkillWorld): number {
  return 1 + Math.min(1, (w.actor.crit || 0) / 100) * ((w.actor.critdamage || 0) / 100 + 1);
}
export const usefulDamage = (w: SkillWorld, id: SkillId, target: Combatant) =>
  Math.min(Math.max(0, target.hp - w.incoming(target)), damage(w, id, target));
