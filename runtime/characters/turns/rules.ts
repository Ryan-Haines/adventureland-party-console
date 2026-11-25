// The turns owner's rule tables: the spend table who may spend now, the MP table what MP a spend needs and the reply table what a reply
// books. The rank table, who wins a family, is the one rank table's `SPEND_RANKS` (runtime/protocol/ranks.ts) and
// the registration order inside a rank. Every other reader asks these through `skills.allows` and the
// executor.
import type { SpendRank } from '../../protocol/ranks.ts';
import type { SkillWorld } from './skills/types.ts';
import { cost, unlocked } from './skills/eligibility.ts';
import { eventFacts } from '../../events/api.ts';
import { survivalOccupies } from '../survival/api.ts';
import type { TurnsFacts } from './stand-ins/holds.ts';
import { combatHold } from '../../movement/api/character.ts';

// One occupied row (O1 to O18): its read of today's fact, and the owner whose fact it is.
export interface OccupiedRow { row: string; source: string; read(): boolean | null }

// The spend table's occupied rows O1 to O18 (CF2's table), in `isOccupied`'s order (b9b5c91e shared.js:17494),
// each with the owner whose fact holds it. A row's null passes to the next row and true holds; O1,
// O4 and O18 answer false to clear the rows after them, as `isOccupied`'s early returns did.
export function occupiedRows(f: TurnsFacts): readonly OccupiedRow[] {
  return [
    // O1: a Cave the member's visit owns holds the turn while this runtime is not current, the lifecycle owner's drain
    // holds or the Cave is paused, and clears the rows after it otherwise.
    { row: 'O1', source: '07 (S-07c), its maintenance clause 13', read: () => f.dungeonOwned() ? !f.current() || f.leased() || f.cavePaused() : null },
    { row: 'O2', source: '10 (E03-10a)', read: () => f.previewing() || null },
    { row: 'O3', source: '13 (`lifecycle.drain`)', read: () => f.leased() || null },
    { row: 'O4', source: '06 (S-06c)', read: f.returnCombat },
    { row: 'O5', source: '06', read: () => eventFacts().exitRunning() || null },
    { row: 'O6', source: '02', read: () => combatHold(f.walk(), f.walkState()) === 'group' || null },
    { row: 'O7', source: '10 (E03-10a)', read: () => f.merchantTidy() || null },
    // O8: a walk's own fight, outside a Hunt's defense and a departure's fight. O9: the Hunt's loot
    // pass, outside a departure's fight.
    { row: 'O8', source: '02, outside 07 (S-07c) and 04', read: () => f.travelCombat() && !f.huntDefense() && !f.departureCombat() || null },
    { row: 'O9', source: '07 (S-07c), outside 04', read: () => f.huntLoot() && !f.departureCombat() || null },
    { row: 'O10', source: '05', read: () => survivalOccupies() || null },
    { row: 'O11', source: '05', read: () => f.escape() || null },
    { row: 'O12', source: '07 (S-07c)', read: () => f.rare() || null },
    { row: 'O14', source: '01', read: () => !!f.reunion() && !f.reunionBlocked() || null },
    { row: 'O15', source: '10 (E03-10a)', read: () => f.errands() || null },
    // O16, the movement owner's walks that hold combat (a forced or Town walk, Town, a group walk that is not
    // defending, a follow), and the merchant jobs owner's gathering.
    { row: 'O16', source: '02, and 08 (S-08) for gathering', read: () => !!combatHold(f.walk(), f.walkState()) || f.gathering() || null },
    { row: 'O17', source: '06', read: () => eventFacts().eventTravelling() || null },
    // O18: a departure or a queued bank visit holds the turn while no monster is engaged.
    { row: 'O18', source: '02 and 10, outside 04', read: () => f.departing() || f.bankQueued() ? !f.monsterEngaged() : null },
  ];
}

// The spend table's facts on one read: the install's own state, the game's, the tasks owner's hand holds,
// survival's Cave revival, the class role and the stand-ins'.
export interface HoldFacts {
  active: boolean; rip: boolean;
  hand: { combat?: boolean; usePotions?: boolean } | null;
  // The A/B mode, read after the occupied rows, in the tick's order.
  abtesting(): string | undefined; revive: boolean; roleCombat: boolean;
  merchant: boolean; merchantEventFight: boolean; dungeonOwned: boolean;
  occupied: readonly OccupiedRow[];
}
// What one read of the spend table lets spend. `stop` is the row that holds the whole loop (H1, H2, H6, H7, or
// an occupied row): the role loop's sources ask nothing, and a stop row before the occupied rows
// asks nothing at all. The narrowing rows (H4, H5, H8 to H11) hold together, as
// `combatAllowed`'s conjunction and `passingTarget`'s first lines did (runner.ts:167-186 at 3c624f28).
export interface Hold {
  stop: { row: string; source: string } | null;
  // Any request asks on this pass; false under H1, H2, H6 and H7.
  asks: boolean;
  // The passive pulse's pass asks (regeneration and the top-off heal): every row but H1 and H2 lets
  // it, as today's pulse pass read only the runner and the death; the console Pause holds the pulse's
  // timer itself (the lifecycle owner's run scope).
  pulse: boolean;
  // The role loop's own sources ask.
  roleLoop: boolean;
  // The attack family may ask for the selected target, and for a passing one.
  attack: boolean;
  passing: boolean;
  // The class decisions on the target run, and the attack source asks.
  classes: boolean;
  revive: boolean;
  // Manual's switches: every family but the potion's, and the two potions.
  combat: boolean;
  potions: boolean;
  // The A/B feed replaces the class decisions.
  feed: boolean;
  // The rows that refuse the attack and the passing attack, for `skills.allows` and the ring.
  refusal: { row: string; source: string } | null;
  passingRefusal: { row: string; source: string } | null;
}

// The spend table, read once per pass: the stop rows in the tick's order, which reads the occupied rows
// before the A/B mode (b9b5c91e runner.ts `tick`), then the narrowing rows.
export function hold(f: HoldFacts): Hold {
  const before: [boolean, string, string][] = [
    [!f.active, 'H1', '03, the role runner stopped'],
    [f.rip, 'H2', 'the game: the character is dead'],
  ];
  // H3, the console Pause, is no row: the loop, the executor and the pulse are `act` registrations
  // of the lifecycle owner's run scope, so no pass runs while table P holds the character.
  const pre = before.find(([holds]) => holds);
  let stop = pre ? { row: pre[1], source: pre[2] } : null, occupied = false;
  if (!stop) for (const r of f.occupied) {
    const read = r.read();
    if (read === null) continue;
    if (read) { stop = { row: r.row, source: r.source }; occupied = true; }
    break;
  }
  const mode = f.abtesting();
  const ab: [boolean, string, string][] = [
    [mode === 'pending', 'H6', '06 (S-06c), the A/B test is pending'],
    [mode === 'feed', 'H7', '06 (S-06c), the A/B feed'],
  ];
  // The A/B rows hold the passing attack whatever row is in force (runner.ts `passingTarget`).
  const abAny = ab.find(([holds]) => holds), abRow = stop ? undefined : abAny;
  if (abRow) stop = { row: abRow[1], source: abRow[2] };
  const first = pre ?? abRow;
  const asks = !first, roleLoop = asks && !occupied, combat = f.hand?.combat !== false;
  const narrow: [boolean, string, string][] = [
    [!combat, 'H4', '01, Manual with Combat off'],
    [!f.roleCombat, 'H9', '03, the class role does not fight'],
    [f.merchant && !f.merchantEventFight, 'H10', '06 (S-06c), a merchant with no event fight'],
  ];
  const narrowed = narrow.find(([holds]) => holds);
  const attack = roleLoop && !narrowed;
  // A passing attack goes while occupied, but never in an A/B test, for a merchant or
  // inside a Cave.
  const passingRefusal = !asks ? stop : abAny ? { row: abAny[1], source: abAny[2] } : narrowed ? { row: narrowed[1], source: narrowed[2] } :
    f.merchant ? { row: 'H10', source: '06 (S-06c), a merchant attacks no passing monster' } :
    f.dungeonOwned ? { row: 'H11', source: '07 (S-07c), a Cave owns the character' } : null;
  return { stop, asks, pulse: !pre, roleLoop, attack, passing: !passingRefusal, classes: roleLoop && combat && !f.revive, revive: f.revive,
    combat, potions: f.hand?.usePotions !== false, feed: abRow?.[1] === 'H7',
    refusal: stop ?? (narrowed ? { row: narrowed[1], source: narrowed[2] } : null), passingRefusal: passingRefusal ?? null };
}

// The spend table for an add-on's spend action: H9 and H10
// lift for that one spend, so a role that does not fight, or a merchant with no event fight, casts
// the add-on's skill outside combat. H1, H2, H4, H6 to H8 and the occupied rows still hold.
export function actionHold(f: HoldFacts): Hold {
  return hold({ ...f, roleCombat: true, merchantEventFight: true });
}

// C1's emote action: the game has no emote event at pin 16881a27, so an emote is the G.skills row
// whose `emote` field names the look, cast through `use_skill`. The look must be one the character
// has unlocked, a key of `character.acx`.
export function emoteRefusal(skills: Readonly<Record<string, { emote?: unknown } | undefined>>, acx: unknown, name: unknown): string | null {
  const look = typeof name === 'string' ? skills[name]?.emote : undefined;
  if (typeof look !== 'string') return `${String(name)} is no emote skill`;
  return acx && typeof acx === 'object' && look in acx ? null : `the look ${look} is not unlocked`;
}

// `skills.allows`: the row that refuses a rank now, or nothing. `occupied` asks only the
// occupied rows, which shared.js's `isOccupied` binding reads; `passing` asks the passing
// column for a damage spend.
export function refuses(h: Hold, ask: { rank: SpendRank; passing?: boolean; occupied?: boolean }): { row: string; source: string } | undefined {
  if (ask.occupied) return h.stop && /^O/.test(h.stop.row) ? h.stop : undefined;
  if (ask.rank === 'damage') return (ask.passing ? h.passingRefusal : h.attack ? null : h.refusal) ?? undefined;
  return h.asks ? undefined : h.stop ?? undefined;
}

// The MP table, what MP a spend needs: a spend is refused for MP only where the server refuses it. The
// basic attack fails below `mp_cost` (server.js:3393-3396, `mp_mult` 1); a heal, a potion and
// regeneration never do (3354-3356); a skill with an `mp` field fails below its cost after
// `mp_reduction` (9846-9852), with the MP of every spend in flight held for it, and a cast whose
// category is not `survival` keeps the class reserve (skills/eligibility.ts `reserve`).
// One row more: an urgent area cast (`belowReserve`, skills/eligibility.ts
// `unrestrictedArea`) spends below the class reserve, and so does TRN-Q-DPS's pool cast (Mana
// Burst, whose game data `mp` is 0, so this rule sees no cost).
export interface MpAsk { skill: string; family: string; category: string; cost: number; belowReserve?: boolean }
export function mpRefusal(s: MpAsk, mp: number, attackCost: number, inFlight: number, reserve: () => number): string | null {
  if (s.skill === 'attack') return mp < attackCost ? 'insufficient MP' : null;
  if (s.skill === 'heal' || s.family === 'potion') return null;
  const remaining = mp - inFlight - s.cost;
  if (remaining < 0) return 'insufficient MP';
  if (s.category !== 'survival' && !s.belowReserve && remaining < reserve()) return 'survival MP reserved';
  return null;
}

// The MP table's A8 row, the priest's forecast: the MP the party's heals still need, which the priest's basic
// attack leaves alone. TRN-Q7 decided: it counts the spends the server refuses without their MP. The
// server heals at any MP and floors MP at 0 (server.js:3354-3356, checked live as TC13), so the heals
// add nothing and partyheal, which `mp` refuses below its cost (server.js:9846-9852), is the whole
// forecast.
export function forecast(w: SkillWorld): number {
  return unlocked(w, 'partyheal') ? cost(w, 'partyheal') : 0;
}
// A8: the priest asks for its basic attack while its MP less the forecast covers the attack's
// `mp_cost` (server.js:3393-3396); below it the attack family's slot goes to the next request.
export function priestAttacks(w: SkillWorld): boolean {
  return w.actor.ctype !== 'priest' || w.actor.mp - forecast(w) >= (Number(w.actor.mp_cost) || 0);
}

// T4, what a reply books. `stale` is a reply to a flight the pass already dropped or
// of an older epoch: it books only a `cooldown` reply's `ms`, the server's word on the family.
export type ReplyRow = 'accepted' | 'cooldown' | 'rejected' | 'stale-cooldown' | 'stale';
export function replyRow(ok: boolean, reason: string, ms: number, current: boolean): ReplyRow {
  const cooldown = !ok && (reason === 'cooldown' || reason === 'not_ready') && Number.isFinite(ms);
  if (!current) return cooldown ? 'stale-cooldown' : 'stale';
  return ok ? 'accepted' : cooldown || reason === 'cooldown' || reason === 'not_ready' ? 'cooldown' : 'rejected';
}
