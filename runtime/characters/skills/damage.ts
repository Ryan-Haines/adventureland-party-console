import type { Combatant, SkillId, SkillWorld } from './types.ts';
import { health } from './types.ts';

function rawDamage(w: SkillWorld, id: SkillId, target: Combatant): number {
  const s = w.skills[id];
  if (id === 'shield_slam') return shieldDamage(w);
  if (id === 'purify') return (s?.damage || 2000) + purifiable(w, target).length * 400;
  return s?.damage ?? w.actor.attack * (s?.damage_multiplier ?? 1);
}
export function purifiable(w: SkillWorld, target: Combatant): string[] {
  return Object.keys(target.s).filter(id => {
    const c = w.condition(id);
    return target.s[id]?.citizens || (c?.buff || c?.debuff) && !c?.persistent;
  });
}
function shieldDamage(w: SkillWorld): number {
  const s = w.skills.shield_slam;
  return w.actor.attack * (s?.damage_multiplier || 3) +
    Math.min(Math.max(0, w.actor.armor), s?.armor_cap || 1000) * (s?.armor_multiplier || 12);
}
function mitigation(w: SkillWorld, id: SkillId, target: Combatant): number {
  const s = w.skills[id];
  const type = id === 'attack' ? w.actor.damage_type : s?.damage_type;
  if (type === 'pure') return 1;
  const defense = type === 'magical' ? Number(target.resistance) - Number(w.actor.rpiercing || 0) :
    Number(target.armor) - Number(w.actor.apiercing || 0) - Number(s?.apiercing || 0);
  return w.damageMultiplier(Number.isFinite(defense) ? defense : 0);
}
export function damage(w: SkillWorld, id: SkillId, target: Combatant, minimum = false): number {
  const s = w.skills[id];
  let result = rawDamage(w, id, target);
  if (!minimum && (id === 'attack' || s?.procs)) result *= criticalMultiplier(w);
  result += stackDamage(w, target);
  result *= mitigation(w, id, target) * targetMultiplier(w, target);
  return minimum ? result * .9 : result;
}
function stackDamage(w: SkillWorld, target: Combatant): number {
  return w.actor.ctype === 'rogue' ? Math.min(w.skills.stack?.max || 2000, (target.s.stack?.s || 0) + 1) : 0;
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
export function incomingDps(w: SkillWorld, actor: Combatant, extraTarget?: string): number {
  return w.context.monsters.filter(m => m.target === actor.name || !!extraTarget && m.target === extraTarget)
    .reduce((sum, m) => {
      if (!Number.isFinite(m.attack) || !Number.isFinite(m.frequency)) return Infinity;
      const defense = m.damage_type === 'magical' ? actor.resistance : actor.armor;
      return sum + m.attack * Number(m.frequency) * w.damageMultiplier(Number(defense) || 0) * 1.1;
    }, 0);
}
export function safeTransfer(w: SkillWorld, source: Combatant, fraction = 1): boolean {
  if (w.now - w.context.observedAt > 1500) return false;
  const current = incomingDps(w, w.actor);
  const added = fraction === 1 ? incomingDps(w, w.actor, source.name) - current : incomingDps(w, source) * fraction;
  return w.actor.hp - 2 * (current + added) > w.actor.max_hp * .3;
}
export function endangered(w: SkillWorld, ally: Combatant): boolean {
  const dps = incomingDps(w, ally);
  return dps > 0 && (health(ally) < .6 || ally.hp - 2 * dps < ally.max_hp * .3);
}
