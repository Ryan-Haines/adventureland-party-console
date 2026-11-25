// The party's fight verdict on the coordinator.
// After a death the party finishes while the
// fight's trend since it last changed says the foes die before a survivor's HP, less the next blows
// of its attackers, runs out; a change (a death, an arrival, a new attacker) restarts the window.
// Before the window holds two readings the game-data model decides, the hold check as
// `fightWinnable` calls it. Both model files stay movement's (02) and are called unchanged.
import { damageMultiplier, fightWinnable, type FightMember, type FightMonster } from '../../protocol/hold-check.ts';
import { hpSeconds } from '../../protocol/hold-check.ts';
import { fresh } from '../../protocol/reports.ts';

// `seenAt` is the member's report time, the reading's time for a group's fight.
export interface VerdictMember extends FightMember { hp?: number; max_hp?: number; seenAt?: number }
// `target` is the member a sighting names as the foe's target, and `seenAt` that sighting's report
// time (the targeting owner's sightings of the queue's monsters carry it, characters/shared.js `groupedSightings`).
export interface VerdictFoe { id: string; mtype?: string; hp?: number; target?: string | null; seenAt?: number }
type Monsters = Readonly<Record<string, FightMonster | undefined>> | null;
export interface Reading { at: number; foeHp: number; hp: Record<string, number> }
export interface VerdictWindow { since: number; restart: Restart; foes: string[]; members: string[]; readings: Reading[] }
export type Restart = 'start' | 'death' | 'arrival' | 'attacker';
export interface Judgement {
  verdict: 'finish' | 'leave'; model: 'trend' | 'model'; restart: Restart | null;
  foeRate: number | null; toKill: number | null; toFall: Record<string, number> | null;
  // The game-data model's answer for the fight as it stands, beside the trend's: an escape the
  // trend decides against a model win is bad luck (escaped.ts).
  modelWins: boolean;
}

// A survivor's trend, per second: the median of the rates between consecutive readings, so one
// burst inside the window moves one interval's rate and not the trend, while a loss that most
// intervals show does. A drop that
// stays down while the survivor heals back is one interval too. The foes' side reads spans instead
// (`lostRate`); whether the survivors' side should read spans too is open.
const median = (values: number[]): number => {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
};
function trend(points: readonly [number, number][]): number {
  const rates: number[] = [];
  for (let i = 1; i < points.length; i++) if (points[i]![0] > points[i - 1]![0]) rates.push((points[i]![1] - points[i - 1]![1]) / (points[i]![0] - points[i - 1]![0]) * 1000);
  return median(rates);
}
// The foes' kill rate, per second: the HP they lost over the window's whole span, so it reads 0
// only while no foe has lost HP since the window started
// A short burst is the survivors' bad luck, so the foe
// side takes no median.
function lostRate(readings: readonly Reading[]): number {
  const first = readings[0]!, last = readings.at(-1)!;
  return last.at > first.at ? (first.foeHp - last.foeHp) / (last.at - first.at) * 1000 : 0;
}
// One blow of a foe on a survivor: its attack after the survivor's defence for its damage type
// (fight-winnable.ts's rule).
function blow(monsters: Monsters, foe: VerdictFoe, m: VerdictMember): number {
  const g = monsters?.[foe.mtype ?? ''] ?? {};
  const defense = g.damage_type === 'magical' ? Number(m.resistance ?? 0) : g.damage_type === 'pure' ? 0 : Number(m.armor ?? 0);
  return Number(g.attack ?? 0) * (g.damage_type === 'pure' ? 1 : damageMultiplier(defense));
}
// The foes whose next blows a survivor's floor counts. Reports name no monster's target, so the
// survivor's own HP loss over the window says how many foes hit it: the fewest of the hardest
// hitters whose game-data damage per second covers its net loss, or every foe when game data gives
// none of them a rate. A survivor that loses no HP
// lasts at any floor (hold-check.ts `hpSeconds`).
function attackersOf(monsters: Monsters, foes: readonly VerdictFoe[], m: VerdictMember, net: number): VerdictFoe[] {
  const rated = foes.map(f => ({ f, hit: blow(monsters, f, m), dps: blow(monsters, f, m) * Number(monsters?.[f.mtype ?? '']?.frequency ?? 0) }))
    .sort((a, b) => b.hit - a.hit);
  if (!rated.some(r => r.dps > 0)) return [...foes];
  const out: VerdictFoe[] = [];
  let covered = 0;
  for (const r of rated) { if (out.length && covered >= net) break; out.push(r.f); covered += r.dps; }
  return out;
}

// The foes the model puts on each survivor: a foe
// on the survivor a sighting of this fight names as its target, and a foe no such sighting names
// once, on the survivor it would bring down soonest (its HP over that foe's damage per second). A
// sighting from before the window started is the old fight's and names no one.
function placed(win: VerdictWindow, monsters: Monsters, survivors: readonly VerdictMember[], foes: readonly VerdictFoe[]) {
  return foes.map(f => {
    const named = f.target && Number(f.seenAt) >= win.since && survivors.some(s => s.name === f.target) ? f.target : null;
    const rate = (m: VerdictMember) => blow(monsters, f, m) * Number(monsters?.[f.mtype ?? '']?.frequency ?? 0);
    const soonest = [...survivors].sort((a, b) => (Number(a.hp) || 0) / (rate(a) || 1e-9) - (Number(b.hp) || 0) / (rate(b) || 1e-9))[0]!;
    return { mtype: f.mtype, hp: f.hp, target: named ?? soonest.name };
  });
}
// The largest gap between two readings of the window: a reading's HP is up to one report gap older
// than its time.
function reportGap(readings: readonly Reading[]): number {
  let gap = 0;
  for (let i = 1; i < readings.length; i++) gap = Math.max(gap, readings[i]!.at - readings[i - 1]!.at);
  return gap;
}

// One reading of the fight into its window; a change since the window's start restarts it. A
// reading is one report time (`at`, the newest report of the survivors): the coordinator's tick runs
// more often than the reports come, and two readings of one report would read a trend of zero.
function observe(win: VerdictWindow | undefined, now: number, survivors: readonly VerdictMember[], foes: readonly VerdictFoe[]): { win: VerdictWindow; restart: Restart | null } {
  const reading: Reading = { at: now, foeHp: foes.reduce((s, f) => s + Math.max(0, Number(f.hp) || 0), 0),
    hp: Object.fromEntries(survivors.map(m => [m.name, Number(m.hp) || 0])) };
  const names = survivors.map(m => m.name), ids = foes.map(f => f.id);
  // A window whose last reading is no longer a fresh report saw no fight in between, so the next
  // reading starts a new fight: "Counting data from an old fight when starting a new fight is a bad
  // design" (the user, 2026-11-06).
  const restart: Restart | null = !win || !fresh(win.readings.at(-1)!.at, now) ? 'start' : win.members.some(n => !names.includes(n)) ? 'death' : names.some(n => !win.members.includes(n)) ? 'arrival'
    : ids.some(id => !win.foes.includes(id)) ? 'attacker' : null;
  if (restart) return { win: { since: now, restart, foes: ids, members: names, readings: [reading] }, restart };
  if (win!.readings.at(-1)!.at >= now) win!.readings[win!.readings.length - 1] = reading;
  else win!.readings.push(reading);
  // A foe that died leaves the list; the window keeps the rest.
  win!.foes = win!.foes.filter(id => ids.includes(id));
  return { win: win!, restart: null };
}
function judge(win: VerdictWindow, survivors: readonly VerdictMember[], foes: readonly VerdictFoe[], monsters: Monsters, restart: Restart | null): Judgement {
  // With no foe left there is nothing to finish, and with no survivor nothing to finish it with
  // (b9b5c91e's `canFinish` needed both).
  if (!foes.length || !survivors.length) return { verdict: 'leave', model: 'model', restart, foeRate: null, toKill: null, toFall: null, modelWins: false };
  // The game-data model, `fightWinnable` unchanged, over the foes as this fight's sightings place them.
  const wins = fightWinnable(survivors, placed(win, monsters, survivors, foes), monsters);
  if (win.readings.length < 2) return { verdict: wins ? 'finish' : 'leave', model: 'model', restart, foeRate: null, toKill: null, toFall: null, modelWins: wins };
  const last = win.readings.at(-1)!;
  const foeRate = lostRate(win.readings);
  const toKill = foeRate > 0 ? last.foeHp / foeRate : Infinity;
  const toFall: Record<string, number> = {};
  for (const s of survivors) {
    const net = -trend(win.readings.filter(r => s.name in r.hp).map(r => [r.at, r.hp[s.name]!]));
    toFall[s.name] = hpSeconds({ hp: Number(s.hp) || 0, attackers: attackersOf(monsters, foes, s, net).map(f => ({ dps: 0, hp: 0, blow: blow(monsters, f, s) })) }, net);
  }
  const floor = Math.min(...Object.values(toFall));
  // A trend needs the kill side's rate: until the window's readings show the foes losing HP, the
  // reports have not caught the party's damage yet (each carries the HP of its moment), and the
  // game-data model keeps deciding, as before two readings. Once
  // the window spans one attack cycle of every survivor (1000 / its `frequency`)
  // and one report gap with no foe losing HP, the party's blows have had their time to
  // show in a report: the kill rate reads 0, so
  // the party leaves while a survivor's HP falls and finishes while none does.
  // (a), decided 2026-11-06). A survivor with no attack rate never completes a cycle, and the model
  // keeps deciding.
  if (!(foeRate > 0)) {
    const cycle = Math.max(...survivors.map(s => Number(s.frequency) > 0 ? 1000 / Number(s.frequency) : Infinity));
    if (last.at - win.readings[0]!.at < cycle + reportGap(win.readings)) return { verdict: wins ? 'finish' : 'leave', model: 'model', restart, foeRate, toKill: null, toFall: null, modelWins: wins };
    return { verdict: Number.isFinite(floor) ? 'leave' : 'finish', model: 'trend', restart, foeRate: 0, toKill: Infinity, toFall, modelWins: wins };
  }
  return { verdict: toKill < floor ? 'finish' : 'leave', model: 'trend', restart, foeRate, toKill, toFall, modelWins: wins };
}

// The verdict for one fight kept by its key (a recovery's id, a group's id): one window each, with
// one reading per report for the fight's span. A window whose last reading is no longer a fresh
// report belongs to a fight that ended: `observe` would restart it, so each decision drops every such
// window, a group's included, whose fight nothing else ends.
export function createVerdicts(ports: { now(): number; monsters(): Monsters }) {
  const windows = new Map<string, VerdictWindow>();
  return {
    decide(key: string, survivors: readonly VerdictMember[], foes: readonly VerdictFoe[], at = ports.now()): Judgement {
      for (const [other, w] of windows) if (other !== key && !fresh(w.readings.at(-1)!.at, at)) windows.delete(other);
      const { win, restart } = observe(windows.get(key), at, survivors, foes);
      windows.set(key, win);
      return judge(win, survivors, foes, ports.monsters(), restart);
    },
    end(key: string) { windows.delete(key); },
    // A walk through a fight (the movement owner's rule): `fightWinnable` unchanged, no potions.
    walk(members: readonly VerdictMember[], attackers: readonly { mtype?: string; hp?: number; target?: string }[]): 'fight' | 'leave' {
      return fightWinnable(members, attackers, ports.monsters()) ? 'fight' : 'leave';
    },
  };
}
export type Verdicts = ReturnType<typeof createVerdicts>;
