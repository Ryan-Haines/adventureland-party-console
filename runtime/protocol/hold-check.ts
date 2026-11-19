// The hold check: a fighter holds while its healing keeps up with the damage it takes. A group walk's defense
// calls it, and survival answers an add-on's `{hold}` verdict with it. Every rate is per
// second over the attackers' own attack cycles (an attacker's attack times its frequency), so a
// burst inside one cycle moves only the HP left, never the rates. The HP left is the
// character's real HP, so crits and procs the rates miss still show in it.

export interface PotionSupply {
  hp: { count: number; gives: number }; mp: { count: number; gives: number };
  // G.skills.use_hp and use_mp share the `potion` cooldown group: 2 s per potion.
  cooldownSeconds: number;
  // G.skills.regen_mp: 100 MP per 4 s, only while the tank has no MP potion.
  regenMp: { output: number; cooldownSeconds: number };
}
export interface HoldInput {
  hp: number; mp: number;
  // A priest tank heals itself, so its mana feeds its healing.
  priest: boolean;
  // The healing the tank gets: its own heal (priest) or its healer's, null with no healer.
  heal: { amount: number; perSecond: number; mpPerHeal: number } | null;
  // Each attacker's damage per second, its HP left and the damage of one of its blows.
  attackers: readonly { dps: number; hp: number; blow?: number }[];
  // The attackers' HP lost per second, observed; null before the first loss.
  killRate: number | null;
  // How long the step away takes, and one heal cycle.
  stepSeconds: number; healCycleSeconds: number;
  // The largest hit the tank took since contact began. Hits come in whole blows, so the HP that
  // covers a step and a heal cycle must also outlast the next blow of every attacker, which can
  // all land at once (`nextBlows`); a measured hit larger than the biggest attacker's blow (a
  // crit) stands in for that blow. In one step 11 run a tank holding 2,526 HP at a 2,150 a second
  // loss died on its step away.
  largestHit?: number;
  potions: PotionSupply;
  // A party mage in energize range moves up to its whole mana (G.skills.energize).
  energizeMp: number;
  // The tank's MP lost per second since contact began, measured, or null before one heal
  // cycle has passed. It carries every heal, party heal and skill the tank cast and every
  // potion or regeneration it got, which the model above misses.
  mpLossRate?: number | null;
}
export interface HoldResult {
  // The fight fails: the tank steps away.
  fails: boolean;
  // HP and mana last until the fight ends: a tank that stepped away returns.
  recovered: boolean;
  reason: 'hp' | 'mana' | null;
  // `mpLoss` and `reserve` are the measured mana loss and the mana it is set against, for the records.
  rates: { damage: number; heal: number; hpPotions: number; net: number; fightSeconds: number; manaSeconds: number; mpLoss: number | null; reserve: number };
}

// How long the tank's mana lasts at `drain` per second, with or without its MP potions.
function manaSeconds(input: HoldInput, drain: number, withPotions: boolean): number {
  if (drain <= 0) return Infinity;
  const { potions } = input;
  let mana = input.mp + input.energizeMp, at = 0;
  if (withPotions && potions.mp.count > 0) {
    const phase = potions.mp.count * potions.cooldownSeconds, net = drain - potions.mp.gives / potions.cooldownSeconds;
    if (net > 0 && mana <= net * phase) return mana / net;
    if (net > 0) mana -= net * phase;
    at = phase;
  }
  const net = drain - potions.regenMp.output / potions.regenMp.cooldownSeconds;
  return net <= 0 ? Infinity : at + mana / net;
}

// Damage that lands at the rate over any span stays under the rate times the span plus one blow
// of each attacker, so that sum is the HP the continuous check must hold back.
export function nextBlows(input: Pick<HoldInput, 'attackers' | 'largestHit'>): number {
  const blows = input.attackers.map(a => a.blow ?? 0), biggest = Math.max(0, ...blows);
  return blows.reduce((sum, b) => sum + b, 0) - biggest + Math.max(biggest, input.largestHit ?? 0);
}
// How long the HP lasts at a net loss of `net` per second once the next blows land: the tank's
// time to death.
export function hpSeconds(input: Pick<HoldInput, 'hp' | 'attackers' | 'largestHit'>, net: number): number {
  return net > 0 ? (input.hp - nextBlows(input)) / net : Infinity;
}
export function holdCheck(input: HoldInput): HoldResult {
  const damage = input.attackers.reduce((sum, a) => sum + a.dps, 0);
  const left = input.attackers.reduce((sum, a) => sum + a.hp, 0);
  const fightSeconds = input.killRate && input.killRate > 0 ? left / input.killRate : Infinity;
  // A priest tank spends mana on every heal; another tank's heals cost it nothing.
  const drain = input.priest && input.heal && damage > 0 ? input.heal.mpPerHeal * input.heal.perSecond : 0;
  // The measured loss outruns the model when the tank spends mana on more than its self heal
  // or the potion group is busy with HP potions; the mana it still has, its MP potions and a
  // mage's energize then last at the measured rate.
  const reserve = input.mp + input.energizeMp + input.potions.mp.count * input.potions.mp.gives;
  const measured = input.priest && input.mpLossRate && input.mpLossRate > 0 ? reserve / input.mpLossRate : Infinity;
  const lasts = Math.min(manaSeconds(input, drain, true), measured);
  // The fight's end is unknown before the first kill rate, so mana cannot fail it yet.
  const manaFails = Number.isFinite(fightSeconds) && lasts < fightSeconds;
  // When mana is the bottleneck the potion group goes to mana, so the HP check counts no HP potion.
  const manaNeedsPotions = Number.isFinite(fightSeconds) && manaSeconds(input, drain, false) < fightSeconds;
  const heal = input.heal && (!input.priest || input.mp >= input.heal.mpPerHeal) ? input.heal.amount * input.heal.perSecond : 0;
  const hpPotions = input.potions.hp.count > 0 && !manaNeedsPotions ? input.potions.hp.gives / input.potions.cooldownSeconds : 0;
  const net = damage - heal - hpPotions;
  const hpFails = net > 0 && hpSeconds(input, net) < input.stepSeconds + input.healCycleSeconds;
  const hpLasts = net <= 0 || input.hp / net >= fightSeconds;
  const reason = hpFails ? 'hp' : manaFails ? 'mana' : null;
  return { fails: !!reason, recovered: hpLasts && !manaFails, reason,
    rates: { damage, heal, hpPotions, net, fightSeconds, manaSeconds: lasts, mpLoss: input.mpLossRate ?? null, reserve } };
}

export interface FightMember { name: string; ctype?: string; hp?: number; attack?: number; frequency?: number; armor?: number; resistance?: number; rip?: boolean }
export interface FightAttacker { mtype?: string; hp?: number; target?: string }
export interface FightMonster { attack?: number; frequency?: number; damage_type?: string }

// The game's damage multiplier for a defense value (js/old_common_functions.js damage_multiplier).
export function damageMultiplier(defense: number): number {
  const band = (from: number, rate: number, width = 100) => Math.max(0, Math.min(width, defense - from)) * rate;
  return Math.min(1.32, Math.max(0.05, 1 - (band(0, 0.001) + band(100, 0.001) + band(200, 0.00095) + band(300, 0.0009) + band(400, 0.00082) +
    band(500, 0.0007) + band(600, 0.0006) + band(700, 0.0005) + Math.max(0, defense - 800) * 0.0004) +
    Math.max(0, Math.min(50, -defense)) * 0.001 + Math.max(0, Math.min(50, -50 - defense)) * 0.00075 +
    Math.max(0, Math.min(50, -100 - defense)) * 0.0005 + Math.max(0, -150 - defense) * 0.00025));
}

// Monsters a group walk walks into are the walk's to
// fight, unless the fight is one the party cannot win; that fight is its own task, so the walk
// goes on and survival's rules decide any escape. "Cannot win" is the hold check's judgement on
// game data and the fight as it stands, never a count: a member the attackers target cannot last
// until the party kills them at its own damage per second.
export function fightWinnable(members: readonly FightMember[], attackers: readonly FightAttacker[],
  monsters: Readonly<Record<string, FightMonster | undefined>> | null): boolean {
  if (!monsters || !attackers.length) return true;
  const alive = members.filter(m => !m.rip && Number(m.hp) > 0);
  const healer = alive.find(m => m.ctype === 'priest');
  // The priest's heal takes one target a cast on its attack cycle (G.skills.heal), so while any member
  // is targeted its casts go to heals, split over the targeted members, and none to the kill rate.
  const targeted = alive.filter(m => attackers.some(a => a.target === m.name)).length;
  const partyDps = alive.reduce((sum, m) => m === healer && targeted ? sum : sum + Number(m.attack ?? 0) * Number(m.frequency ?? 0), 0);
  const left = attackers.reduce((sum, a) => sum + Number(a.hp ?? 0), 0);
  return alive.every(m => {
    const on = attackers.filter(a => a.target === m.name);
    if (!on.length) return true;
    const dps = on.reduce((sum, a) => {
      const g = monsters[a.mtype ?? ''] ?? {};
      const defense = g.damage_type === 'magical' ? Number(m.resistance ?? 0) : g.damage_type === 'pure' ? 0 : Number(m.armor ?? 0);
      return sum + Number(g.attack ?? 0) * Number(g.frequency ?? 0) * (g.damage_type === 'pure' ? 1 : damageMultiplier(defense));
    }, 0);
    const check = holdCheck({ hp: Number(m.hp), mp: 0, priest: false,
      heal: healer ? { amount: Number(healer.attack ?? 0), perSecond: Number(healer.frequency ?? 0) / targeted, mpPerHeal: 0 } : null,
      attackers: [{ dps, hp: left }], killRate: partyDps > 0 ? partyDps : null, stepSeconds: 0, healCycleSeconds: 0,
      potions: { hp: { count: 0, gives: 0 }, mp: { count: 0, gives: 0 }, cooldownSeconds: 0, regenMp: { output: 0, cooldownSeconds: 1 } }, energizeMp: 0 });
    return check.recovered;
  });
}
