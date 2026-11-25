import { areaOffered, cost, entriesMp, reserve, unlocked, unrestrictedArea } from './eligibility.ts';
import { certainKill, damage, purifiable, splash, usefulDamage } from './damage.ts';
import { handling, targetCap } from './server.ts';
import { familyOf, type Skills } from '../api.ts';
import { endangered, incomingDps } from '../../survival/api.ts';
import { decision, type Combatant, type SkillDecision, type SkillId, type SkillWorld, type TurnsReport } from './types.ts';

// The one damage ranking (default, unconfirmed). It
// runs again at every action edge from that edge's world, keeps no plan between edges, and has no
// class or skill branch: a skill joins by its game data and the server's handling of it (server.ts).
// An option's worth is the party's useful damage over a horizon as long as the longest cooldown
// among the character's options, limited by the MP it can sustain above the turns owner's reserve.

export interface Ranking {
  // The attack family's cast in place of the basic attack, or null for the basic attack.
  attack: SkillDecision | null;
  // The casts of the other cooldown families, best first.
  casts: SkillDecision[];
  // A walk to a spot where a caster-centred cast hits more allowed monsters than here, which 03
  // asks of movement (the movement owner's `movement.step`).
  move: { to: { x: number; y: number }; skill: SkillId; target: string } | null;
  // The party damage one more MP would buy: the damage per MP of the best option the MP over the
  // horizon left short, 0 when every option gets its casts. The status report carries it, so an
  // ally's Energize counts the MP it moves at it (REVIEW-QUEUE TRN-Q-DPS DPS-4).
  perMp: number;
}
// Support MP coming to this character: the seconds until it lands and the MP.
interface Arrival { at: number; mp: number }
interface Option {
  d: SkillDecision;
  family: string;
  // Party damage of one cast, and the MP the server takes for it.
  value: number;
  spend: number;
  // The casts the cooldown allows over the horizon, after any wait for MP.
  casts: number;
  castable: boolean;
  // A pool cast or an urgent area cast reads all the MP the character has, not only MP above the
  // reserve.
  anyMp: boolean;
}

const living = (t: Combatant) => !t.dead && !t.rip && t.hp > 0;
const MS_PER_S = 1000;
const at = (w: SkillWorld) => ({ x: w.actor.x, y: w.actor.y });
// The seconds between two casts of a skill's family: the character's attack interval for the attack
// family (game data `share: "attack"`, server.js:9783 `attack_ms`), else the family's cooldown.
function cooldownSeconds(w: SkillWorld, id: SkillId): number {
  const s = w.skills[id], family = familyOf(w.skills as unknown as Skills, id);
  if (id === 'attack' || family === 'attack') return (s?.cooldown_multiplier || 1) / Math.max(1e-3, Number(w.actor.frequency) || 0);
  const shared = s?.share ? w.skills[s.share] : undefined;
  return (shared ? Number(shared.cooldown || 0) * (s?.cooldown_multiplier || 1) : Number(s?.cooldown || 0)) / MS_PER_S;
}
// The MP the server takes: the class `mp_cost` for the basic attack (server.js:3393-3397), the whole
// pool for a pool skill, else the skill's cost after `mp_reduction`.
function spendOf(w: SkillWorld, id: SkillId, pending: number): number {
  if (id === 'attack') return Number(w.actor.mp_cost) || 0;
  if (handling(id).pool) return Math.max(0, w.actor.mp - pending);
  return cost(w, id);
}
// The damage a second the party lands on a target: each member's attack at its frequency through the
// target's defence for its damage type, from the members' entities.
function partyRate(w: SkillWorld, t: Combatant): number {
  return w.context.allies.reduce((sum, a) => {
    const magical = Reflect.get(a, 'damage_type') === 'magical';
    return sum + (Number(a.attack) || 0) * (Number(a.frequency) || 0) * w.damageMultiplier(Number(magical ? t.resistance : t.armor) || 0);
  }, 0);
}
// What a damage-taken condition (`incdmgamp`, Curse and Hunter's Mark) adds while it lasts: the
// party's damage on the target over the shorter of its duration and the target's remaining life.
function ampValue(w: SkillWorld, condition: string | undefined, t: Combatant, ms?: number): number {
  const c = condition ? w.condition(condition) : undefined, amp = Number(c?.incdmgamp) || 0;
  const remaining = Math.max(0, t.hp - w.incoming(t)), rate = partyRate(w, t);
  if (!amp || !rate || !remaining) return 0;
  const seconds = Math.min((ms ?? (Number(c?.duration) || 0)) / MS_PER_S, remaining / rate);
  return Math.min(remaining, rate * seconds * amp / 100);
}
// The party damage one HP `ally` does not lose is worth (REVIEW-QUEUE TRN-Q-DPS DPS-9, the user's
// answer of 2026-11-13). With a healer reporting, the healer need not restore it, so its MP goes to
// damage: a report names the HP one MP of its heal restores (`healPerMp`) and the damage one more MP
// buys it (`damagePerMp`), and the best healer prices the HP. With none, the ally drinks fewer HP
// potions, and each one frees the shared cooldown for an MP potion: its report's `potionMpPerHp` at its
// own `damagePerMp`. The survival owner's emergency Stomp keeps the stun's survival side.
function hpWorth(w: SkillWorld, ally: string): number {
  const reports = w.reports?.() ?? [], healers = reports.filter(r => Number(r.turns?.healPerMp) > 0);
  if (healers.length) return Math.max(0, ...healers.map(r => (Number(r.turns?.damagePerMp) || 0) / Number(r.turns!.healPerMp)));
  const own = reports.find(r => r.name === ally)?.turns;
  return (Number(own?.potionMpPerHp) || 0) * (Number(own?.damagePerMp) || 0);
}
// What a stopping condition (game data `blocked`, Stomp's `stunned`) prevents: each target it lands
// on stops hitting its party target (the survival owner's `incomingDps` of that monster alone) for the skill's
// `duration`, or the shorter rest of the monster's life under the party's damage, at that member's `hpWorth`.
function stopValue(w: SkillWorld, id: SkillId, targets: Combatant[]): number {
  const condition = w.skills[id]?.condition, c = condition ? w.condition(condition) : undefined;
  if (!c?.blocked) return 0;
  const seconds = (Number(w.skills[id]?.duration) || Number(c?.duration) || 0) / MS_PER_S;
  return targets.reduce((sum, t) => {
    const ally = w.context.allies.find(a => a.name === t.target), worth = ally ? hpWorth(w, ally.name) : 0;
    if (!ally || !worth || t.s[condition!]) return sum;
    const rate = incomingDps({ ...w, context: { ...w.context, monsters: [t] } }, ally), party = partyRate(w, t);
    const life = party > 0 ? Math.max(0, t.hp - w.incoming(t)) / party : seconds;
    return Number.isFinite(rate) ? sum + rate * Math.min(seconds, life) * worth : sum;
  }, 0);
}
// One cast's party damage on its targets: the damage each takes and its splash deals (DPS-6), each
// monster up to its remaining HP however many of the cast's hits reach it, a damage-taken condition
// it leaves on a target without one, less the conditions it strips (Purify), plus the HP a stopping
// condition keeps the monsters from dealing (`stopValue`, DPS-9). `entries` is each
// target's MP for a per-target MP cast (DPS-5), whose damage is per MP.
function castValue(w: SkillWorld, id: SkillId, targets: Combatant[], entries?: readonly number[]): number {
  const condition = w.skills[id]?.condition, dealt = new Map<string, number>();
  const land = (t: Combatant, amount: number) => {
    const before = dealt.get(t.id) ?? 0, taken = Math.min(Math.max(0, t.hp - w.incoming(t) - before), amount);
    dealt.set(t.id, before + taken);
    return taken;
  };
  return targets.reduce((sum, t, i) => {
    const added = condition && !t.s[condition] ? ampValue(w, condition, t) : 0;
    // A stripping hit removes every condition `purifiable` names (server.js:4079-4106), and a
    // damage-taken debuff it removes takes its remaining effect with it.
    const stripped = handling(id).strips ? purifiable(w, t).reduce((s, c) => s + ampValue(w, c, t, t.s[c]?.ms), 0) : 0;
    const hit = land(t, damage(w, id, t) * (entries ? entries[i] : 1));
    return sum + hit + splash(w, id, t).reduce((s, v) => s + land(v.victim, v.damage), 0) + added - stripped;
  }, 0) + stopValue(w, id, targets);
}
// A monster the cast may hit: targeting's gates allow it, or it dies for certain and 04 refuses it
// only because nobody engaged it (TRN-Q-DPS "The one-shot exception"). `low` is the hit's lowest
// damage when it is not the cast's own (a splash). A monster whose death the game ties to a respawn
// as another monster (game data `respawn_as`, server.js:13476-13477; DPS-7) never meets the exception.
function admitted(w: SkillWorld, id: SkillId, t: Combatant, low?: number): boolean {
  return w.allowed(t, id) || !Reflect.get(t, 'respawn_as') && certainKill(w, id, t, low) && !!w.pullOnly?.(t, id);
}
// A hit the cast may make: its target is admitted and so is every monster its splash reaches, so a
// splash onto a refused monster refuses the hit as an area hit is refused (DPS-6).
function clean(w: SkillWorld, id: SkillId, t: Combatant): boolean {
  return admitted(w, id, t) && splash(w, id, t).every(v => admitted(w, id, v.victim, v.low));
}
// The monsters a caster-centred cast hits from a point: every living one strictly inside its radius
// (server.js:10771, `dist < gSkill.range`). Null when one of them may not be hit.
function areaHits(w: SkillWorld, id: SkillId, from: { x: number; y: number }): Combatant[] | null {
  const radius = Number(w.skills[id]?.range) || 0;
  const hit = w.context.monsters.filter(t => living(t) && Math.hypot(t.x - from.x, t.y - from.y) < radius);
  return hit.every(t => clean(w, id, t)) ? hit : null;
}
// The monsters the server would hit from where the character stands, by the skill's area.
function hitsHere(w: SkillWorld, id: SkillId, primary: Combatant): Combatant[] {
  const area = handling(id).area;
  if (area === 'caster') return areaHits(w, id, at(w)) ?? [];
  const usable = (t: Combatant) => living(t) && w.range(t, id) && clean(w, id, t);
  if (area === 'one') return usable(primary) ? [primary] : [];
  if (!usable(primary)) return [];
  const others = w.context.monsters.filter(t => t.id !== primary.id && usable(t))
    .sort((a, b) => usefulDamage(w, id, b) - usefulDamage(w, id, a) || a.id.localeCompare(b.id));
  return [primary, ...others].slice(0, targetCap(w, id));
}
// The support casts that give an ally attack speed (game data: a `player` target whose condition has
// `frequency`, Energize's `energized`). The status report carries their readiness (runtime.ts
// `report`), and the ranking scores what one gives.
export function speedSupport(w: SkillWorld): SkillId[] {
  return (Object.keys(w.skills) as SkillId[]).filter(id => w.skills[id]?.target === 'player' && unlocked(w, id) &&
    !!Number(w.skills[id]?.condition && w.condition(w.skills[id]!.condition!)?.frequency));
}
// The party damage one support cast gives: the ally's attack at the condition's added frequency for
// its duration, plus the MP the class file moves at the ally's damage per MP from its own report
// (DPS-4). With a target set, only that ally counts; with none, the strongest ally in range that
// misses MP.
function supportValues(w: SkillWorld): { id: SkillId; value: number }[] {
  const sets = w.support?.() ?? {}, reports = w.reports?.() ?? [];
  const perMp = (name: string) => Number(reports.find(r => r.name === name)?.turns?.damagePerMp) || 0;
  return speedSupport(w).flatMap(id => {
    const c = w.condition(w.skills[id]!.condition!)!, set = sets[id];
    const best = Math.max(0, ...w.context.allies.filter(a => a.name !== w.actor.name && a.mp < Number(a.max_mp) && w.range(a, id) &&
      (!set || a.name === set.target)).map(a => (Number(a.attack) || 0) * (Number(a.frequency) || 0) * Number(c.frequency) / 100 *
      (Number(c.duration) || 0) / MS_PER_S + (set ? set.mp * perMp(a.name) : 0)));
    return best ? [{ id, value: best }] : [];
  });
}
// The support MP coming to this character within the horizon (DPS-3): each member report's support
// cast set on this character, from a member whose cast reaches it (the skill's game data `range`),
// landing at its ready time. A cast set on another member is promised there and counts nothing here.
function coming(w: SkillWorld, horizon: number): Arrival[] {
  type Entry = NonNullable<TurnsReport['support'][SkillId]>;
  return (w.reports?.() ?? []).filter(r => r.name !== w.actor.name).flatMap(r =>
    (Object.entries(r.turns?.support ?? {}) as [SkillId, Entry | undefined][]).flatMap(([id, e]) => {
      const ally = w.context.allies.find(a => a.name === r.name);
      if (!e || e.target !== w.actor.name || !(e.mp > 0) || !ally ||
        Math.hypot(ally.x - w.actor.x, ally.y - w.actor.y) > (Number(w.skills[id]?.range) || 0)) return [];
      const after = Math.max(0, (e.readyAt - w.now) / MS_PER_S);
      return after < horizon ? [{ at: after, mp: e.mp }] : [];
    })).sort((a, b) => a.at - b.at);
}
// The seconds until the character gains `need` MP from its income and the support coming to it.
function waitFor(need: number, income: number, arrivals: Arrival[]): number {
  if (need <= 0) return 0;
  let got = 0, t = 0;
  for (const a of arrivals) {
    if (income > 0 && got + income * (a.at - t) >= need) return t + (need - got) / income;
    got += Math.max(0, income) * (a.at - t) + a.mp; t = a.at;
    if (got >= need) return t;
  }
  return income > 0 ? t + (need - got) / income : Infinity;
}
// Controlled Mana Burst's pairs (DPS-5): each target in order gets the MP whose lowest roll covers
// its remaining HP, from `mp`, until that runs out. A target that needs none is left out.
function pairs(w: SkillWorld, id: SkillId, targets: Combatant[], mp: number): { targets: Combatant[]; entries: number[] } {
  const out = { targets: [] as Combatant[], entries: [] as number[] };
  for (const t of targets) {
    const perMp = damage(w, id, t, true);
    const need = perMp > 0 ? Math.min(Math.floor(mp), Math.ceil(Math.max(0, t.hp - w.incoming(t)) / perMp)) : 0;
    if (need < 1) continue;
    out.targets.push(t); out.entries.push(need); mp -= need;
  }
  return out;
}
// The party damage lost when a cast leaves the character at or below its reserve, where its support
// casts give nothing (mage.ts gives only MP above the reserve): each support cast its cooldown allows
// before income and the support coming to it bring the MP back over the reserve, within the horizon.
function supportLoss(w: SkillWorld, mpAfter: number, income: number, horizon: number, arrivals: Arrival[]): number {
  const floor = reserve(w);
  if (mpAfter > floor) return 0;
  const refill = Math.min(horizon, waitFor(floor - mpAfter, income, arrivals));
  return supportValues(w).reduce((sum, s) => {
    const cd = cooldownSeconds(w, s.id);
    return sum + s.value * (cd > 0 ? Math.ceil(refill / cd) : 1);
  }, 0);
}

// `pending` is the MP of the spends in flight (the executor's ledger); `income` is the MP a second
// the character's reports showed it gaining (budget.ts).
export function rank(world: SkillWorld, primary: Combatant, pending = 0, income = 0): Ranking {
  // One rank reads one snapshot of the world, so the splash victims damage.ts keeps per world hold
  // for this rank and no later one.
  const w: SkillWorld = { ...world };
  const none: Ranking = { attack: null, casts: [], move: null, perMp: 0 };
  // A class that heals (game data `G.skills.heal.class`) spends nothing on damage while a member
  // reads below the survival owner's healthy share (b9b5c91e's priest Curse wait, E03-s2).
  if (w.skills.heal?.class?.includes(w.actor.ctype) && w.healthy?.() === false) return none;
  const ids = (Object.keys(w.skills) as SkillId[]).filter(id => id !== 'attack' && w.skills[id]?.hostile && unlocked(w, id));
  const horizon = Math.max(cooldownSeconds(w, 'attack'), ...ids.map(id => cooldownSeconds(w, id)));
  const mp = w.actor.mp - pending, above = mp - reserve(w);
  const arrivals = coming(w, horizon), comingMp = arrivals.reduce((sum, a) => sum + a.mp, 0);
  const basic = castValue(w, 'attack', [primary]), basicSpend = spendOf(w, 'attack', pending);
  const options: Option[] = [];
  for (const id of ids) {
    let targets = hitsHere(w, id, primary), entries: number[] | undefined;
    if (handling(id).perTargetMp) ({ targets, entries } = pairs(w, id, targets, above - cost(w, id)));
    if (!targets.length) continue;
    const family = familyOf(w.skills as unknown as Skills, id), attackFamily = family === 'attack';
    let d: SkillDecision = entries ? { ...decision(id, targets), argument: entries } : decision(id, targets);
    if (!areaOffered(w, d)) continue;
    if (unrestrictedArea(w, d)) d = { ...d, belowReserve: true };
    const spend = spendOf(w, id, pending) + entriesMp(entries), mpAfter = mp - spend;
    const refill = income * horizon + comingMp + (w.mpPotion?.(mpAfter) ?? 0);
    // A pool cast spends the reserve too, so it goes only when income, the support coming to the
    // character and the survival owner's potion bring the reserve back within the horizon.
    if (handling(id).pool && (mp <= 0 || refill < reserve(w))) continue;
    const anyMp = !!handling(id).pool || !!d.belowReserve;
    // The attack family's skills replace a basic attack, so they count what they add over it.
    const value = castValue(w, id, targets, entries) - (attackFamily ? basic : 0) - supportLoss(w, mpAfter, income, horizon, arrivals);
    const extra = attackFamily ? spend - basicSpend : spend;
    if (value <= 0) continue;
    // Waiting for MP costs damage: the casts the cooldown allows shrink by the wait, which income and
    // the support coming to the character shorten.
    const wait = waitFor(extra - (anyMp ? mp : above), income, arrivals);
    if (wait >= horizon) continue;
    const cd = cooldownSeconds(w, id);
    options.push({ d, family, value, spend: extra, castable: wait === 0, anyMp,
      casts: handling(id).pool ? 1 : cd > 0 ? (horizon - wait) / cd : 1 });
  }
  const { chosen, perMp } = allocate(bestOfFamily(options), Math.max(0, above) + income * horizon + comingMp, above, mp);
  return { attack: chosen.find(o => o.family === 'attack')?.d ?? null,
    casts: chosen.filter(o => o.family !== 'attack').map(o => o.d), move: position(w, primary, options, horizon), perMp };
}
// One cooldown family casts one skill at a time, so each family offers its highest-value option.
function bestOfFamily(options: Option[]): Option[] {
  const best = new Map<string, Option>();
  for (const o of options) {
    const kept = best.get(o.family);
    if (!kept || o.value > kept.value || o.value === kept.value && o.spend < kept.spend) best.set(o.family, o);
  }
  return [...best.values()];
}
// The MP over the horizon goes to the options by damage per MP, each up to the casts its cooldown
// allows, so with MP to spare every option gets its casts. An option with a share goes now when its
// MP is there. One still waiting for MP holds every later option that spends MP, since spending now
// delays it. `perMp` is the damage per MP of the first option, in that order, that gets fewer casts
// than its cooldown allows or none now.
function allocate(options: Option[], budget: number, above: number, mp: number): { chosen: Option[]; perMp: number } {
  const order = [...options].sort((a, b) => ratio(b) - ratio(a) || b.value - a.value);
  const chosen: Option[] = [];
  let left = Math.max(0, above), held = false, perMp = 0;
  const short = (o: Option) => { if (!perMp && o.spend > 0) perMp = ratio(o); };
  for (const o of order) {
    const share = o.spend > 0 ? Math.min(o.casts, budget / o.spend) : o.casts;
    if (share < o.casts) short(o);
    if (share <= 0) continue;
    budget -= share * Math.max(0, o.spend);
    if (!o.castable) { if (o.spend > 0) held = true; short(o); continue; }
    if (o.spend > 0 && (held || o.spend > (o.anyMp ? mp : left))) { short(o); continue; }
    chosen.push(o);
    left -= Math.max(0, o.spend); mp -= Math.max(0, o.spend);
  }
  return { chosen, perMp };
}
const ratio = (o: Option) => o.spend > 0 ? o.value / o.spend : Infinity;
const rate = (o: Option, horizon: number) => o.value * o.casts / horizon;
// Position as an option (TRN-Q-DPS "Position as an option"): for a caster-centred cast, a spot on an
// allowed monster where the cast hits only monsters it may hit, more of them than here. The walk
// pays for itself: the party damage the cast gains there, less the damage the character's best
// option here would have done during the travel, must beat the best option here. The survival owner's danger
// reading (`endangered`) at the spot, with the monsters hit there on the character, refuses it.
function position(w: SkillWorld, primary: Combatant, options: Option[], horizon: number): Ranking['move'] {
  const speed = Number(w.actor.speed) || 0;
  if (!speed) return null;
  const here = Math.max(0, ...options.map(o => rate(o, horizon)));
  let best: Ranking['move'] = null, bestGain = here;
  for (const id of Object.keys(w.skills) as SkillId[]) {
    if (handling(id).area !== 'caster' || !w.skills[id]?.hostile || !unlocked(w, id) || w.cooldown(id)) continue;
    const cd = cooldownSeconds(w, id), casts = cd > 0 ? horizon / cd : 1;
    // The walk's reach comes first: it is arithmetic, and a spot past the horizon gains nothing
    // whatever targeting's gate and the area's hits would answer.
    for (const spot of w.context.monsters) {
      if (!living(spot)) continue;
      const travel = Math.hypot(spot.x - w.actor.x, spot.y - w.actor.y) / speed;
      if (travel >= horizon || !w.allowed(spot, id)) continue;
      const hits = areaHits(w, id, spot);
      if (!hits || !hits.length || !areaOffered(w, decision(id, hits))) continue;
      const gain = (castValue(w, id, hits) * casts - here * travel) / horizon;
      if (gain <= bestGain || dangerAt(w, spot, hits)) continue;
      best = { to: { x: spot.x, y: spot.y }, skill: id, target: primary.id }; bestGain = gain;
    }
  }
  return best;
}
function dangerAt(w: SkillWorld, spot: { x: number; y: number }, hits: Combatant[]): boolean {
  const actor = { ...w.actor, x: spot.x, y: spot.y };
  const hit = new Set(hits.map(t => t.id));
  const moved = { ...w, actor, context: { ...w.context, monsters: w.context.monsters.map(m => hit.has(m.id) ? { ...m, target: actor.name } : m) } };
  return endangered(moved, actor as unknown as Combatant);
}
