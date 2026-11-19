import type { SkillId, SkillWorld } from './types.ts';

// How the game server resolves each class skill (node/server.js at the sim's pin 16881a27). The
// ranking (ranking.ts) reads a skill's targets, damage multiplier and spend from here and from its
// game data, never from its name. A skill with no row is one target with its game data's damage.
export interface ServerHandling {
  // `one`: the named target. `list`: the ids the client sends, each checked from the caster. `caster`:
  // every monster strictly inside the radius around the caster, with no ids sent.
  area: 'one' | 'list' | 'caster';
  // The server's own attack multiplier where it rolls one (`commence_attack`): its lowest and mean.
  multiplier?: { low: number; mean: number };
  // The server spends the whole MP pool (Mana Burst, server.js:3444-3445; game data lists `mp: 0`).
  pool?: true;
  // The server deals no damage: a stun, an aggro move or a condition only.
  noDamage?: true;
  // Each listed target carries the MP the caster spends on it (Controlled Mana Burst's `[id, mp]`
  // pairs, :9806-9819): the hit deals that MP times the game data's `ratio` (:3447-3454), and the
  // cast spends the skill's `mp` plus every pair's MP.
  perTargetMp?: true;
  // The most ids or pairs the server reads from one cast's list (:9804, :9808).
  cap?: number;
  // The hit removes the target's buffs and debuffs (Purify's `def.purify`, :4079-4106).
  strips?: true;
}
const HANDLING: Partial<Record<SkillId, ServerHandling>> = {
  '3shot': { area: 'list' }, '5shot': { area: 'list' }, fanofknives: { area: 'list' }, cburst: { area: 'list', perTargetMp: true, cap: 16 },
  // :3383, `0.1 + Math.random() * 0.8`.
  cleave: { area: 'caster', multiplier: { low: .1, mean: .5 } },
  //:3390, `(0.2 + Math.random() * 1.2) * (5% of the status owner, else 1)`.
  shadowstrike: { area: 'caster', multiplier: { low: .2, mean: .8 * 1.55 } },
  stomp: { area: 'caster', noDamage: true }, agitate: { area: 'caster', noDamage: true },
  burst: { area: 'one', pool: true }, purify: { area: 'one', strips: true },
  // Taunt's 1 damage moves aggro; Hunter's Mark and Curse leave a condition (:10736, :3437).
  taunt: { area: 'one', noDamage: true }, huntersmark: { area: 'one', noDamage: true }, curse: { area: 'one', noDamage: true },
};
export function handling(id: SkillId): ServerHandling {
  return HANDLING[id] ?? { area: 'one' };
}
// The monsters one cast may name, as the server cuts a list (node/server.js:9804,
// `gSkill.max_targets || (data.name === "5shot" ? 5 : 3)`; :9808, Controlled Mana Burst's 16 pairs).
export function targetCap(w: SkillWorld, id: SkillId): number {
  const server = handling(id);
  if (server.area !== 'list') return 1;
  return server.cap ?? (w.skills[id]?.max_targets || (id === '5shot' ? 5 : 3));
}
// A skill whose damage lands on every monster in an area around the caster (Cleave, Shadow Strike).
// The targeting owner's group lock and Franky rows let such a cast's victims through,
// and 04 reads it here through runtime/characters/turns/api.ts.
export function hitsAroundCaster(id: string): boolean {
  const server = handling(id as SkillId);
  return server.area === 'caster' && !server.noDamage;
}
